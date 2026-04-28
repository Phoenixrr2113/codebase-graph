import { describe, expect, it } from 'vitest';
import { mrr, reciprocalRank } from '../../src/score/mrr.js';

describe('reciprocalRank', () => {
  it('returns 1.0 when first result is gold', () => {
    expect(reciprocalRank(['a', 'b', 'c'], new Set(['a']))).toBe(1.0);
  });
  it('returns 1/3 when third result is gold', () => {
    expect(reciprocalRank(['a', 'b', 'c'], new Set(['c']))).toBeCloseTo(1 / 3);
  });
  it('returns 0 when no result is gold', () => {
    expect(reciprocalRank(['a', 'b'], new Set(['z']))).toBe(0);
  });
  it('counts the first matching gold (multi-gold)', () => {
    expect(reciprocalRank(['x', 'b', 'a'], new Set(['a', 'b']))).toBeCloseTo(1 / 2);
  });
});

describe('mrr', () => {
  it('averages reciprocal ranks across queries', () => {
    const rankings = [['a'], ['b', 'a'], ['c', 'b', 'a']];
    const golds = [new Set(['a']), new Set(['a']), new Set(['a'])];
    expect(mrr(rankings, golds)).toBeCloseTo((1 + 0.5 + 1 / 3) / 3);
  });
  it('returns 0 when all queries miss', () => {
    expect(mrr([['a'], ['b']], [new Set(['z']), new Set(['z'])])).toBe(0);
  });
  it('throws on length mismatch', () => {
    expect(() => mrr([['a']], [new Set(['a']), new Set(['b'])])).toThrow();
  });
});
