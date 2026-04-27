/**
 * Tests for linkedKnowledge enrichment in enrichedSearchV2.
 *
 * Verifies that when ABOUT edges exist (Entity → CodeNode), the search results
 * are enriched with a `linkedKnowledge` array on the matching hit.
 *
 * Also verifies that when no ABOUT edges exist the field is absent (not an
 * empty array) — the implementation uses spread with a conditional, so it
 * should be completely absent rather than undefined.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GraphClient } from '@codegraph/graph';

// ---------------------------------------------------------------------------
// The vector hit returned by searchByVector
// ---------------------------------------------------------------------------

const MOCK_VECTOR_HIT = {
  name: 'parseToken',
  nodeType: 'Function',
  filePath: 'src/auth.ts',
  startLine: 10,
  distance: 0.1,
  properties: {},
};

// ---------------------------------------------------------------------------
// Mocks — vi.mock is hoisted; factory functions must be self-contained.
// Access mocked implementations via vi.mocked() after import.
// ---------------------------------------------------------------------------

vi.mock('@codegraph/graph', () => ({
  createOperations: vi.fn().mockReturnValue({
    searchByVector: vi.fn().mockResolvedValue([
      {
        name: 'parseToken',
        nodeType: 'Function',
        filePath: 'src/auth.ts',
        startLine: 10,
        distance: 0.1,
        properties: {},
      },
    ]),
  }),
}));

vi.mock('@codegraph/plugin-nlp', () => ({
  isEmbeddingAvailable: vi.fn().mockReturnValue(true),
  generateEmbedding: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2], dimensions: 2, provider: 'mock' }),
  rerank: vi.fn().mockImplementation(async (_query: unknown, candidates: unknown[]) =>
    candidates.map((c, i) => ({ ...c, score: 1 - i * 0.1 })),
  ),
  generateEmbeddings: vi.fn().mockResolvedValue({ embeddings: [], dimensions: 2, provider: 'mock' }),
}));

// ---------------------------------------------------------------------------
// Import mocked modules to restore implementations in beforeEach
// ---------------------------------------------------------------------------

import * as graphMod from '@codegraph/graph';
import * as nlpMod from '@codegraph/plugin-nlp';

// ---------------------------------------------------------------------------
// Mock dialect
// ---------------------------------------------------------------------------

const mockDialect = {
  driverType: 'falkordb' as const,
  labelsExpr: (a: string) => `labels(${a})`,
  firstLabelExpr: (a: string) => `labels(${a})[0]`,
  typeExpr: (a: string) => `type(${a})`,
  labelCheckExpr: (a: string, l: string) => `${a}:${l}`,
  labelCaseExpr: (a: string, l: string) => `${a}:${l}`,
  supportsOnCreateOnMatch: true,
  normalizeNode: (raw: unknown) => ({ labels: [], properties: raw as Record<string, unknown> }),
  normalizeEdge: (raw: unknown) => ({ type: '', properties: raw as Record<string, unknown> }),
};

// ---------------------------------------------------------------------------
// Import under test (after mocks)
// ---------------------------------------------------------------------------

const { enrichedSearchV2, clearEmbeddedLabelCache } = await import('../enrichedSearchV2');

// ---------------------------------------------------------------------------
// Helper: build a mock GraphClient with configurable ABOUT-edge responses
// ---------------------------------------------------------------------------

type RoQueryResponse = { data: unknown[]; metadata: null };
type LinkedKnowledgeRow = {
  targetName: string;
  entityText: string;
  entityType: string;
  confidence: number;
  fact: string | null;
};

function makeMockClient(linkedKnowledge: LinkedKnowledgeRow[] = []): Partial<GraphClient> & { roQuery: ReturnType<typeof vi.fn> } {
  const roQuery = vi.fn().mockImplementation(async (cypher: string): Promise<RoQueryResponse> => {
    // Embedding count check — must return > 0 or function exits early with no hits
    if (cypher.includes('embedding IS NOT NULL') && cypher.includes('count(n)')) {
      return { data: [{ count: 1 }], metadata: null };
    }
    // Embedded label discovery (getEmbeddedLabels)
    if (cypher.includes('DISTINCT label')) {
      return { data: [{ label: 'Function' }], metadata: null };
    }
    // ABOUT edges query (getLinkedKnowledge)
    if (cypher.includes('Entity') && cypher.includes('ABOUT')) {
      return { data: linkedKnowledge, metadata: null };
    }
    // All other queries (enrichment, sibling, depth, git) — non-fatal empty
    return { data: [], metadata: null };
  });

  return {
    roQuery,
    query: vi.fn().mockResolvedValue({ data: [], metadata: null }),
    close: vi.fn().mockResolvedValue(undefined),
    dialect: mockDialect as GraphClient['dialect'],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('enrichedSearchV2 — linkedKnowledge enrichment via ABOUT edges', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore createOperations to return a mock with searchByVector returning the hit
    vi.mocked(graphMod.createOperations).mockReturnValue({
      searchByVector: vi.fn().mockResolvedValue([MOCK_VECTOR_HIT]),
    } as never);
    // Restore plugin-nlp mocks
    vi.mocked(nlpMod.isEmbeddingAvailable).mockReturnValue(true);
    vi.mocked(nlpMod.generateEmbedding).mockResolvedValue({ embedding: [0.1, 0.2], dimensions: 2, provider: 'mock' });
    vi.mocked(nlpMod.rerank).mockImplementation(async (_q, candidates) =>
      (candidates as Array<{ score?: number }>).map((c, i) => ({ ...c, score: 1 - i * 0.1 })),
    );
    // Clear the module-level embedded-labels cache
    clearEmbeddedLabelCache();
  });

  it('attaches linkedKnowledge to hits that have matching ABOUT edges', async () => {
    const client = makeMockClient([
      {
        targetName: 'parseToken',
        entityText: 'JWT authentication decision',
        entityType: 'Decision',
        confidence: 0.95,
        fact: 'We use JWT because it is stateless',
      },
    ]);

    const result = await enrichedSearchV2('lk-test-1', client as never, { skipReranker: true });

    const hit = result.hits.find(h => h.name === 'parseToken');
    expect(hit).toBeDefined();
    expect(hit?.linkedKnowledge).toBeDefined();
    expect(hit?.linkedKnowledge).toHaveLength(1);
    expect(hit?.linkedKnowledge![0]!.entityText).toBe('JWT authentication decision');
    expect(hit?.linkedKnowledge![0]!.entityType).toBe('Decision');
    expect(hit?.linkedKnowledge![0]!.confidence).toBe(0.95);
    expect(hit?.linkedKnowledge![0]!.fact).toBe('We use JWT because it is stateless');
  });

  it('omits linkedKnowledge field when no ABOUT edges exist for a hit', async () => {
    const client = makeMockClient([]); // no knowledge linked

    const result = await enrichedSearchV2('lk-test-2', client as never, { skipReranker: true });

    const hit = result.hits.find(h => h.name === 'parseToken');
    expect(hit).toBeDefined();
    // Field should not be present — implementation uses a conditional spread
    expect('linkedKnowledge' in (hit ?? {})).toBe(false);
  });

  it('attaches multiple knowledge entries when several ABOUT edges exist', async () => {
    const client = makeMockClient([
      {
        targetName: 'parseToken',
        entityText: 'JWT decision',
        entityType: 'Decision',
        confidence: 0.9,
        fact: null,
      },
      {
        targetName: 'parseToken',
        entityText: 'Token expiry policy',
        entityType: 'Policy',
        confidence: 0.8,
        fact: 'Tokens expire after 24 hours',
      },
    ]);

    const result = await enrichedSearchV2('lk-test-3', client as never, { skipReranker: true });

    const hit = result.hits.find(h => h.name === 'parseToken');
    expect(hit?.linkedKnowledge).toBeDefined();
    expect(hit?.linkedKnowledge).toHaveLength(2);
    expect(hit?.linkedKnowledge![1]!.entityText).toBe('Token expiry policy');
  });

  it('does not include fact field when fact is null', async () => {
    const client = makeMockClient([
      {
        targetName: 'parseToken',
        entityText: 'Auth system',
        entityType: 'System',
        confidence: 0.7,
        fact: null,
      },
    ]);

    const result = await enrichedSearchV2('lk-test-4', client as never, { skipReranker: true });

    const hit = result.hits.find(h => h.name === 'parseToken');
    expect(hit?.linkedKnowledge).toBeDefined();
    expect(hit?.linkedKnowledge).toHaveLength(1);
    // fact: null excluded by implementation's conditional spread
    expect('fact' in (hit?.linkedKnowledge![0] ?? {})).toBe(false);
  });

  it('gracefully handles ABOUT query failure — returns hits without linkedKnowledge', async () => {
    const client = makeMockClient();
    // Override roQuery to throw on ABOUT queries
    client.roQuery.mockImplementation(async (cypher: string): Promise<RoQueryResponse> => {
      if (cypher.includes('embedding IS NOT NULL') && cypher.includes('count(n)')) {
        return { data: [{ count: 1 }], metadata: null };
      }
      if (cypher.includes('DISTINCT label')) {
        return { data: [{ label: 'Function' }], metadata: null };
      }
      if (cypher.includes('Entity') && cypher.includes('ABOUT')) {
        throw new Error('Graph DB unavailable');
      }
      return { data: [], metadata: null };
    });

    const result = await enrichedSearchV2('lk-test-5', client as never, { skipReranker: true });

    // ABOUT failure is non-fatal — hits are still returned
    expect(result.hits.length).toBeGreaterThan(0);
    const hit = result.hits.find(h => h.name === 'parseToken');
    expect(hit).toBeDefined();
    // linkedKnowledge absent because ABOUT query threw
    expect('linkedKnowledge' in (hit ?? {})).toBe(false);
  });
});
