/**
 * RRF Fusion — Unit Tests (FEAT.6)
 *
 * Tests Reciprocal Rank Fusion independently from the full hybrid search pipeline.
 * Verifies scoring, multi-source boosting, edge cases, and property merging.
 */

import { describe, it, expect } from 'vitest';
import { rrfFuse, type RRFSource } from '../hybridSearch';
import type { HybridSearchHit } from '../hybridSearch';

// ============================================================================
// Helpers
// ============================================================================

/** Create a minimal HybridSearchHit for testing */
function makeHit(
  key: string,
  source: 'vector' | 'text',
  overrides: Partial<HybridSearchHit> = {},
): HybridSearchHit {
  return {
    key,
    nodeType: 'Function',
    name: key,
    score: 0,
    sources: [source],
    properties: {},
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('rrfFuse (FEAT.6)', () => {
  // --------------------------------------------------------------------------
  // Core RRF behavior
  // --------------------------------------------------------------------------

  it('ranks multi-source hits higher than single-source hits', () => {
    // "alpha" appears in both sources (rank 1 in vector, rank 2 in text)
    // "beta" appears only in vector (rank 2)
    // "gamma" appears only in text (rank 1)
    const sources: RRFSource[] = [
      {
        name: 'vector',
        weight: 0.7,
        hits: [
          makeHit('alpha', 'vector'),
          makeHit('beta', 'vector'),
        ],
      },
      {
        name: 'text',
        weight: 0.3,
        hits: [
          makeHit('gamma', 'text'),
          makeHit('alpha', 'text'),
        ],
      },
    ];

    const results = rrfFuse(sources);

    // alpha should be ranked highest (contributions from both sources)
    expect(results[0]!.key).toBe('alpha');
    expect(results[0]!.sources).toContain('vector');
    expect(results[0]!.sources).toContain('text');

    // alpha's score should be higher than any single-source hit
    const alphaScore = results[0]!.score;
    const betaScore = results.find((r) => r.key === 'beta')!.score;
    const gammaScore = results.find((r) => r.key === 'gamma')!.score;
    expect(alphaScore).toBeGreaterThan(betaScore);
    expect(alphaScore).toBeGreaterThan(gammaScore);
  });

  it('produces expected RRF scores with k=60', () => {
    // With k=60, rank 1 contributes weight/(60+1) = weight/61
    // rank 2 contributes weight/(60+2) = weight/62
    const sources: RRFSource[] = [
      {
        name: 'source1',
        weight: 1.0,
        hits: [makeHit('a', 'vector'), makeHit('b', 'vector')],
      },
    ];

    const results = rrfFuse(sources, 60);

    // "a" is rank 1: score = 1.0 / (60 + 1) = 1/61
    // "b" is rank 2: score = 1.0 / (60 + 2) = 1/62
    // After normalization: a = 1.0, b = (1/62) / (1/61) = 61/62
    expect(results).toHaveLength(2);
    expect(results[0]!.key).toBe('a');
    expect(results[0]!.score).toBeCloseTo(1.0, 5); // Normalized max
    expect(results[1]!.key).toBe('b');
    expect(results[1]!.score).toBeCloseTo(61 / 62, 3);
  });

  it('respects source weights', () => {
    // Heavy vector weight (0.9) vs light text weight (0.1)
    // "vecTop" is rank 1 in vector only
    // "textTop" is rank 1 in text only
    const sources: RRFSource[] = [
      {
        name: 'vector',
        weight: 0.9,
        hits: [makeHit('vecTop', 'vector')],
      },
      {
        name: 'text',
        weight: 0.1,
        hits: [makeHit('textTop', 'text')],
      },
    ];

    const results = rrfFuse(sources);

    // vecTop should rank higher due to heavier weight
    expect(results[0]!.key).toBe('vecTop');
    expect(results[1]!.key).toBe('textTop');

    // vecTop score should be 9x higher (before normalization)
    // After normalization, vecTop = 1.0, textTop = 0.1/0.9 ≈ 0.111
    expect(results[1]!.score).toBeCloseTo(0.1 / 0.9, 3);
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------

  it('handles empty sources gracefully', () => {
    const results = rrfFuse([]);
    expect(results).toHaveLength(0);
  });

  it('handles sources with no hits', () => {
    const results = rrfFuse([
      { name: 'empty', weight: 1.0, hits: [] },
    ]);
    expect(results).toHaveLength(0);
  });

  it('handles single source correctly', () => {
    const sources: RRFSource[] = [
      {
        name: 'text',
        weight: 0.3,
        hits: [
          makeHit('a', 'text'),
          makeHit('b', 'text'),
          makeHit('c', 'text'),
        ],
      },
    ];

    const results = rrfFuse(sources);

    // Order should be preserved (rank 1, 2, 3)
    expect(results.map((r) => r.key)).toEqual(['a', 'b', 'c']);
    // Scores should be monotonically decreasing
    expect(results[0]!.score).toBeGreaterThan(results[1]!.score);
    expect(results[1]!.score).toBeGreaterThan(results[2]!.score);
    // Top score normalized to 1.0
    expect(results[0]!.score).toBeCloseTo(1.0);
  });

  // --------------------------------------------------------------------------
  // Property and source merging
  // --------------------------------------------------------------------------

  it('preserves source tracking and properties across merge', () => {
    const sources: RRFSource[] = [
      {
        name: 'vector',
        weight: 0.7,
        hits: [
          makeHit('fn1', 'vector', {
            vectorDistance: 0.5,
            properties: { complexity: 10 },
          }),
        ],
      },
      {
        name: 'text',
        weight: 0.3,
        hits: [
          makeHit('fn1', 'text', {
            properties: { docstring: 'Process data' },
          }),
        ],
      },
    ];

    const results = rrfFuse(sources);

    expect(results).toHaveLength(1);
    const hit = results[0]!;

    // Sources merged
    expect(hit.sources).toContain('vector');
    expect(hit.sources).toContain('text');

    // Vector distance preserved
    expect(hit.vectorDistance).toBe(0.5);

    // Properties merged from both sources
    expect(hit.properties).toHaveProperty('complexity', 10);
    expect(hit.properties).toHaveProperty('docstring', 'Process data');
  });

  it('preserves filePath and startLine from the first source', () => {
    const sources: RRFSource[] = [
      {
        name: 'vector',
        weight: 0.7,
        hits: [
          makeHit('fn1', 'vector', {
            filePath: '/src/file.ts',
            startLine: 42,
          }),
        ],
      },
      {
        name: 'text',
        weight: 0.3,
        hits: [makeHit('fn1', 'text')],
      },
    ];

    const results = rrfFuse(sources);
    expect(results[0]!.filePath).toBe('/src/file.ts');
    expect(results[0]!.startLine).toBe(42);
  });

  // --------------------------------------------------------------------------
  // Custom k parameter
  // --------------------------------------------------------------------------

  it('lower k values increase rank discrimination', () => {
    const sources: RRFSource[] = [
      {
        name: 'source1',
        weight: 1.0,
        hits: [makeHit('a', 'vector'), makeHit('b', 'vector')],
      },
    ];

    // With k=1: rank1 gets 1/(1+1)=0.5, rank2 gets 1/(1+2)=0.333
    // Gap = 0.5 - 0.333 = 0.167
    const lowK = rrfFuse(sources, 1);

    // With k=60: rank1 gets 1/61, rank2 gets 1/62
    // Gap is much smaller (normalized)
    const highK = rrfFuse(sources, 60);

    // With low k, the score difference between rank 1 and 2 is larger
    const lowKGap = lowK[0]!.score - lowK[1]!.score;
    const highKGap = highK[0]!.score - highK[1]!.score;
    expect(lowKGap).toBeGreaterThan(highKGap);
  });

  // --------------------------------------------------------------------------
  // Realistic scenario
  // --------------------------------------------------------------------------

  it('realistic hybrid search fusion scenario', () => {
    // Simulates vector + text results for query "payment"
    const sources: RRFSource[] = [
      {
        name: 'vector',
        weight: 0.7,
        hits: [
          // Vector results sorted by distance (closest first)
          makeHit('processPayment', 'vector', { vectorDistance: 0.1 }),
          makeHit('validateCard', 'vector', { vectorDistance: 0.3 }),
          makeHit('renderChart', 'vector', { vectorDistance: 0.8 }),
        ],
      },
      {
        name: 'text',
        weight: 0.3,
        hits: [
          // Text results sorted by text relevance
          makeHit('processPayment', 'text'), // Exact name match
          makeHit('PaymentService', 'text'),  // Only in text
        ],
      },
    ];

    const results = rrfFuse(sources);

    // processPayment should be #1 (found in both sources at rank 1)
    expect(results[0]!.key).toBe('processPayment');
    expect(results[0]!.sources).toEqual(expect.arrayContaining(['vector', 'text']));
    expect(results[0]!.vectorDistance).toBe(0.1);

    // validateCard (vector rank 2) vs PaymentService (text rank 2)
    // validateCard gets 0.7/62 ≈ 0.0113
    // PaymentService gets 0.3/62 ≈ 0.0048
    // So validateCard should be ranked higher
    const vcIdx = results.findIndex((r) => r.key === 'validateCard');
    const psIdx = results.findIndex((r) => r.key === 'PaymentService');
    expect(vcIdx).toBeLessThan(psIdx);

    // All 4 unique hits should be present
    expect(results).toHaveLength(4);
  });
});
