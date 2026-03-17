/**
 * Universal Complexity Analyzer — Tests across all 7 supported languages
 *
 * Verifies that calculateComplexity produces correct cyclomatic, cognitive,
 * and nesting depth metrics for TypeScript, Python, Java, Go, Rust, C#, and PHP
 * using real tree-sitter parsers.
 */

import { describe, it, expect } from 'vitest';
import Parser from 'tree-sitter';
import typescript from 'tree-sitter-typescript';
import python from 'tree-sitter-python';
import java from 'tree-sitter-java';
import go from 'tree-sitter-go';
import rust from 'tree-sitter-rust';
import php from 'tree-sitter-php';
import csharp from 'tree-sitter-c-sharp';
import {
  calculateComplexity,
  calculateCyclomatic,
  calculateCognitive,
  calculateNestingDepth,
  classifyComplexity,
  COMPLEXITY_THRESHOLDS,
} from '../complexity';

// ============================================================================
// Helpers
// ============================================================================

function parse(grammar: unknown, code: string): Parser.SyntaxNode {
  const parser = new Parser();
  parser.setLanguage(grammar as Parser.Language);
  return parser.parse(code).rootNode;
}

/** Find the first function/method node in a parse tree */
function findFunction(root: Parser.SyntaxNode, types: string[]): Parser.SyntaxNode {
  function walk(n: Parser.SyntaxNode): Parser.SyntaxNode | null {
    if (types.includes(n.type)) return n;
    for (const c of n.children) {
      const found = walk(c);
      if (found) return found;
    }
    return null;
  }
  const result = walk(root);
  if (!result) throw new Error(`No function node found (types: ${types.join(', ')})`);
  return result;
}

const tsGrammar = (typescript as any).typescript;
const phpGrammar = (php as any).php;

// ============================================================================
// TypeScript
// ============================================================================

describe('TypeScript', () => {
  const funcTypes = ['function_declaration', 'arrow_function', 'method_definition'];

  it('empty function → cyclomatic 1, cognitive 0, nesting 0', () => {
    const root = parse(tsGrammar, 'function foo() {}');
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBe(1);
    expect(m.cognitive).toBe(0);
    expect(m.nestingDepth).toBe(0);
  });

  it('single if → cyclomatic 2, cognitive 1, nesting 1', () => {
    const root = parse(tsGrammar, 'function foo(x: boolean) { if (x) { return 1; } }');
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBe(2);
    expect(m.cognitive).toBe(1);
    expect(m.nestingDepth).toBe(1);
  });

  it('if-else → cyclomatic 3, nesting 1', () => {
    const root = parse(tsGrammar, 'function foo(x: boolean) { if (x) { return 1; } else { return 2; } }');
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBe(3); // if + else
    expect(m.nestingDepth).toBe(1);
  });

  it('for + while + if → cyclomatic 4, nesting 3', () => {
    const root = parse(tsGrammar, `function foo(arr: number[]) {
      for (const x of arr) {
        while (x > 0) {
          if (x === 1) { break; }
        }
      }
    }`);
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBe(4); // for + while + if
    expect(m.nestingDepth).toBe(3);
  });

  it('logical operators && || count', () => {
    const root = parse(tsGrammar, 'function foo(a: boolean, b: boolean, c: boolean) { if (a && b || c) { return 1; } }');
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBe(4); // 1 + if + && + ||
  });

  it('try-catch counts', () => {
    const root = parse(tsGrammar, 'function foo() { try { throw 1; } catch (e) { return 0; } }');
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBe(2); // catch
    expect(m.nestingDepth).toBe(2); // try + catch
  });

  it('arrow function works', () => {
    const root = parse(tsGrammar, 'const foo = (x: number) => { if (x > 0) { return x; } return 0; };');
    const fn = findFunction(root, ['arrow_function']);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBe(2);
  });
});

// ============================================================================
// Python
// ============================================================================

describe('Python', () => {
  const funcTypes = ['function_definition'];

  it('empty function → cyclomatic 1', () => {
    const root = parse(python, 'def foo():\n  pass');
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBe(1);
    expect(m.cognitive).toBe(0);
    expect(m.nestingDepth).toBe(0);
  });

  it('if-elif-else', () => {
    const root = parse(python, `def foo(x):
  if x > 0:
    return 1
  elif x == 0:
    return 0
  else:
    return -1`);
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBe(4); // if + elif + else
    expect(m.nestingDepth).toBe(1);
  });

  it('for + while + if nested', () => {
    const root = parse(python, `def foo(items):
  for item in items:
    while item > 0:
      if item == 1:
        break`);
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBeGreaterThanOrEqual(4); // for + while + if + break
    expect(m.nestingDepth).toBe(3);
  });

  it('Python and/or operators count', () => {
    const root = parse(python, `def foo(a, b, c):
  if a and b or c:
    return True`);
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    // if + and + or = 4
    expect(m.cyclomatic).toBeGreaterThanOrEqual(4);
  });

  it('try-except counts', () => {
    const root = parse(python, `def foo():
  try:
    return 1
  except ValueError:
    return 0`);
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBe(2); // except
  });

  it('with statement adds nesting', () => {
    const root = parse(python, `def foo():
  with open('f') as h:
    if h:
      pass`);
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.nestingDepth).toBe(2); // with + if
  });
});

// ============================================================================
// Java
// ============================================================================

describe('Java', () => {
  const funcTypes = ['method_declaration', 'constructor_declaration'];

  it('empty method → cyclomatic 1', () => {
    const root = parse(java, 'class A { void foo() {} }');
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBe(1);
  });

  it('if + for + while nested', () => {
    const root = parse(java, `class A {
      void foo(int[] arr) {
        if (arr != null) {
          for (int i = 0; i < arr.length; i++) {
            while (arr[i] > 0) {
              arr[i]--;
            }
          }
        }
      }
    }`);
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBe(4); // if + for + while
    expect(m.nestingDepth).toBe(3);
  });

  it('try-catch + && count', () => {
    const root = parse(java, `class A {
      void foo(boolean a, boolean b) {
        try {
          if (a && b) { throw new Exception(); }
        } catch (Exception e) {
          return;
        }
      }
    }`);
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBeGreaterThanOrEqual(4); // if + && + catch
  });
});

// ============================================================================
// Go
// ============================================================================

describe('Go', () => {
  const funcTypes = ['function_declaration', 'method_declaration'];

  it('empty function → cyclomatic 1', () => {
    const root = parse(go, 'package main\nfunc foo() {}');
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBe(1);
  });

  it('if + for range + if nested', () => {
    const root = parse(go, `package main
func foo(items []int) {
  if len(items) > 0 {
    for _, item := range items {
      if item > 0 {
        continue
      }
    }
  }
}`);
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBeGreaterThanOrEqual(3); // if + for + if
    expect(m.nestingDepth).toBeGreaterThanOrEqual(3);
  });

  it('logical operators count', () => {
    const root = parse(go, `package main
func foo(a bool, b bool) {
  if a && b {
    return
  }
}`);
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBeGreaterThanOrEqual(3); // if + &&
  });
});

// ============================================================================
// Rust
// ============================================================================

describe('Rust', () => {
  const funcTypes = ['function_item'];

  it('empty function → cyclomatic 1', () => {
    const root = parse(rust, 'fn foo() {}');
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBe(1);
  });

  it('if + for + while nested', () => {
    const root = parse(rust, `fn foo(items: Vec<i32>) {
  if !items.is_empty() {
    for item in &items {
      while *item > 0 {
        break;
      }
    }
  }
}`);
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBeGreaterThanOrEqual(3); // if + for + while
    expect(m.nestingDepth).toBeGreaterThanOrEqual(3);
  });

  it('match arms count as decision points', () => {
    const root = parse(rust, `fn foo(x: i32) -> &str {
  match x {
    1 => "one",
    2 => "two",
    _ => "other",
  }
}`);
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBeGreaterThanOrEqual(4); // 3 match arms
  });

  it('loop expression counts', () => {
    const root = parse(rust, `fn foo() {
  loop {
    if true {
      break;
    }
  }
}`);
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBeGreaterThanOrEqual(2); // loop + if
    expect(m.nestingDepth).toBeGreaterThanOrEqual(2);
  });

  it('&& || operators count', () => {
    const root = parse(rust, `fn foo(a: bool, b: bool, c: bool) {
  if a && b || c {
    return;
  }
}`);
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBeGreaterThanOrEqual(4); // if + && + ||
  });
});

// ============================================================================
// C#
// ============================================================================

describe('C#', () => {
  const funcTypes = ['method_declaration', 'constructor_declaration'];

  it('empty method → cyclomatic 1', () => {
    const root = parse(csharp, 'class A { void Foo() {} }');
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBe(1);
  });

  it('if + foreach + while nested', () => {
    const root = parse(csharp, `class A {
  void Foo(int[] items) {
    if (items != null) {
      foreach (var item in items) {
        while (item > 0) {
          item--;
        }
      }
    }
  }
}`);
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBeGreaterThanOrEqual(4); // if + foreach + while
    expect(m.nestingDepth).toBe(3);
  });

  it('try-catch + && count', () => {
    const root = parse(csharp, `class A {
  void Foo(bool a, bool b) {
    try {
      if (a && b) { throw new Exception(); }
    } catch (Exception e) {
      return;
    }
  }
}`);
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBeGreaterThanOrEqual(4); // if + && + catch
  });
});

// ============================================================================
// PHP
// ============================================================================

describe('PHP', () => {
  const funcTypes = ['function_definition', 'method_declaration'];

  it('empty function → cyclomatic 1', () => {
    const root = parse(phpGrammar, '<?php function foo() {}');
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBe(1);
  });

  it('if + foreach + while nested', () => {
    const root = parse(phpGrammar, `<?php function foo($items) {
  if ($items) {
    foreach ($items as $item) {
      while ($item > 0) {
        $item--;
      }
    }
  }
}`);
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBeGreaterThanOrEqual(4); // if + foreach + while
    expect(m.nestingDepth).toBe(3);
  });

  it('try-catch + switch-case count', () => {
    const root = parse(phpGrammar, `<?php function foo($x) {
  try {
    switch ($x) {
      case 1: return "one";
      case 2: return "two";
    }
  } catch (Exception $e) {
    return "error";
  }
}`);
    const fn = findFunction(root, funcTypes);
    const m = calculateComplexity(fn);
    expect(m.cyclomatic).toBeGreaterThanOrEqual(4); // 2 cases + catch
  });
});

// ============================================================================
// classifyComplexity
// ============================================================================

describe('classifyComplexity', () => {
  it('low complexity', () => {
    expect(classifyComplexity({ cyclomatic: 5, cognitive: 10, nestingDepth: 2 })).toBe('low');
  });

  it('medium complexity', () => {
    expect(classifyComplexity({ cyclomatic: 15, cognitive: 20, nestingDepth: 4 })).toBe('medium');
  });

  it('high complexity', () => {
    expect(classifyComplexity({ cyclomatic: 25, cognitive: 35, nestingDepth: 5 })).toBe('high');
  });

  it('critical complexity', () => {
    expect(classifyComplexity({ cyclomatic: 55, cognitive: 10, nestingDepth: 2 })).toBe('critical');
  });

  it('thresholds are accessible', () => {
    expect(COMPLEXITY_THRESHOLDS.cyclomatic.low).toBe(10);
    expect(COMPLEXITY_THRESHOLDS.cognitive.low).toBe(15);
    expect(COMPLEXITY_THRESHOLDS.nesting.acceptable).toBe(4);
  });
});

// ============================================================================
// Individual function exports
// ============================================================================

describe('individual metric functions', () => {
  it('calculateCyclomatic returns just cyclomatic', () => {
    const root = parse(tsGrammar, 'function foo(x: boolean) { if (x) { return 1; } }');
    const fn = findFunction(root, ['function_declaration']);
    expect(calculateCyclomatic(fn)).toBe(2);
  });

  it('calculateCognitive returns just cognitive', () => {
    const root = parse(tsGrammar, 'function foo(x: boolean) { if (x) { return 1; } }');
    const fn = findFunction(root, ['function_declaration']);
    expect(calculateCognitive(fn)).toBe(1);
  });

  it('calculateNestingDepth returns just nesting', () => {
    const root = parse(tsGrammar, 'function foo(x: boolean) { if (x) { if (x) {} } }');
    const fn = findFunction(root, ['function_declaration']);
    expect(calculateNestingDepth(fn)).toBe(2);
  });
});
