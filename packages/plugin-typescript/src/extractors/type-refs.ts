/**
 * Type Reference Extractor
 *
 * Emits TypeRef entities + HAS_PARAM / RETURNS / USES_TYPE edge descriptors
 * for every function (top-level and methods) extracted from TypeScript/JavaScript.
 *
 * Identity rules (per @codegraph/plugin-common resolveTypeIdentity):
 *   - Primitives → `prim::typescript::<name>`
 *   - User types  → `type::typescript::<filePath>::<name>`
 *   - Generics stored as flat printed name (e.g. `Promise<User>`) in v1.
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
 * Strip the leading `: ` from a type annotation's raw text.
 * e.g. ": string" → "string", "string" → "string"
 */
function stripAnnotationColon(text: string): string {
  return text.replace(/^:\s*/, '').trim();
}

/**
 * Build a TypeRefEntity for the given type name scoped to the current file.
 * Primitives get a global id; user types get file-scoped ids.
 */
function makeTypeRef(name: string, filePath: string): TypeRefEntity {
  const identity = resolveTypeIdentity({
    language: 'typescript',
    name,
    definingFile: filePath,
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
        usages.push({ typeRef: makeTypeRef(typeName, filePath), kind: 'annotation' });
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
          usages.push({ typeRef: makeTypeRef(typeName, filePath), kind: 'cast' });
        }
      }
    }

    // generic_type instantiations: `new Map<K, V>()` or explicit type args
    if (node.type === 'generic_type') {
      const typeName = node.text.trim();
      if (typeName) {
        usages.push({ typeRef: makeTypeRef(typeName, filePath), kind: 'instantiation' });
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
 */
export function extractTypeRefsForFunction(
  node: Parser.SyntaxNode,
  functionId: string,
  filePath: string,
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

      const typeRef = makeTypeRef(typeName, filePath);
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
      const typeRef = makeTypeRef(typeName, filePath);
      addTypeRef(typeRef);
      returnsEdges.push({ fromId: functionId, toId: typeRef.id, isAsync });
    }
  } else {
    // No explicit return type — emit a RETURNS edge to "inferred"
    const inferredRef = makeTypeRef('inferred', filePath);
    addTypeRef(inferredRef);
    returnsEdges.push({ fromId: functionId, toId: inferredRef.id, isAsync });
  }

  // ── Body USES_TYPE ─────────────────────────────────────────────────────────
  const bodyNode = node.childForFieldName('body');
  if (bodyNode) {
    const bodyUsages = collectBodyTypeUsages(bodyNode, filePath);

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
