import { describe, it, expect } from 'vitest';
import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import { findEnclosingNamedEntity } from '../findEnclosingNamedEntity';

const parser = new Parser();
// Cast workaround mirrors complexity.test.ts:33 — tree-sitter-typescript's
// language object isn't directly assignable to Parser.Language under the
// installed @types/tree-sitter version.
parser.setLanguage(TypeScript.typescript as Parser.Language);

function parseTS(code: string): Parser.SyntaxNode {
  return parser.parse(code).rootNode;
}

/** Find the first call_expression node whose function name matches `calleeName`. */
function firstCallTo(root: Parser.SyntaxNode, calleeName: string): Parser.SyntaxNode {
  function walk(n: Parser.SyntaxNode): Parser.SyntaxNode | null {
    if (n.type === 'call_expression') {
      const fn = n.childForFieldName('function');
      if (fn?.text === calleeName) return n;
      if (fn?.type === 'member_expression') {
        const prop = fn.childForFieldName('property');
        if (prop?.text === calleeName) return n;
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const found = walk(n.namedChild(i)!);
      if (found) return found;
    }
    return null;
  }
  const found = walk(root);
  if (!found) throw new Error(`No call to ${calleeName} found`);
  return found;
}

describe('findEnclosingNamedEntity', () => {
  it('arrow assigned to const → Variable caller, direct', () => {
    const root = parseTS(`const X = () => foo();`);
    const callNode = firstCallTo(root, 'foo');
    expect(findEnclosingNamedEntity(callNode)).toEqual({
      kind: 'Variable',
      name: 'X',
      startLine: 1,
      via: 'direct',
    });
  });

  it('arrow as factory argument → Variable caller, closure', () => {
    const root = parseTS(
      `const checker = createCheck("multipleOf", (inst, def) => { foo(); });`,
    );
    const callNode = firstCallTo(root, 'foo');
    expect(findEnclosingNamedEntity(callNode)).toEqual({
      kind: 'Variable',
      name: 'checker',
      startLine: 1,
      via: 'closure',
    });
  });

  it('callback inside named function → Function caller, closure', () => {
    const root = parseTS(
      `function processItems(items) {\n  items.map(x => transform(x));\n}`,
    );
    const callNode = firstCallTo(root, 'transform');
    expect(findEnclosingNamedEntity(callNode)).toEqual({
      kind: 'Function',
      name: 'processItems',
      startLine: 1,
      via: 'closure',
    });
  });

  it('class arrow field → Variable caller (class field), direct', () => {
    const root = parseTS(`class Foo {\n  handler = () => doWork();\n}`);
    const callNode = firstCallTo(root, 'doWork');
    expect(findEnclosingNamedEntity(callNode)).toEqual({
      kind: 'Variable',
      name: 'handler',
      startLine: 2,
      via: 'direct',
    });
  });

  it('method body call → Function caller, direct', () => {
    const root = parseTS(`class Foo {\n  method() { bar(); }\n}`);
    const callNode = firstCallTo(root, 'bar');
    expect(findEnclosingNamedEntity(callNode)).toEqual({
      kind: 'Function',
      name: 'method',
      startLine: 2,
      via: 'direct',
    });
  });

  it('top-level IIFE → null', () => {
    const root = parseTS(`(() => { boot(); })();`);
    const callNode = firstCallTo(root, 'boot');
    expect(findEnclosingNamedEntity(callNode)).toBeNull();
  });

  it('top-level bare call → null', () => {
    const root = parseTS(`globalSetup();`);
    const callNode = firstCallTo(root, 'globalSetup');
    expect(findEnclosingNamedEntity(callNode)).toBeNull();
  });

  it('nested anonymous arrows inside Variable → Variable caller, closure', () => {
    const root = parseTS(
      `const X = factory(() => () => () => deeplyNested());`,
    );
    const callNode = firstCallTo(root, 'deeplyNested');
    expect(findEnclosingNamedEntity(callNode)).toEqual({
      kind: 'Variable',
      name: 'X',
      startLine: 1,
      via: 'closure',
    });
  });

  it('object-literal property arrow inside Variable → Variable caller, closure', () => {
    const root = parseTS(
      `const slice = createSlice({\n  reducers: {\n    increment: (state) => bumpCounter(state),\n  },\n});`,
    );
    const callNode = firstCallTo(root, 'bumpCounter');
    expect(findEnclosingNamedEntity(callNode)).toEqual({
      kind: 'Variable',
      name: 'slice',
      startLine: 1,
      via: 'closure',
    });
  });

  it('function declaration body → Function caller, direct', () => {
    const root = parseTS(`function outer() { inner(); }`);
    const callNode = firstCallTo(root, 'inner');
    expect(findEnclosingNamedEntity(callNode)).toEqual({
      kind: 'Function',
      name: 'outer',
      startLine: 1,
      via: 'direct',
    });
  });

  it('generator function declaration → Function caller, direct', () => {
    const root = parseTS(`function* gen() { foo(); }`);
    const callNode = firstCallTo(root, 'foo');
    expect(findEnclosingNamedEntity(callNode)).toEqual({
      kind: 'Function',
      name: 'gen',
      startLine: 1,
      via: 'direct',
    });
  });

  it('anonymous generator assigned to const → Variable caller, direct', () => {
    // generator_function (no _declaration) wrapped in variable_declarator.
    // The wrapper IS X's value (no intermediate call_expression / pair),
    // so via='direct' — consistent with the arrow-as-value rule.
    const root = parseTS(`const X = function*() { foo(); };`);
    const callNode = firstCallTo(root, 'foo');
    expect(findEnclosingNamedEntity(callNode)).toEqual({
      kind: 'Variable',
      name: 'X',
      startLine: 1,
      via: 'direct',
    });
  });

  it('local const = call result inside named function → enclosing Function caller, direct', () => {
    // Regression: `const ctx = call()` inside outer's body should attribute
    // call() to outer, NOT to ctx. ctx is a local capture, not a closure-bound
    // entity. (Caught by cgbench iter-9 — Task B regression.)
    const root = parseTS(
      `function outer() {\n  const ctx = initializeContext();\n}`,
    );
    const callNode = firstCallTo(root, 'initializeContext');
    expect(findEnclosingNamedEntity(callNode)).toEqual({
      kind: 'Function',
      name: 'outer',
      startLine: 1,
      via: 'direct',
    });
  });

  it('local const = call result at top level → null', () => {
    // Sibling case to the above: `const ctx = call()` at top level has no
    // useful enclosing entity. Should drop the call.
    const root = parseTS(`const ctx = initializeContext();`);
    const callNode = firstCallTo(root, 'initializeContext');
    expect(findEnclosingNamedEntity(callNode)).toBeNull();
  });

  it('class field with non-function value inside method → enclosing Function caller, direct', () => {
    // class field `count = compute()` is initialised by a call, not a closure.
    // The call belongs to the enclosing method body if the field is read
    // inside a method, but here we test reading the call from inside the
    // field initialiser AT CLASS BODY LEVEL — should walk up to the class.
    const root = parseTS(
      `class Foo {\n  count = compute();\n}`,
    );
    const callNode = firstCallTo(root, 'compute');
    expect(findEnclosingNamedEntity(callNode)).toEqual({
      kind: 'Class',
      name: 'Foo',
      startLine: 1,
      via: 'direct',
    });
  });
});
