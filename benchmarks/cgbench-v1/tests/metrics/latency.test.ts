import { describe, expect, it } from 'vitest';
import { aggregate, percentile } from '../../src/metrics/latency.js';

describe('percentile', () => {
  it('p50 of [10,20,30,40,50] = 30 (midpoint of sorted)', () => {
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
  });
  it('p95 of 100 samples 1..100 = 95', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 95)).toBe(95);
  });
  it('throws on empty', () => {
    expect(() => percentile([], 50)).toThrow();
  });
});

describe('aggregate', () => {
  it('splits cold from warm', () => {
    const samples = [
      { ms: 100, cold: true }, { ms: 110, cold: true },
      { ms: 50, cold: false }, { ms: 55, cold: false },
    ];
    const r = aggregate(samples);
    expect(r.cold.p50).toBeGreaterThanOrEqual(100);
    expect(r.warm.p50).toBeLessThanOrEqual(55);
    expect(r.all.count).toBe(4);
  });
  it('handles all-warm input', () => {
    const r = aggregate([{ ms: 10, cold: false }, { ms: 20, cold: false }]);
    expect(r.cold.count).toBe(0);
    expect(r.warm.count).toBe(2);
  });
});
