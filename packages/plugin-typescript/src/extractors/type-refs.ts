/**
 * Type Reference Extractor
 *
 * Emits TypeRef entities + HAS_PARAM / RETURNS / USES_TYPE edge descriptors
 * for every function (top-level and methods) extracted from TypeScript/JavaScript.
 *
 * Identity rules (per @codegraph/plugin-common resolveTypeIdentity):
 *   - Primitives: id = `prim::typescript::<name>`
 *   - User types: id = `type::typescript::<definingFilePath>::<declaredName>`
 *     Both the defining file AND the name are resolved per-reference (see
 *     `TypeResolutionContext`), because identity is (definingFile, DECLARED
 *     name), not (referencing file, local alias):
 *       1. A name declared locally in the file being parsed (class/interface/
 *          type alias/enum) keys on that file, name unchanged.
 *       2. A name resolved by the (optional, barrel-aware) `resolvedImports`
 *          map keys on that target's file, with the name rewritten to the
 *          target's declared (origin) name, undoing any local alias.
 *       3. A name that arrives via a same-file import (no barrel map needed)
 *          keys on that import's resolvedPath, with the name rewritten to the
 *          specifier's original (pre-alias) name.
 *       4. Anything else (global/ambient/unresolvable) falls back to the file
 *          currently being parsed with the name unchanged, matching the
 *          pre-fix behavior.
 *   - Generics stored as flat printed name (e.g. `Promise<User>`) in v1. The
 *     flat name is looked up as-is against local/imported names, so it only
 *     resolves cross-file when it matches exactly. Structural decomposition of
 *     generics is a v2 feature.
 *
 * Per spec: docs/superpowers/specs/2026-04-27-pre-benchmark-fixes-design.md §4.3
 */

import Parser from 'tree-sitter';
import { resolveTypeIdentity } from '@codegraph/plugin-common';
import type { TypeRefEntity } from '@codegraph/types';
import type {
  HasParamEdgeDescriptor,
  ReturnsEdgeDescriptor,
  UsesTypeEdgeDescriptor,
} from '@codegraph/types';

export interface TypeRefsForFunction {
  typeRefs: TypeRefEntity[];
  hasParamEdges: HasParamEdgeDescriptor[];
  returnsEdges: ReturnsEdgeDescriptor[];
  usesTypeEdges: UsesTypeEdgeDescriptor[];
}

/**
 * Where a type is actually declared: the file that owns the declaration, and
 * the name it is declared under there (which may differ from the local alias
 * a given file imported it as).
 *
 * This is a structural duplicate of the `ResolvedImportTarget` interface the
 * imports extractor is landing (barrel-chain + alias resolution, built once
 * per project in the indexing pipeline). It is declared locally, rather than
 * imported from `./imports`, purely to avoid a build-order dependency on that
 * in-flight work; TypeScript's structural typing means the producer's real
 * map satisfies this shape once it exists, so callers can pass either without
 * change. Replace with an import once the producer lands (see fix report).
 */
export interface ResolvedImportTarget {
  /** Absolute path of the file that actually declares the export (barrel chains already followed). */
  filePath: string;
  /** The name as declared at the origin file, not the local alias a consumer imported it as. */
  exportedName: string;
}

/** Local imported name (as used in the current file) mapped to its true origin. */
export type ResolvedImportMap = ReadonlyMap<string, ResolvedImportTarget>;

/**
 * Everything the extractor needs, beyond the current file's own AST, to resolve
 * a type name to (a) the file that actually declares it and (b) the name it is
 * declared under there. All fields are optional so every existing call site
 * (which passes nothing) keeps today's pass-through behavior: keying every
 * non-primitive reference on the current file under its as-written name.
 */
export interface TypeResolutionContext {
  /** Names declared locally in the file being parsed (classes, interfaces, type aliases, enums). */
  localTypeNames?: ReadonlySet<string>;
  /**
   * Same-file import resolution, built directly from this file's own
   * ImportEntity specifiers (no barrel-chain knowledge required): local name
   * (alias if aliased, otherwise the imported name itself) mapped to the
   * import's resolvedPath and the specifier's original (pre-alias) name.
   * Covers the plain aliased-import case even when `resolvedImports` is absent.
   */
  importedTypes?: ReadonlyMap<string, ResolvedImportTarget>;
  /**
   * Barrel-chain- and alias-resolved origins, supplied by the indexing
   * pipeline once available. Takes priority over `importedTypes` for any name
   * it covers, since it reflects the type's true origin even through re-export
   * chains; `importedTypes` remains the fallback so same-file aliasing keeps
   * working before this map exists.
   */
  resolvedImports?: ResolvedImportMap;
}

/**
 * Resolve both the defining file AND the declared name for a type reference:
 *   1. Declared locally in the current file: current file, name unchanged.
 *   2. Covered by the (barrel-aware) `resolvedImports` map: that target's
 *      file and declared name.
 *   3. Covered by this file's own same-file import resolution
 *      (`importedTypes`): that import's resolved file and original name.
 *   4. Otherwise (global/ambient/unresolvable/no context given): fall back to
 *      the current file with the name unchanged, i.e. today's behavior. This
 *      is the regression guard: callers that don't pass a resolution context
 *      get identical output to before this fix.
 */
function resolveTypeReference(
  name: string,
  filePath: string,
  resolution?: TypeResolutionContext,
): { name: string; definingFile: string } {
  if (resolution?.localTypeNames?.has(name)) {
    return { name, definingFile: filePath };
  }
  const viaResolvedImports = resolution?.resolvedImports?.get(name);
  if (viaResolvedImports) {
    return { name: viaResolvedImports.exportedName, definingFile: viaResolvedImports.filePath };
  }
  const viaSameFileImport = resolution?.importedTypes?.get(name);
  if (viaSameFileImport) {
    return { name: viaSameFileImport.exportedName, definingFile: viaSameFileImport.filePath };
  }
  return { name, definingFile: filePath };
}

/**
 * Strip the leading `: ` from a type annotation's raw text.
 * e.g. ": string" → "string", "string" → "string"
 */
function stripAnnotationColon(text: string): string {
  return text.replace(/^:\s*/, '').trim();
}

/**
 * Build a TypeRefEntity for the given type name (as written at the reference
 * site, which may be a local alias). Primitives get a global id. User types
 * get an id scoped to the file that declares them, under the name they are
 * declared under there, resolved via `resolution` when available; otherwise
 * the current file and the as-written name, as before.
 */
function makeTypeRef(
  name: string,
  filePath: string,
  resolution?: TypeResolutionContext,
): TypeRefEntity {
  const resolved = resolveTypeReference(name, filePath, resolution);
  const identity = resolveTypeIdentity({
    language: 'typescript',
    name: resolved.name,
    definingFile: resolved.definingFile,
  });
  return {
    id: identity.id,
    name: identity.name,
    language: 'typescript',
    isPrimitive: identity.isPrimitive,
    ...(identity.definingFile !== undefined ? { definingFile: identity.definingFile } : {}),
  };
}

/**
 * Check if a function node declares the `async` keyword.
 * Mirrors the same logic used in parseFunctionNode (functions.ts).
 */
function isFunctionAsync(node: Parser.SyntaxNode): boolean {
  for (const child of node.children) {
    if (child.text === 'async') return true;
  }
  if (node.type === 'arrow_function') {
    const parent = node.parent;
    if (parent) {
      for (const sibling of parent.children) {
        if (sibling.text === 'async') return true;
      }
    }
  }
  return false;
}

/**
 * Walk a node's subtree (non-recursively past function boundaries) collecting
 * type annotations, casts, and generic instantiations used inside a function body.
 *
 * We stop descending into nested function bodies so we don't double-count types
 * used in closures — those will be attributed to their own function entity.
 */
function collectBodyTypeUsages(
  bodyNode: Parser.SyntaxNode,
  filePath: string,
  resolution?: TypeResolutionContext,
): { typeRef: TypeRefEntity; kind: 'annotation' | 'cast' | 'instantiation' }[] {
  const usages: { typeRef: TypeRefEntity; kind: 'annotation' | 'cast' | 'instantiation' }[] = [];

  const FUNCTION_BOUNDARY_TYPES = new Set([
    'function_declaration',
    'function_expression',
    'arrow_function',
    'method_definition',
    'generator_function_declaration',
  ]);

  function visit(node: Parser.SyntaxNode): void {
    // Don't descend into nested function bodies (their types belong to that function)
    if (FUNCTION_BOUNDARY_TYPES.has(node.type)) {
      return;
    }

    // type_annotation on variable declarations: `const x: string = ...`
    // The annotation child has type === 'type_annotation'
    if (node.type === 'type_annotation') {
      const rawText = node.text;
      const typeName = stripAnnotationColon(rawText);
      if (typeName) {
        usages.push({ typeRef: makeTypeRef(typeName, filePath, resolution), kind: 'annotation' });
      }
    }

    // as-expression (type assertion): `x as T`
    // tree-sitter represents this as: [value_expr, 'as', type_node]
    // childForFieldName('type') returns null for as_expression — the type is the
    // last child (after the 'as' keyword token).
    if (node.type === 'as_expression') {
      const lastChild = node.children[node.children.length - 1];
      if (lastChild && lastChild.text !== 'as') {
        const typeName = lastChild.text.trim();
        if (typeName) {
          usages.push({ typeRef: makeTypeRef(typeName, filePath, resolution), kind: 'cast' });
        }
      }
    }

    // generic_type instantiations: `new Map<K, V>()` or explicit type args
    if (node.type === 'generic_type') {
      const typeName = node.text.trim();
      if (typeName) {
        usages.push({ typeRef: makeTypeRef(typeName, filePath, resolution), kind: 'instantiation' });
      }
    }

    for (const child of node.children) {
      visit(child);
    }
  }

  visit(bodyNode);
  return usages;
}

/**
 * Extract TypeRef entities + the three edge descriptor arrays for a single
 * function node.
 *
 * @param node       The function declaration/expression/arrow/method AST node
 * @param functionId The already-computed FunctionEntity id for this node
 * @param filePath   The file being indexed
 * @param resolution Optional local-declaration/import info used to resolve each
 *                    referenced type name to its defining file. Omit to keep the
 *                    pre-fix behavior (every non-primitive keyed on `filePath`).
 */
export function extractTypeRefsForFunction(
  node: Parser.SyntaxNode,
  functionId: string,
  filePath: string,
  resolution?: TypeResolutionContext,
): TypeRefsForFunction {
  const typeRefMap = new Map<string, TypeRefEntity>();
  const hasParamEdges: HasParamEdgeDescriptor[] = [];
  const returnsEdges: ReturnsEdgeDescriptor[] = [];
  const usesTypeEdges: UsesTypeEdgeDescriptor[] = [];

  function addTypeRef(ref: TypeRefEntity): void {
    if (!typeRefMap.has(ref.id)) {
      typeRefMap.set(ref.id, ref);
    }
  }

  // ── Parameters → HAS_PARAM ────────────────────────────────────────────────
  const parametersNode = node.childForFieldName('parameters');
  if (parametersNode) {
    let position = 0;
    for (const child of parametersNode.children) {
      // Skip punctuation tokens
      if (child.type === ',' || child.type === '(' || child.type === ')') {
        continue;
      }

      let paramName: string | undefined;
      let typeName = 'unknown';
      let isOptional = false;

      if (child.type === 'identifier') {
        paramName = child.text;
        // Plain `id` with no annotation → keep 'unknown'
      } else if (child.type === 'required_parameter' || child.type === 'optional_parameter') {
        const pattern = child.childForFieldName('pattern');
        paramName = pattern?.text;
        isOptional = child.type === 'optional_parameter';

        const typeAnnotation = child.childForFieldName('type');
        if (typeAnnotation) {
          typeName = stripAnnotationColon(typeAnnotation.text);
        }
      } else if (child.type === 'rest_pattern' || child.type === 'rest_element') {
        // `...args`
        for (const inner of child.children) {
          if (inner.type === 'identifier') {
            paramName = inner.text;
            break;
          }
        }
      } else {
        // assignment_pattern or destructuring — skip type extraction for v1
        const pattern = child.childForFieldName('pattern');
        paramName = pattern?.text;
      }

      if (!paramName) continue;

      if (!typeName || typeName === '') typeName = 'unknown';

      const typeRef = makeTypeRef(typeName, filePath, resolution);
      addTypeRef(typeRef);

      hasParamEdges.push({
        fromId: functionId,
        toId: typeRef.id,
        position,
        name: paramName,
        isOptional,
      });

      position++;
    }
  }

  // ── Return type → RETURNS ─────────────────────────────────────────────────
  const returnTypeNode = node.childForFieldName('return_type');
  const isAsync = isFunctionAsync(node);

  if (returnTypeNode) {
    const typeName = stripAnnotationColon(returnTypeNode.text);
    if (typeName) {
      const typeRef = makeTypeRef(typeName, filePath, resolution);
      addTypeRef(typeRef);
      returnsEdges.push({ fromId: functionId, toId: typeRef.id, isAsync });
    }
  } else {
    // No explicit return type: emit a RETURNS edge to "inferred"
    const inferredRef = makeTypeRef('inferred', filePath, resolution);
    addTypeRef(inferredRef);
    returnsEdges.push({ fromId: functionId, toId: inferredRef.id, isAsync });
  }

  // ── Body USES_TYPE ─────────────────────────────────────────────────────────
  const bodyNode = node.childForFieldName('body');
  if (bodyNode) {
    const bodyUsages = collectBodyTypeUsages(bodyNode, filePath, resolution);

    // Deduplicate: one edge per (toId, kind) pair within this function
    const seen = new Set<string>();
    for (const { typeRef, kind } of bodyUsages) {
      const key = `${typeRef.id}::${kind}`;
      if (!seen.has(key)) {
        seen.add(key);
        addTypeRef(typeRef);
        usesTypeEdges.push({ fromId: functionId, toId: typeRef.id, kind });
      }
    }
  }

  return {
    typeRefs: Array.from(typeRefMap.values()),
    hasParamEdges,
    returnsEdges,
    usesTypeEdges,
  };
}
