import { describe, expect, it } from 'vitest';
import { computeThroughput } from '../../src/metrics/ingestion.js';

describe('computeThroughput', () => {
  it('returns tokens-per-second', () => {
    expect(computeThroughput({ tokensIn: 1000, durationMs: 2000 })).toBe(500);
  });
  it('returns 0 for zero duration', () => {
    expect(computeThroughput({ tokensIn: 1000, durationMs: 0 })).toBe(0);
  });
  it('handles 0 tokens', () => {
    expect(computeThroughput({ tokensIn: 0, durationMs: 5000 })).toBe(0);
  });
});
