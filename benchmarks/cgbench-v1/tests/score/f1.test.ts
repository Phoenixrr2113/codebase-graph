import { describe, expect, it } from 'vitest';
import { f1, weightedF1 } from '../../src/score/f1.js';

describe('f1', () => {
  it('1.0 for perfect retrieval', () => {
    expect(f1(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1.0);
  });
  it('0 for no overlap', () => {
    expect(f1(new Set(['a']), new Set(['b']))).toBe(0);
  });
  it('2/3 for one of two retrieved when gold is one (P=0.5, R=1.0)', () => {
    expect(f1(new Set(['a', 'b']), new Set(['a']))).toBeCloseTo(2 / 3);
  });
  it('0 when both retrieved and gold are empty (defined)', () => {
    expect(f1(new Set(), new Set())).toBe(0);
  });
});

describe('weightedF1', () => {
  it('combines two F1 scores with weights', () => {
    expect(weightedF1(1.0, 0.5, 0.4, 0.6)).toBeCloseTo(0.4 + 0.3);
  });
  it('throws on non-summing weights', () => {
    expect(() => weightedF1(1, 1, 0.4, 0.7)).toThrow();
  });
});
