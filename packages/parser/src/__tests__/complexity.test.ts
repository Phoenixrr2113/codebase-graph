/**
 * Complexity Calculator Tests
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  initParser,
  parseCode,
  disposeParser,
} from '../index';
import {
  calculateComplexity,
  calculateCyclomatic,
  calculateCognitive,
  calculateNestingDepth,
  classifyComplexity,
} from '../analysis/complexity';
import type Parser from 'tree-sitter';

// Initialize parser before tests
beforeAll(async () => {
  await initParser();
});

afterAll(() => {
  disposeParser();
});

/**
 * Helper to parse code and get the first function node
 */
function parseFunction(code: string): Parser.SyntaxNode {
  const { rootNode } = parseCode(code, 'typescript');
  // Find the first function in the tree
  function findFunction(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
    if (
      node.type === 'function_declaration' ||
      node.type === 'arrow_function' ||
      node.type === 'method_definition'
    ) {
      return node;
    }
    for (const child of node.children) {
      const found = findFunction(child);
      if (found) return found;
    }
    return null;
  }
  const fn = findFunction(rootNode);
  if (!fn) {
    throw new Error('No function found in code');
  }
  return fn;
}

describe('calculateCyclomatic', () => {
  it('should return 1 for an empty function', () => {
    const code = `function empty() {}`;
    const fn = parseFunction(code);
    expect(calculateCyclomatic(fn)).toBe(1);
  });

  it('should return 1 for a linear function', () => {
    const code = `
      function linear() {
        const a = 1;
        const b = 2;
        return a + b;
      }
    `;
    const fn = parseFunction(code);
    expect(calculateCyclomatic(fn)).toBe(1);
  });

  it('should add 1 for each if statement', () => {
    const code = `
      function withIf(x: number) {
        if (x > 0) {
          return 'positive';
        }
        return 'non-positive';
      }
    `;
    const fn = parseFunction(code);
    expect(calculateCyclomatic(fn)).toBe(2); // 1 base + 1 if
  });

  it('should count else clauses', () => {
    const code = `
      function withIfElse(x: number) {
        if (x > 0) {
          return 'positive';
        } else {
          return 'non-positive';
        }
      }
    `;
    const fn = parseFunction(code);
    expect(calculateCyclomatic(fn)).toBe(3); // 1 base + 1 if + 1 else
  });

  it('should count for loops', () => {
    const code = `
      function withLoop(arr: number[]) {
        for (const item of arr) {
          console.log(item);
        }
      }
    `;
    const fn = parseFunction(code);
    expect(calculateCyclomatic(fn)).toBe(2); // 1 base + 1 for
  });

  it('should count while loops', () => {
    const code = `
      function withWhile(n: number) {
        while (n > 0) {
          n--;
        }
      }
    `;
    const fn = parseFunction(code);
    expect(calculateCyclomatic(fn)).toBe(2); // 1 base + 1 while
  });

  it('should count logical operators', () => {
    const code = `
      function withLogical(a: boolean, b: boolean) {
        if (a && b) {
          return true;
        }
        return false;
      }
    `;
    const fn = parseFunction(code);
    expect(calculateCyclomatic(fn)).toBe(3); // 1 base + 1 if + 1 &&
  });

  it('should count ternary expressions', () => {
    const code = `
      function withTernary(x: number) {
        return x > 0 ? 'positive' : 'non-positive';
      }
    `;
    const fn = parseFunction(code);
    // Ternary adds 1
    expect(calculateCyclomatic(fn)).toBeGreaterThanOrEqual(2);
  });

  it('should count catch clauses', () => {
    const code = `
      function withTryCatch() {
        try {
          doSomething();
        } catch (e) {
          handleError(e);
        }
      }
    `;
    const fn = parseFunction(code);
    expect(calculateCyclomatic(fn)).toBe(2); // 1 base + 1 catch
  });

  it('should handle complex function', () => {
    const code = `
      function complex(items: string[], filter: boolean) {
        let result: string[] = [];
        for (const item of items) {
          if (filter && item.length > 0) {
            if (item.startsWith('a') || item.startsWith('b')) {
              result.push(item);
            }
          }
        }
        return result;
      }
    `;
    const fn = parseFunction(code);
    // 1 base + 1 for + 2 if + 1 && + 1 ||
    expect(calculateCyclomatic(fn)).toBe(6);
  });
});

describe('calculateCognitive', () => {
  it('should return 0 for a linear function', () => {
    const code = `
      function linear() {
        const a = 1;
        return a;
      }
    `;
    const fn = parseFunction(code);
    expect(calculateCognitive(fn)).toBe(0);
  });

  it('should add for if statements', () => {
    const code = `
      function simple(x: number) {
        if (x > 0) {
          return true;
        }
        return false;
      }
    `;
    const fn = parseFunction(code);
    // +1 for the if (at nesting 0)
    expect(calculateCognitive(fn)).toBe(1);
  });

  it('should add nesting penalties', () => {
    const code = `
      function nested(x: number, y: number) {
        if (x > 0) {
          if (y > 0) {
            return 'both positive';
          }
        }
        return 'not both positive';
      }
    `;
    const fn = parseFunction(code);
    // Outer if: +1 (at nesting 0) = 1
    // Inner if: +1 (base) +1 (nesting) = 2
    // Total: 3
    expect(calculateCognitive(fn)).toBe(3);
  });

  it('should count logical operators', () => {
    const code = `
      function logical(a: boolean, b: boolean) {
        if (a && b || !a) {
          return true;
        }
        return false;
      }
    `;
    const fn = parseFunction(code);
    // +1 for if + 1 for && + 1 for ||
    expect(calculateCognitive(fn)).toBeGreaterThanOrEqual(3);
  });
});

describe('calculateNestingDepth', () => {
  it('should return 0 for a flat function', () => {
    const code = `
      function flat() {
        const a = 1;
        return a;
      }
    `;
    const fn = parseFunction(code);
    expect(calculateNestingDepth(fn)).toBe(0);
  });

  it('should return 1 for single nesting', () => {
    const code = `
      function oneDeep(x: number) {
        if (x > 0) {
          return true;
        }
        return false;
      }
    `;
    const fn = parseFunction(code);
    expect(calculateNestingDepth(fn)).toBe(1);
  });

  it('should return max depth for nested structures', () => {
    const code = `
      function threeDeep(x: number, y: number, z: number) {
        if (x > 0) {
          for (let i = 0; i < y; i++) {
            while (z > 0) {
              z--;
            }
          }
        }
      }
    `;
    const fn = parseFunction(code);
    expect(calculateNestingDepth(fn)).toBe(3);
  });
});

describe('calculateComplexity', () => {
  it('should return all metrics', () => {
    const code = `
      function example(items: number[]) {
        let sum = 0;
        for (const item of items) {
          if (item > 0) {
            sum += item;
          }
        }
        return sum;
      }
    `;
    const fn = parseFunction(code);
    const metrics = calculateComplexity(fn);

    expect(metrics).toHaveProperty('cyclomatic');
    expect(metrics).toHaveProperty('cognitive');
    expect(metrics).toHaveProperty('nestingDepth');
    expect(metrics.cyclomatic).toBeGreaterThanOrEqual(3); // 1 + for + if
    expect(metrics.nestingDepth).toBe(2); // for > if
  });
});

describe('classifyComplexity', () => {
  it('should classify low complexity', () => {
    expect(classifyComplexity({ cyclomatic: 5, cognitive: 8, nestingDepth: 2 })).toBe('low');
  });

  it('should classify medium complexity', () => {
    expect(classifyComplexity({ cyclomatic: 15, cognitive: 20, nestingDepth: 4 })).toBe('medium');
  });

  it('should classify high complexity', () => {
    expect(classifyComplexity({ cyclomatic: 25, cognitive: 35, nestingDepth: 5 })).toBe('high');
  });

  it('should classify critical complexity', () => {
    expect(classifyComplexity({ cyclomatic: 55, cognitive: 40, nestingDepth: 7 })).toBe('critical');
  });
});
