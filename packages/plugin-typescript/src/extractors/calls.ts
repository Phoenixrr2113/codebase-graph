/**
 * Calls Extractor
 * Extracts function call references from TypeScript/JavaScript AST.
 *
 * Attribution model: every call_expression is attributed to its nearest named
 * enclosing entity (Function, Variable, Class, Interface) via
 * findEnclosingNamedEntity. Calls with no named owner (top-level IIFEs, bare
 * top-level calls) are dropped. The `via` field distinguishes calls in the
 * lexical body of a named entity ('direct') from calls inside anonymous
 * closures the entity initialises ('closure').
 *
 * See docs/superpowers/specs/2026-04-30-ts-calls-attribution-design.md.
 */

import Parser from 'tree-sitter';
import type { FunctionEntity, ImportEntity, ClassEntity } from '@codegraph/types';
import { findEnclosingNamedEntity, type EnclosingKind } from '@codegraph/plugin-common';
import { findNodesOfTypes } from './types';
import type { ResolvedImportMap } from './imports';

/**
 * Represents a function call reference. The caller may be any named entity
 * (Function, Variable, Class, Interface), not just Function.
 */
export interface CallReference {
  /** Canonical caller symbol id once resolved. */
  fromId?: string;
  /** Canonical callee symbol id once resolved. */
  toId?: string;
  /** Kind of the named entity containing the call. */
  callerKind: EnclosingKind;
  /** Name of the named entity containing the call. */
  callerName: string;
  /** Start line of the named entity (1-based). */
  callerStartLine: number;
  /** File path of the caller. */
  callerFilePath: string;
  /** Name of the function being called. */
  calleeName: string;
  /** File path of the callee (undefined if external/unresolved). */
  calleeFilePath?: string;
  /**
   * Class the callee method belongs to, when the call is a receiver-typed
   * method call (`s.method()` where `s` is bound to a class). Lets the graph
   * layer disambiguate two same-named methods on different classes in the
   * same file (operations.ts CREATE_CALLS_EDGE_BY_CLASS) instead of matching
   * every same-named Function node in that file. Undefined for plain
   * function calls, which have no class to qualify against.
   */
  calleeClassName?: string;
  /** Line number of the call site. */
  line: number;
  /** Whether the call is direct or via an anonymous closure wrapper. */
  via: 'direct' | 'closure';
}

/**
 * Extract all function call references from a syntax tree.
 *
 * @param rootNode - Root node of the syntax tree
 * @param filePath - Path of the file being parsed
 * @param functions - Functions defined in this file (for callee resolution)
 * @param imports - Imports in this file (for cross-file callee resolution)
 * @param includeExternals - Whether to include unresolved external callees
 * @param classes - Classes defined in this file (for receiver-typed callee
 *   resolution: `const s = new Service(); s.method()`). Optional, defaults to
 *   `[]` for callers that don't have class entities handy. Without it,
 *   receiver-typed calls can still resolve to an IMPORTED class's method
 *   (via `imports`), just not to a locally-declared class's method.
 * @param resolvedImports - Optional barrel-chain- and alias-aware resolution
 *   for this file's imported names (local name to its true declaring file and
 *   declared name), built once per project by the indexing pipeline. When a
 *   name is covered, it takes priority over the plain same-file `imports`
 *   lookup: unlike that lookup, it follows `export { x as y } from '...'`
 *   chains through barrels to the origin file, and rewrites the name being
 *   searched for from the local alias to the name actually declared there.
 *   Omit to keep resolving strictly from this file's own `imports` (today's
 *   behavior, still correct for direct, non-barrel, non-renamed imports).
 */
export function extractCalls(
  rootNode: Parser.SyntaxNode,
  filePath: string,
  functions: FunctionEntity[],
  imports: ImportEntity[],
  includeExternals: boolean = false,
  classes: ClassEntity[] = [],
  resolvedImports?: ResolvedImportMap,
): CallReference[] {
  const calls: CallReference[] = [];
  const localFunctions = new Map(functions.map((f) => [f.name, f]));
  const { symbols: importedSymbols, namespaces: importedNamespaces } = buildImportMaps(imports);
  const localClassNames = new Set(classes.map((c) => c.name));
  const classBindings = buildClassBindings(rootNode);

  // Resolve a locally-bound imported name to where it's actually declared.
  // Prefers `resolvedImports` (barrel-chain- and alias-aware) when it covers
  // the name; falls back to the plain same-file import map otherwise, which
  // is exactly today's pre-barrel-fix behavior. Returns undefined for a name
  // that isn't a known import at all, or is a known import with no resolvable
  // source file (external package), so callers can try other strategies or
  // treat it as unresolved.
  function resolveImportedName(name: string): { filePath: string; name: string } | undefined {
    const viaResolvedImports = resolvedImports?.get(name);
    if (viaResolvedImports) {
      return { filePath: viaResolvedImports.filePath, name: viaResolvedImports.exportedName };
    }
    if (importedSymbols.has(name)) {
      const resolvedPath = importedSymbols.get(name);
      if (!resolvedPath) return undefined;
      return { filePath: resolvedPath, name };
    }
    return undefined;
  }

  // Iterate every call_expression in the tree (one walk).
  const callNodes = findNodesOfTypes(rootNode, ['call_expression']);

  for (const callNode of callNodes) {
    const callInfo = parseCallExpression(callNode);
    if (!callInfo) continue;
    const { calleeName, namespaceLhs, line } = callInfo;

    // Resolve callee file (and, for imported callees, the name actually
    // declared at the origin, which may differ from the call site's local
    // alias). Skip externals unless requested.
    let calleeFilePath: string | undefined;
    let resolvedCalleeName = calleeName;
    let calleeClassName: string | undefined;

    if (localFunctions.has(calleeName)) {
      calleeFilePath = filePath;
    } else {
      const importedCallee = resolveImportedName(calleeName);
      if (importedCallee) {
        calleeFilePath = importedCallee.filePath;
        resolvedCalleeName = importedCallee.name;
      } else if (namespaceLhs && importedNamespaces.has(namespaceLhs)) {
        // Member-access call through a namespace import: `util.floatSafeRemainder()`
        // Resolve through the namespace's source file.
        calleeFilePath = importedNamespaces.get(namespaceLhs);
      } else if (namespaceLhs) {
        // Member-access call through a receiver bound to a class instance:
        // `const s = new Service(); s.method()`. Resolve the receiver to its
        // class via the per-file binding table, then the class to its
        // defining file (local declaration or import), same as any other
        // identifier resolution above. Record the class name too, so the
        // graph layer can disambiguate same-named methods on different
        // classes in the same file instead of matching every Function node
        // with this name and filePath.
        const className = classBindings.get(namespaceLhs);
        if (className) {
          if (localClassNames.has(className)) {
            calleeFilePath = filePath;
            calleeClassName = className;
          } else {
            const importedClass = resolveImportedName(className);
            if (importedClass) {
              calleeFilePath = importedClass.filePath;
              calleeClassName = importedClass.name;
            }
          }
        }
      }
    }
    if (!calleeFilePath && !includeExternals) continue;

    // Attribute the call to the nearest named ancestor.
    const owner = findEnclosingNamedEntity(callNode);
    if (!owner) continue; // top-level IIFE / bare call, no useful caller

    const ref: CallReference = {
      callerKind: owner.kind,
      callerName: owner.name,
      callerStartLine: owner.startLine,
      callerFilePath: filePath,
      calleeName: resolvedCalleeName,
      line,
      via: owner.via,
    };
    if (calleeFilePath) ref.calleeFilePath = calleeFilePath;
    if (calleeClassName) ref.calleeClassName = calleeClassName;
    calls.push(ref);
  }

  return calls;
}

/**
 * Build two import maps from a file's imports:
 * - `symbols`: any locally-bound import name → its resolved source file path.
 *   Includes default aliases, namespace aliases (so `util` itself resolves),
 *   and all named specifiers.
 * - `namespaces`: only namespace aliases → resolved file path. Used to resolve
 *   member-access calls like `util.floatSafeRemainder()` whose property name
 *   isn't a known imported symbol but whose LHS is a namespace import.
 */
function buildImportMaps(imports: ImportEntity[]): {
  symbols: Map<string, string | undefined>;
  namespaces: Map<string, string | undefined>;
} {
  const symbols = new Map<string, string | undefined>();
  const namespaces = new Map<string, string | undefined>();
  for (const imp of imports) {
    if (imp.isDefault && imp.defaultAlias) symbols.set(imp.defaultAlias, imp.resolvedPath);
    if (imp.isNamespace && imp.namespaceAlias) {
      symbols.set(imp.namespaceAlias, imp.resolvedPath);
      namespaces.set(imp.namespaceAlias, imp.resolvedPath);
    }
    for (const spec of imp.specifiers) {
      const localName = spec.alias || spec.name;
      symbols.set(localName, imp.resolvedPath);
    }
  }
  return { symbols, namespaces };
}

/**
 * Build a per-file table mapping local variable/parameter names to the class
 * they're bound to, from three cheap-to-read AST patterns:
 *   - `const/let/var x = new ClassName(...)`: constructor binding.
 *   - `const x: ClassName = ...`: typed declaration (bare identifier type only).
 *   - `function foo(x: ClassName)` / method parameters: typed parameter.
 *
 * Deliberately not scope-aware: no control-flow or block-scope tracking, just
 * a flat per-file map. A name bound to two different classes anywhere in the
 * file is dropped (mapped to `null`) rather than guessed at, since telling
 * which binding actually reaches a given call site needs a real type checker,
 * which this is not.
 */
function buildClassBindings(rootNode: Parser.SyntaxNode): Map<string, string | null> {
  const bindings = new Map<string, string | null>();

  const addBinding = (name: string, className: string): void => {
    const existing = bindings.get(name);
    if (existing === undefined) {
      bindings.set(name, className);
    } else if (existing !== null && existing !== className) {
      bindings.set(name, null); // conflicting binding elsewhere in the file, drop it
    }
  };

  // const/let/var x = new ClassName(...); const x: ClassName = ...
  for (const declarator of findNodesOfTypes(rootNode, ['variable_declarator'])) {
    const nameNode = declarator.childForFieldName('name');
    if (!nameNode || nameNode.type !== 'identifier') continue;

    const valueNode = declarator.childForFieldName('value');
    if (valueNode?.type === 'new_expression') {
      const ctor = valueNode.childForFieldName('constructor');
      if (ctor?.type === 'identifier') {
        addBinding(nameNode.text, ctor.text);
        continue;
      }
    }

    const className = simpleTypeAnnotationName(declarator.childForFieldName('type'));
    if (className) addBinding(nameNode.text, className);
  }

  // Typed parameters: function foo(x: ClassName), method(x: ClassName)
  for (const param of findNodesOfTypes(rootNode, ['required_parameter', 'optional_parameter'])) {
    const patternNode = param.childForFieldName('pattern');
    if (!patternNode || patternNode.type !== 'identifier') continue;

    const className = simpleTypeAnnotationName(param.childForFieldName('type'));
    if (className) addBinding(patternNode.text, className);
  }

  return bindings;
}

/** Matches a bare identifier type name: no generics, unions, arrays, etc. */
const SIMPLE_TYPE_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * Extract a bare class/type identifier from a `type_annotation` node's text
 * (e.g. `: Service` -> `Service`). Returns undefined for anything more
 * complex (generics, unions, primitives with punctuation, etc.): those
 * aren't cheap to resolve without a real type checker, and a wrong guess is
 * worse than no binding at all.
 */
function simpleTypeAnnotationName(typeAnnotation: Parser.SyntaxNode | null): string | undefined {
  if (!typeAnnotation) return undefined;
  const text = typeAnnotation.text.replace(/^:\s*/, '').trim();
  return SIMPLE_TYPE_NAME.test(text) ? text : undefined;
}

/**
 * Parse a call_expression node to extract callee info.
 *
 * For member-expression callees like `util.foo()`, the LHS identifier is
 * captured as `namespaceLhs` so the extractor can resolve the call through
 * a namespace import (`import * as util from './util'`). The LHS is only
 * surfaced when it's a plain identifier — chained property accesses
 * (`a.b.foo()`) are out of scope for v1.
 */
function parseCallExpression(node: Parser.SyntaxNode): {
  calleeName: string;
  namespaceLhs?: string;
  line: number;
} | null {
  const funcNode = node.childForFieldName('function');
  if (!funcNode) return null;

  let calleeName: string | undefined;
  let namespaceLhs: string | undefined;
  if (funcNode.type === 'identifier') {
    calleeName = funcNode.text;
  } else if (funcNode.type === 'member_expression') {
    const property = funcNode.childForFieldName('property');
    if (property?.type === 'property_identifier') calleeName = property.text;
    const object = funcNode.childForFieldName('object');
    if (object?.type === 'identifier') namespaceLhs = object.text;
  } else if (funcNode.type === 'call_expression') {
    return null; // chained call expressions — out of scope for v1
  }

  if (!calleeName || isBuiltinOrCommon(calleeName)) return null;

  const result: { calleeName: string; namespaceLhs?: string; line: number } = {
    calleeName,
    line: node.startPosition.row + 1,
  };
  if (namespaceLhs) result.namespaceLhs = namespaceLhs;
  return result;
}

/** Pre-built set of builtin/common names to skip (allocated once, not per call). */
const BUILTIN_NAMES = new Set([
  // Console
  'log', 'warn', 'error', 'info', 'debug', 'trace',
  // Common utilities
  'require', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite',
  // Array methods
  'map', 'filter', 'reduce', 'forEach', 'find', 'some', 'every',
  'push', 'pop', 'shift', 'unshift', 'slice', 'splice', 'concat',
  // String methods
  'split', 'join', 'trim', 'replace', 'match', 'includes', 'startsWith', 'endsWith',
  // Object methods
  'keys', 'values', 'entries', 'assign', 'freeze',
  // Promise
  'then', 'catch', 'finally', 'resolve', 'reject', 'all', 'race',
]);

function isBuiltinOrCommon(name: string): boolean {
  return BUILTIN_NAMES.has(name);
}
