/**
 * searchFactsByVector Unit Tests
 *
 * Tests the HNSW fact embedding search on RELATES_TO edges.
 * Uses a mock GraphClient so no FalkorDB instance is required.
 *
 * Coverage:
 * - HNSW path (db.idx.vector.queryEdges succeeds)
 * - Empty result set
 * - Silent catch on HNSW failure (method returns [])
 * - Limit forwarded as $k parameter
 */

import { describe, it, expect, vi } from 'vitest';
import type { GraphClient, QueryResult } from '../client';
import { createKnowledgeOperations, type FactSearchResult } from '../knowledge-operations';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFactRow(overrides?: Partial<FactSearchResult>): FactSearchResult {
  return {
    headText: 'Alice',
    headType: 'Person',
    tailText: 'JWT',
    tailType: 'Technology',
    relationType: 'PREFERS',
    confidence: 0.9,
    fact: 'Alice prefers JWT for auth',
    validAt: 1700000000000,
    invalidAt: null,
    score: 0.95,
    ...overrides,
  };
}

/** Build a minimal GraphClient mock with a controllable roQuery. */
function makeClient(
  roQueryImpl: (...args: unknown[]) => Promise<QueryResult<unknown>>
): GraphClient {
  return {
    roQuery: vi.fn(roQueryImpl),
    query: vi.fn().mockResolvedValue({ data: [] }),
    ensureIndexes: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    graphName: 'test',
  } as unknown as GraphClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('searchFactsByVector', () => {
  it('returns facts from HNSW index when available', async () => {
    const rows: FactSearchResult[] = [
      makeFactRow({ score: 0.95 }),
      makeFactRow({ headText: 'Bob', tailText: 'OAuth', fact: 'Bob uses OAuth', score: 0.75 }),
    ];

    const client = makeClient(() => Promise.resolve({ data: rows } as QueryResult<FactSearchResult>));
    const kg = createKnowledgeOperations(client);

    const result = await kg.searchFactsByVector([0.1, 0.2, 0.3], 5);

    expect(result).toHaveLength(2);
    expect(result[0]!.fact).toBe('Alice prefers JWT for auth');
    expect(result[1]!.headText).toBe('Bob');
    expect(result[1]!.tailText).toBe('OAuth');
  });

  it('passes limit as k parameter to the Cypher query', async () => {
    const client = makeClient(() => Promise.resolve({ data: [] } as QueryResult<FactSearchResult>));
    const kg = createKnowledgeOperations(client);

    await kg.searchFactsByVector([0.5], 7);

    const mockRoQuery = client.roQuery as ReturnType<typeof vi.fn>;
    expect(mockRoQuery).toHaveBeenCalledOnce();
    const callOpts = mockRoQuery.mock.calls[0]![1] as { params: Record<string, unknown> };
    expect(callOpts.params['k']).toBe(7);
  });

  it('returns empty array when no facts match', async () => {
    const client = makeClient(() => Promise.resolve({ data: [] } as QueryResult<FactSearchResult>));
    const kg = createKnowledgeOperations(client);

    const result = await kg.searchFactsByVector([0.1, 0.2, 0.3]);

    expect(result).toEqual([]);
  });

  it('returns empty array when HNSW index is unavailable (silent catch)', async () => {
    const client = makeClient(() => Promise.reject(new Error('vector index not supported on relationships')));
    const kg = createKnowledgeOperations(client);

    // Must not throw — the implementation silently catches and returns []
    const result = await kg.searchFactsByVector([0.1, 0.2, 0.3]);

    expect(result).toEqual([]);
  });

  it('preserves all FactSearchResult fields', async () => {
    const row: FactSearchResult = makeFactRow({
      headText: 'PaymentService',
      headType: 'Service',
      tailText: 'Stripe',
      tailType: 'Integration',
      relationType: 'INTEGRATES_WITH',
      confidence: 0.85,
      fact: 'PaymentService integrates with Stripe',
      validAt: 1700100000000,
      invalidAt: 1700200000000,
      score: 0.88,
    });

    const client = makeClient(() => Promise.resolve({ data: [row] } as QueryResult<FactSearchResult>));
    const kg = createKnowledgeOperations(client);

    const result = await kg.searchFactsByVector([0.3, 0.4, 0.5]);

    expect(result).toHaveLength(1);
    const r = result[0]!;
    expect(r.headText).toBe('PaymentService');
    expect(r.tailText).toBe('Stripe');
    expect(r.relationType).toBe('INTEGRATES_WITH');
    expect(r.confidence).toBe(0.85);
    expect(r.fact).toBe('PaymentService integrates with Stripe');
    expect(r.validAt).toBe(1700100000000);
    expect(r.invalidAt).toBe(1700200000000);
    expect(r.score).toBe(0.88);
  });
});
