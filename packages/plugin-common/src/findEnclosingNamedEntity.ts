/**
 * findEnclosingNamedEntity — Walk up the AST from any node looking for the
 * nearest ancestor that has a name we can attribute work to.
 *
 * Used by the calls extractor (and other extractors that need to attribute
 * a non-named site like an anonymous arrow function). The algorithm is:
 *
 *   1. Start at the input node's parent.
 *   2. If the parent is a "stop" type (Function, Variable, Class, Interface,
 *      named function expression, class field, method), return its descriptor.
 *   3. Otherwise, walk up another level. Track whether we passed through any
 *      anonymous function-shaped nodes — if so, the result is `via: 'closure'`.
 *      If we reached the stop in one hop without crossing an anonymous wrapper,
 *      it's `via: 'direct'`.
 *   4. If we walk all the way to the program root with no stop, return null —
 *      the call has no useful named owner (top-level expression / IIFE).
 *
 * The helper is grammar-specific to tree-sitter-typescript node names. Other
 * languages will need their own stop-node sets but can share the structure
 * via a future generalization.
 */

import type Parser from 'tree-sitter';

export type EnclosingKind = 'Function' | 'Variable' | 'Class' | 'Interface';

export interface EnclosingEntity {
  kind: EnclosingKind;
  name: string;
  /** 1-based startLine of the enclosing entity (matches FunctionEntity.startLine). */
  startLine: number;
  /** 'direct' if the call is in the lexical body of the entity with no anonymous wrappers; 'closure' otherwise. */
  via: 'direct' | 'closure';
}

const ANONYMOUS_WRAPPER_TYPES = new Set([
  'arrow_function',
  'function_expression',
]);

/**
 * Given an AST node (typically a `call_expression`), return the nearest named
 * ancestor entity, or null if the node has no named owner.
 *
 * `via` semantics:
 *   - 'direct' means the call is in the lexical body of the named entity.
 *     Two sub-cases qualify: (a) zero anonymous wrappers crossed (e.g., call
 *     in a function or method body), or (b) exactly one anonymous wrapper
 *     crossed AND that wrapper is the immediate value of the named entity
 *     (e.g., `const X = () => foo()` — the arrow IS X's value, not wrapped
 *     in something else).
 *   - 'closure' means the call passes through wrapping context that's not
 *     the entity's own body — at least one anonymous wrapper plus an
 *     intermediate non-stop node like a `call_expression` (factory pattern),
 *     `pair` (object-literal property), `jsx_attribute`, or another
 *     anonymous wrapper (nested closures).
 */
export function findEnclosingNamedEntity(node: Parser.SyntaxNode): EnclosingEntity | null {
  let current: Parser.SyntaxNode | null = node.parent;
  let wrappersCount = 0;
  let lastWrapper: Parser.SyntaxNode | null = null;

  while (current) {
    const stop = matchStopNode(current);
    if (stop) {
      let via: 'direct' | 'closure';
      if (wrappersCount === 0) {
        via = 'direct';
      } else if (wrappersCount === 1 && lastWrapper?.parent === current) {
        // Exactly one wrapper, and the wrapper sits immediately under the
        // named stop. The arrow IS the entity's body — not a callback the
        // entity passes elsewhere.
        via = 'direct';
      } else {
        via = 'closure';
      }
      return { ...stop, via };
    }
    if (isAnonymousWrapper(current)) {
      wrappersCount++;
      lastWrapper = current;
    }
    current = current.parent;
  }

  return null;
}

/**
 * If the node is a stop type (yields a name), return the entity descriptor
 * (without the `via` field — caller fills that in). Otherwise null.
 */
function matchStopNode(node: Parser.SyntaxNode): Omit<EnclosingEntity, 'via'> | null {
  switch (node.type) {
    case 'function_declaration':
    case 'method_definition': {
      const name = node.childForFieldName('name')?.text;
      if (!name) return null;
      return { kind: 'Function', name, startLine: node.startPosition.row + 1 };
    }
    case 'function_expression': {
      const name = node.childForFieldName('name')?.text;
      // Anonymous function_expression — keep walking. Don't return as a stop.
      if (!name) return null;
      return { kind: 'Function', name, startLine: node.startPosition.row + 1 };
    }
    case 'class_declaration': {
      const name = node.childForFieldName('name')?.text;
      if (!name) return null;
      return { kind: 'Class', name, startLine: node.startPosition.row + 1 };
    }
    case 'interface_declaration': {
      const name = node.childForFieldName('name')?.text;
      if (!name) return null;
      return { kind: 'Interface', name, startLine: node.startPosition.row + 1 };
    }
    case 'variable_declarator': {
      const name = node.childForFieldName('name')?.text;
      if (!name) return null;
      return { kind: 'Variable', name, startLine: node.startPosition.row + 1 };
    }
    case 'public_field_definition':
    case 'class_property':
    case 'property_definition': {
      // Class field — `prop = () => …`. Treat the field as a Variable-shaped
      // owner; CodeGraph models class fields as Variable entities.
      const name = node.childForFieldName('name')?.text;
      if (!name) return null;
      return { kind: 'Variable', name, startLine: node.startPosition.row + 1 };
    }
    default:
      return null;
  }
}

function isAnonymousWrapper(node: Parser.SyntaxNode): boolean {
  if (!ANONYMOUS_WRAPPER_TYPES.has(node.type)) return false;
  // If a function_expression has a name, it's NOT an anonymous wrapper —
  // matchStopNode will catch it. arrow_function never has a name.
  if (node.type === 'function_expression') {
    const nameField = node.childForFieldName('name');
    if (nameField) return false;
  }
  return true;
}
