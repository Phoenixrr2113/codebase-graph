import { describe, expect, it } from 'vitest';
import { recallAtK, precisionAtK } from '../../src/score/recall.js';

describe('recallAtK', () => {
  it('1.0 when all gold are in top k', () => {
    expect(recallAtK(['a', 'b', 'c'], new Set(['a', 'b']), 5)).toBe(1.0);
  });
  it('0.5 when 1 of 2 gold are in top k', () => {
    expect(recallAtK(['a', 'x', 'y', 'b'], new Set(['a', 'b']), 2)).toBe(0.5);
  });
  it('0 when no gold in top k', () => {
    expect(recallAtK(['x', 'y'], new Set(['a']), 5)).toBe(0);
  });
  it('0 when gold is empty (defined as 0, not NaN)', () => {
    expect(recallAtK(['a'], new Set(), 1)).toBe(0);
  });
});

describe('precisionAtK', () => {
  it('1.0 when all top k are gold', () => {
    expect(precisionAtK(['a', 'b'], new Set(['a', 'b', 'c']), 2)).toBe(1.0);
  });
  it('0.5 when half of top k are gold', () => {
    expect(precisionAtK(['a', 'x'], new Set(['a']), 2)).toBe(0.5);
  });
  it('returns 0 when k > ranking length and no hits', () => {
    expect(precisionAtK(['x'], new Set(['a']), 5)).toBe(0);
  });
});
