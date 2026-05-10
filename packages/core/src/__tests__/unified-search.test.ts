/**
 * Tests for unifiedSearch — code + knowledge RRF fusion.
 *
 * Verifies:
 * 1. searchScope: 'all'  → runs both searches in parallel and merges via RRF
 * 2. searchScope: 'code' → returns code results only (source: 'code')
 * 3. searchScope: 'knowledge' → returns knowledge results only (source: 'knowledge')
 * 4. Every UnifiedSearchResult has a `source` field ('code' | 'knowledge')
 * 5. RRF fused results are sorted by score descending
 * 6. Knowledge search failure is non-fatal — code results still returned
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------

const mockCodeHits = [
  {
    name: 'parseToken',
    nodeType: 'Function',
    filePath: 'src/auth.ts',
    startLine: 10,
    score: 0.95,
    properties: {},
  },
  {
    name: 'validateSession',
    nodeType: 'Function',
    filePath: 'src/session.ts',
    startLine: 42,
    score: 0.85,
    properties: {},
  },
];

const mockKnowledgeEntities = [
  {
    text: 'JWT authentication decision',
    type: 'Decision',
    confidence: 0.9,
    relevanceScore: 0.88,
    createdAt: Date.now(),
    sampleIds: ['cgbench:jwt-spec'],
  },
  {
    text: 'Session expiry policy',
    type: 'Policy',
    confidence: 0.75,
    relevanceScore: 0.70,
    createdAt: Date.now(),
  },
];

// ---------------------------------------------------------------------------
// Mocks — declared before any imports from the module under test
// vi.mock is hoisted by vitest, so mock factories run before test module imports
// ---------------------------------------------------------------------------

const mockSearchEntitiesByVector = vi.fn().mockResolvedValue(mockKnowledgeEntities);

vi.mock('../knowledgeClient', () => ({
  getKnowledgeOps: vi.fn().mockResolvedValue({
    searchEntitiesByVector: mockSearchEntitiesByVector,
  }),
}));

const mockIsEmbeddingAvailable = vi.fn().mockReturnValue(true);
const mockGenerateEmbedding = vi.fn().mockResolvedValue({ embedding: [0.1, 0.2], dimensions: 2, provider: 'mock' });

vi.mock('@codegraph/plugin-nlp', () => ({
  isEmbeddingAvailable: mockIsEmbeddingAvailable,
  generateEmbedding: mockGenerateEmbedding,
  rerank: vi.fn().mockImplementation(async (_q: unknown, candidates: unknown[]) =>
    candidates.map((c, i) => ({ ...c, score: 1 - i * 0.1 })),
  ),
  generateEmbeddings: vi.fn().mockResolvedValue({ embeddings: [], dimensions: 2, provider: 'mock' }),
  getLastRerankWarning: vi.fn().mockReturnValue(null),
  clearLastRerankWarning: vi.fn(),
}));

const mockEnrichedSearchV2 = vi.fn().mockResolvedValue({
  hits: mockCodeHits,
  meta: { query: 'authentication', vectorHits: 2, durationMs: 50 },
});

vi.mock('../enrichedSearchV2', async (importActual) => {
  const actual = await importActual<typeof import('../enrichedSearchV2')>();
  return {
    ...actual,
    enrichedSearchV2: mockEnrichedSearchV2,
  };
});

// ---------------------------------------------------------------------------
// Mock client (minimal — unifiedSearch passes it to enrichedSearchV2 which is mocked)
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

const mockClient = {
  roQuery: vi.fn().mockResolvedValue({ data: [], metadata: null }),
  query: vi.fn().mockResolvedValue({ data: [], metadata: null }),
  close: vi.fn().mockResolvedValue(undefined),
  dialect: mockDialect,
};

// ---------------------------------------------------------------------------
// Import under test (after mocks are established)
// ---------------------------------------------------------------------------

const { unifiedSearch } = await import('../unifiedSearch');
const { getKnowledgeOps } = await import('../knowledgeClient');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('unifiedSearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-apply defaults after clearAllMocks
    mockIsEmbeddingAvailable.mockReturnValue(true);
    mockGenerateEmbedding.mockResolvedValue({ embedding: [0.1, 0.2], dimensions: 2, provider: 'mock' });
    mockSearchEntitiesByVector.mockResolvedValue(mockKnowledgeEntities);
    (getKnowledgeOps as ReturnType<typeof vi.fn>).mockResolvedValue({
      searchEntitiesByVector: mockSearchEntitiesByVector,
    });
    mockEnrichedSearchV2.mockResolvedValue({
      hits: mockCodeHits,
      meta: { query: 'authentication', vectorHits: 2, durationMs: 50 },
    });
  });

  // =========================================================================
  // searchScope: 'all' — RRF fusion
  // =========================================================================

  describe("searchScope: 'all' (default)", () => {
    it('returns results from both code and knowledge sources', async () => {
      const response = await unifiedSearch('authentication', mockClient as never, { searchScope: 'all' });

      const sources = new Set(response.results.map(r => r.source));
      expect(sources.has('code')).toBe(true);
      expect(sources.has('knowledge')).toBe(true);
    });

    it('every result has a source field of code or knowledge', async () => {
      const response = await unifiedSearch('authentication', mockClient as never, { searchScope: 'all' });

      for (const result of response.results) {
        expect(['code', 'knowledge']).toContain(result.source);
      }
    });

    it('results are sorted by score descending', async () => {
      const response = await unifiedSearch('authentication', mockClient as never, { searchScope: 'all' });

      for (let i = 1; i < response.results.length; i++) {
        expect(response.results[i - 1]!.score).toBeGreaterThanOrEqual(response.results[i]!.score);
      }
    });

    it('meta includes codeHits and knowledgeHits counts', async () => {
      const response = await unifiedSearch('authentication', mockClient as never, { searchScope: 'all' });

      expect(response.meta.codeHits).toBe(2);
      expect(response.meta.knowledgeHits).toBe(2);
      expect(response.meta.query).toBe('authentication');
      expect(typeof response.meta.durationMs).toBe('number');
    });

    it('uses rrfFuse — scores are small positive reciprocal-rank numbers', async () => {
      const response = await unifiedSearch('authentication', mockClient as never, { searchScope: 'all' });

      // RRF scores are 1/(k+rank) ≈ 1/61 ≈ 0.016 at most
      for (const result of response.results) {
        expect(result.score).toBeGreaterThan(0);
        expect(result.score).toBeLessThan(1);
      }
    });
  });

  // =========================================================================
  // searchScope: 'code'
  // =========================================================================

  describe("searchScope: 'code'", () => {
    it('returns only code results', async () => {
      const response = await unifiedSearch('authentication', mockClient as never, { searchScope: 'code' });

      expect(response.results.length).toBeGreaterThan(0);
      for (const result of response.results) {
        expect(result.source).toBe('code');
      }
    });

    it('does not call knowledge search when scope is code', async () => {
      await unifiedSearch('authentication', mockClient as never, { searchScope: 'code' });
      expect(getKnowledgeOps).not.toHaveBeenCalled();
    });

    it('meta.knowledgeHits is 0', async () => {
      const response = await unifiedSearch('authentication', mockClient as never, { searchScope: 'code' });
      expect(response.meta.knowledgeHits).toBe(0);
    });

    it('code results have filePath from hits', async () => {
      const response = await unifiedSearch('authentication', mockClient as never, { searchScope: 'code' });
      const filePaths = response.results.map(r => r.filePath).filter(Boolean);
      expect(filePaths.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // searchScope: 'knowledge'
  // =========================================================================

  describe("searchScope: 'knowledge'", () => {
    it('returns only knowledge results', async () => {
      const response = await unifiedSearch('authentication', mockClient as never, { searchScope: 'knowledge' });

      expect(response.results.length).toBeGreaterThan(0);
      for (const result of response.results) {
        expect(result.source).toBe('knowledge');
      }
    });

    it('meta.codeHits is 0', async () => {
      const response = await unifiedSearch('authentication', mockClient as never, { searchScope: 'knowledge' });
      expect(response.meta.codeHits).toBe(0);
    });

    it('knowledge results have name derived from entity text', async () => {
      const response = await unifiedSearch('authentication', mockClient as never, { searchScope: 'knowledge' });
      const names = response.results.map(r => r.name);
      expect(names).toContain('JWT authentication decision');
    });
  });

  // =========================================================================
  // Source field presence
  // =========================================================================

  describe('source field on results', () => {
    it('code-only scope results always have source: code', async () => {
      const response = await unifiedSearch('auth', mockClient as never, { searchScope: 'code' });
      response.results.forEach(r => expect(r.source).toBe('code'));
    });

    it('knowledge-only scope results always have source: knowledge', async () => {
      const response = await unifiedSearch('auth', mockClient as never, { searchScope: 'knowledge' });
      response.results.forEach(r => expect(r.source).toBe('knowledge'));
    });

    it('fused results carry their original source label through RRF', async () => {
      const response = await unifiedSearch('auth', mockClient as never, { searchScope: 'all' });

      const codeResults = response.results.filter(r => r.source === 'code');
      const knowledgeResults = response.results.filter(r => r.source === 'knowledge');

      for (const r of codeResults) {
        expect(['parseToken', 'validateSession']).toContain(r.name);
      }
      for (const r of knowledgeResults) {
        expect(['JWT authentication decision', 'Session expiry policy']).toContain(r.name);
      }
    });
  });

  // =========================================================================
  // Graceful degradation
  // =========================================================================

  describe('graceful degradation', () => {
    it('returns code-only results when embeddings are unavailable', async () => {
      mockIsEmbeddingAvailable.mockReturnValue(false);

      const response = await unifiedSearch('auth', mockClient as never, { searchScope: 'all' });

      // When embeddings unavailable, knowledge search is skipped
      expect(getKnowledgeOps).not.toHaveBeenCalled();
      // Still returns code results
      expect(response.results.length).toBeGreaterThan(0);
      expect(response.results[0]!.source).toBe('code');
    });

    it('returns code-only results when knowledge vector search throws', async () => {
      mockSearchEntitiesByVector.mockRejectedValue(new Error('Knowledge DB offline'));

      const response = await unifiedSearch('auth', mockClient as never, { searchScope: 'all' });

      // Knowledge failure is non-fatal — code results still returned
      expect(response.results.length).toBeGreaterThan(0);
      const sources = response.results.map(r => r.source);
      expect(sources.every(s => s === 'code')).toBe(true);
    });
  });

  // =========================================================================
  // sampleIds flow-through
  // =========================================================================

  describe('knowledge sampleIds flow-through', () => {
    it('sampleIds on a knowledge entity appear in result.properties.sampleIds (knowledge-only scope)', async () => {
      const response = await unifiedSearch('authentication', mockClient as never, { searchScope: 'knowledge' });

      const jwtResult = response.results.find(r => r.name === 'JWT authentication decision');
      expect(jwtResult).toBeDefined();
      expect(jwtResult!.properties.sampleIds).toEqual(['cgbench:jwt-spec']);
    });

    it('sampleIds on a knowledge entity appear in result.properties.sampleIds (all scope / RRF path)', async () => {
      const response = await unifiedSearch('authentication', mockClient as never, { searchScope: 'all' });

      const jwtResult = response.results.find(r => r.name === 'JWT authentication decision');
      expect(jwtResult).toBeDefined();
      expect(jwtResult!.properties.sampleIds).toEqual(['cgbench:jwt-spec']);
    });

    it('entity without sampleIds gets an empty array in result.properties.sampleIds', async () => {
      const response = await unifiedSearch('authentication', mockClient as never, { searchScope: 'knowledge' });

      const policyResult = response.results.find(r => r.name === 'Session expiry policy');
      expect(policyResult).toBeDefined();
      expect(policyResult!.properties.sampleIds).toEqual([]);
    });
  });

  // =========================================================================
  // Knowledge deduplication by sampleIds[0]
  // =========================================================================

  describe('knowledge dedup by sampleIds[0]', () => {
    it('deduplicates knowledge entities by sampleIds[0] before RRF fusion', async () => {
      // Setup: 5 knowledge entities with 2 distinct document sources
      const allFromTwoSources = [
        {
          text: 'Entity 1 from doc-001',
          type: 'Decision',
          confidence: 0.95,
          relevanceScore: 0.95,
          createdAt: Date.now(),
          sampleIds: ['knowledge-001'],
        },
        {
          text: 'Entity 2 from doc-001',
          type: 'Policy',
          confidence: 0.90,
          relevanceScore: 0.90,
          createdAt: Date.now(),
          sampleIds: ['knowledge-001'],
        },
        {
          text: 'Entity 3 from doc-001',
          type: 'Insight',
          confidence: 0.85,
          relevanceScore: 0.85,
          createdAt: Date.now(),
          sampleIds: ['knowledge-001'],
        },
        {
          text: 'Entity 4 from doc-002',
          type: 'Decision',
          confidence: 0.92,
          relevanceScore: 0.92,
          createdAt: Date.now(),
          sampleIds: ['knowledge-002'],
        },
        {
          text: 'Entity 5 from doc-002',
          type: 'Policy',
          confidence: 0.80,
          relevanceScore: 0.80,
          createdAt: Date.now(),
          sampleIds: ['knowledge-002'],
        },
      ];

      mockSearchEntitiesByVector.mockResolvedValue(allFromTwoSources);
      (getKnowledgeOps as ReturnType<typeof vi.fn>).mockResolvedValue({
        searchEntitiesByVector: mockSearchEntitiesByVector,
      });

      const response = await unifiedSearch('test query', mockClient as never, { searchScope: 'all' });

      const knowledgeInResults = response.results.filter(r => r.source === 'knowledge');

      // At most 2 distinct doc sources (knowledge-001, knowledge-002)
      expect(knowledgeInResults.length).toBeLessThanOrEqual(2);

      // Each unique sampleIds[0] appears at most once
      const docSources = knowledgeInResults
        .map(r => (r.properties as { sampleIds?: string[] }).sampleIds?.[0])
        .filter(Boolean);
      const uniqueDocSources = new Set(docSources);
      expect(uniqueDocSources.size).toBe(docSources.length);

      // The HIGHEST-ranked entity per source should be the one kept
      // (searchEntitiesByVector is pre-sorted by relevanceScore desc)
      // For knowledge-001, that's "Entity 1 from doc-001" (score 0.95)
      const doc001Result = knowledgeInResults.find(
        r => (r.properties as { sampleIds?: string[] }).sampleIds?.[0] === 'knowledge-001'
      );
      if (doc001Result) {
        expect(doc001Result.name).toBe('Entity 1 from doc-001');
      }
    });

    it('dedup only applies in RRF (code+knowledge) — knowledge-only scope returns all entities', async () => {
      // When scope is 'knowledge' only, there's no RRF fusion, so no dedup.
      // The dedup is specifically part of the RRF pool preparation to prevent
      // a single document from flooding the fusion rankings.
      const allFromSameDoc = [
        {
          text: 'Entity A from doc-X',
          type: 'Decision',
          confidence: 0.95,
          relevanceScore: 0.95,
          createdAt: Date.now(),
          sampleIds: ['knowledge-X'],
        },
        {
          text: 'Entity B from doc-X',
          type: 'Policy',
          confidence: 0.88,
          relevanceScore: 0.88,
          createdAt: Date.now(),
          sampleIds: ['knowledge-X'],
        },
        {
          text: 'Entity C from doc-Y',
          type: 'Decision',
          confidence: 0.92,
          relevanceScore: 0.92,
          createdAt: Date.now(),
          sampleIds: ['knowledge-Y'],
        },
      ];

      mockSearchEntitiesByVector.mockResolvedValue(allFromSameDoc);
      (getKnowledgeOps as ReturnType<typeof vi.fn>).mockResolvedValue({
        searchEntitiesByVector: mockSearchEntitiesByVector,
      });

      const response = await unifiedSearch('test query', mockClient as never, { searchScope: 'knowledge' });

      const results = response.results;

      // Knowledge-only scope returns all entities (limit=20 by default, so all 3)
      expect(results.length).toBe(3);
      expect(results.map(r => r.name)).toEqual(['Entity A from doc-X', 'Entity B from doc-X', 'Entity C from doc-Y']);
    });
  });

  // =========================================================================
  // Client DI — knowledge branch honors the passed client
  // =========================================================================

  describe('knowledge branch DI — passes client to getKnowledgeOps', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('passes the search client through to getKnowledgeOps when scope is "all"', async () => {
      await unifiedSearch('test query', mockClient as never, { searchScope: 'all', limit: 5 });

      expect(getKnowledgeOps).toHaveBeenCalledWith(mockClient);
    });

    it('passes the search client through to getKnowledgeOps when scope is "knowledge"', async () => {
      await unifiedSearch('test query', mockClient as never, { searchScope: 'knowledge', limit: 5 });

      expect(getKnowledgeOps).toHaveBeenCalledWith(mockClient);
    });
  });
});
