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
import type { FunctionEntity, ImportEntity } from '@codegraph/types';
import { findEnclosingNamedEntity, type EnclosingKind } from '@codegraph/plugin-common';
import { findNodesOfTypes } from './types';

/**
 * Represents a function call reference. The caller may be any named entity
 * (Function, Variable, Class, Interface) — not just Function.
 */
export interface CallReference {
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
 */
export function extractCalls(
  rootNode: Parser.SyntaxNode,
  filePath: string,
  functions: FunctionEntity[],
  imports: ImportEntity[],
  includeExternals: boolean = false,
): CallReference[] {
  const calls: CallReference[] = [];
  const localFunctions = new Map(functions.map((f) => [f.name, f]));
  const importedSymbols = buildImportMap(imports);

  // Iterate every call_expression in the tree (one walk).
  const callNodes = findNodesOfTypes(rootNode, ['call_expression']);

  for (const callNode of callNodes) {
    const callInfo = parseCallExpression(callNode);
    if (!callInfo) continue;
    const { calleeName, line } = callInfo;

    // Resolve callee file. Skip externals unless requested.
    let calleeFilePath: string | undefined;
    if (localFunctions.has(calleeName)) {
      calleeFilePath = filePath;
    } else if (importedSymbols.has(calleeName)) {
      calleeFilePath = importedSymbols.get(calleeName);
    }
    if (!calleeFilePath && !includeExternals) continue;

    // Attribute the call to the nearest named ancestor.
    const owner = findEnclosingNamedEntity(callNode);
    if (!owner) continue; // top-level IIFE / bare call — no useful caller

    const ref: CallReference = {
      callerKind: owner.kind,
      callerName: owner.name,
      callerStartLine: owner.startLine,
      callerFilePath: filePath,
      calleeName,
      line,
      via: owner.via,
    };
    if (calleeFilePath) ref.calleeFilePath = calleeFilePath;
    calls.push(ref);
  }

  return calls;
}

/** Build a map of imported symbol names to their resolved file paths. */
function buildImportMap(imports: ImportEntity[]): Map<string, string | undefined> {
  const map = new Map<string, string | undefined>();
  for (const imp of imports) {
    if (imp.isDefault && imp.defaultAlias) map.set(imp.defaultAlias, imp.resolvedPath);
    if (imp.isNamespace && imp.namespaceAlias) map.set(imp.namespaceAlias, imp.resolvedPath);
    for (const spec of imp.specifiers) {
      const localName = spec.alias || spec.name;
      map.set(localName, imp.resolvedPath);
    }
  }
  return map;
}

/** Parse a call_expression node to extract callee info. */
function parseCallExpression(node: Parser.SyntaxNode): { calleeName: string; line: number } | null {
  const funcNode = node.childForFieldName('function');
  if (!funcNode) return null;

  let calleeName: string | undefined;
  if (funcNode.type === 'identifier') {
    calleeName = funcNode.text;
  } else if (funcNode.type === 'member_expression') {
    const property = funcNode.childForFieldName('property');
    if (property?.type === 'property_identifier') calleeName = property.text;
  } else if (funcNode.type === 'call_expression') {
    return null; // chained call expressions — out of scope for v1
  }

  if (!calleeName || isBuiltinOrCommon(calleeName)) return null;

  return { calleeName, line: node.startPosition.row + 1 };
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
