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

import type { SyntaxNode } from '@codegraph/types';

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
  'generator_function',
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
export function findEnclosingNamedEntity(node: SyntaxNode): EnclosingEntity | null {
  let current: SyntaxNode | null = node.parent;
  let wrappersCount = 0;
  let lastWrapper: SyntaxNode | null = null;

  while (current) {
    const stop = matchStopNode(current, wrappersCount);
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
 *
 * `wrappersCount` is the number of anonymous closure wrappers the walker
 * has crossed before reaching this node. It gates `variable_declarator`
 * and class-field stops: those nodes only count as named owners of the
 * call when either (a) the call lives inside a closure that is part of
 * the construction expression bound to the variable (wrappersCount > 0),
 * or (b) the variable's value is itself a function-shaped expression
 * (`const X = () => foo()`). Otherwise the variable is a plain local
 * capturing a call result (`const ctx = call()`) and the call attributes
 * to the enclosing entity instead.
 */
function matchStopNode(
  node: SyntaxNode,
  wrappersCount: number,
): Omit<EnclosingEntity, 'via'> | null {
  switch (node.type) {
    case 'function_declaration':
    case 'generator_function_declaration':
    case 'method_definition': {
      const name = node.childForFieldName('name')?.text;
      if (!name) return null;
      return { kind: 'Function', name, startLine: node.startPosition.row + 1 };
    }
    case 'function_expression':
    case 'generator_function': {
      // Named ones are Function stops (e.g. `const X = function foo() { ... }`
      // or the rare `const X = function* foo() { ... }`). Anonymous ones fall
      // through to null and are picked up by isAnonymousWrapper instead.
      const name = node.childForFieldName('name')?.text;
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
      // `const X = () => foo()` — the arrow IS X's value, so X owns the
      // closure's calls. Stop here.
      // `const slice = createSlice({...arrow...})` — the call site is
      // inside an arrow that's part of slice's construction. wrappersCount
      // > 0 because we crossed the arrow on the way up. Stop here.
      // `const ctx = initializeContext()` — no closure between the call
      // and the declarator, value is not function-shaped. ctx is a local
      // capturing a result, not a meaningful caller. Walk past.
      if (!hasFunctionValue(node) && wrappersCount === 0) return null;
      const name = node.childForFieldName('name')?.text;
      if (!name) return null;
      return { kind: 'Variable', name, startLine: node.startPosition.row + 1 };
    }
    case 'public_field_definition':
    case 'class_property':
    case 'property_definition': {
      // Same rule for class fields: stop when the field's value is a
      // function-shaped expression (the field owns the closure), or when
      // the call is inside a closure bound to the field's value
      // (wrappersCount > 0). Otherwise — a plain `count = compute()`
      // initialiser — walk past to the enclosing class.
      if (!hasFunctionValue(node) && wrappersCount === 0) return null;
      const name = node.childForFieldName('name')?.text;
      if (!name) return null;
      return { kind: 'Variable', name, startLine: node.startPosition.row + 1 };
    }
    default:
      return null;
  }
}

function isAnonymousWrapper(node: SyntaxNode): boolean {
  if (!ANONYMOUS_WRAPPER_TYPES.has(node.type)) return false;
  // If a function_expression or generator_function has a name, it's NOT an
  // anonymous wrapper — matchStopNode would catch it (named function_expression
  // is already a stop; a hypothetical named generator_function would be too).
  // arrow_function never has a name.
  if (node.type === 'function_expression' || node.type === 'generator_function') {
    const nameField = node.childForFieldName('name');
    if (nameField) return false;
  }
  return true;
}

const FUNCTION_VALUE_TYPES = new Set([
  'arrow_function',
  'function_expression',
  'generator_function',
]);

/**
 * Returns true if the given node has a `value` field whose type is a
 * function-shaped expression. Used to gate when variable_declarator and
 * class field nodes count as named owners of a closure.
 */
function hasFunctionValue(node: SyntaxNode): boolean {
  const value = node.childForFieldName('value');
  if (!value) return false;
  return FUNCTION_VALUE_TYPES.has(value.type);
}
