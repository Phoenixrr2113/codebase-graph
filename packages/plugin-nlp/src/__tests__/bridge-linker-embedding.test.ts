/**
 * Bridge-Linker Embedding Similarity — Focused Unit Tests
 *
 * Spec reference: docs/superpowers/specs/2026-04-27-pre-benchmark-fixes-design.md §4.7
 *
 * NOTE ON FILE LOCATION: The spec places this file at
 * `packages/graph/src/__tests__/bridge-linker-embedding.test.ts` but
 * `linkByEmbedding` lives in `@codegraph/plugin-nlp`, which `@codegraph/graph`
 * does not depend on. Placing the test here (plugin-nlp) is the correct location.
 *
 * These tests focus on:
 * - Above-threshold match creates ABOUT edge with method='embedding_similarity'
 * - Below-threshold match creates no ABOUT edge
 * - Threshold tuning: lowering threshold increases edge count predictably
 * - Skip-list applied: Person/Organization/etc. entities are not linked
 *
 * NOTE ON TOP-K GAP: The spec expects `linkByEmbedding` to support a top-K
 * parameter (default 3) that creates multiple ABOUT edges per entity. The actual
 * implementation creates AT MOST 1 ABOUT edge per entity (best match across all
 * node types). Scenario 3 from the spec is documented here as a gap test that
 * asserts the current behavior (1 edge), not the spec's hoped-for behavior (K edges).
 *
 * Uses vi.mock to control embeddings — no real embedding model needed.
 * Uses FalkorDB Docker for graph storage. Requires: docker compose up -d falkordb
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

// Mock embedding functions before any imports that may use them
vi.mock('../embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../embeddings')>();
  return {
    ...actual,
    isEmbeddingAvailable: vi.fn(() => true),
    generateEmbedding: vi.fn(),
  };
});

import { createClient, createOperations, createKnowledgeOperations } from '@codegraph/graph';
import type { GraphClient, GraphOperations, KnowledgeOperations } from '@codegraph/graph';
import { linkByEmbedding } from '../bridge-linker';
import { isEmbeddingAvailable, generateEmbedding } from '../embeddings';

// ============================================================================
// Synthetic Embedding Helpers
// ============================================================================

const DIM = 768;

/**
 * Build a unit vector with a non-zero component at the given index.
 * Vectors at the same index have cosine similarity ≈ 1.0.
 * Vectors at different indices have cosine similarity ≈ 0.0.
 */
function makeVec(primaryDim: number, magnitude = 1.0): number[] {
  const vec = new Array(DIM).fill(0);
  vec[primaryDim] = magnitude;
  return vec;
}

/**
 * Build a vector with non-zero components at two dimensions.
 * Used to create a vector that is "near" two different clusters.
 */
function mixedVec(dim1: number, w1: number, dim2: number, w2: number): number[] {
  const vec = new Array(DIM).fill(0);
  vec[dim1] = w1;
  vec[dim2] = w2;
  return vec;
}

// ============================================================================
// Test Setup
// ============================================================================

const GRAPH_NAME = `test_bridge_emb_${Date.now()}`;

describe('Bridge-Linker Embedding Similarity', () => {
  let client: GraphClient;
  let ops: GraphOperations;
  let kg: KnowledgeOperations;

  beforeAll(async () => {
    try {
      client = await createClient({
        driver: 'falkordb',
        host: 'localhost',
        port: 6379,
        graphName: GRAPH_NAME,
      });
    } catch {
      console.error('FalkorDB not available — skipping tests. Run: docker compose up -d falkordb');
      throw new Error('FalkorDB not available');
    }

    await client.ensureIndexes();
    ops = createOperations(client);
    kg = createKnowledgeOperations(client);

    // Seed code nodes in two semantic clusters:
    //   Cluster 0: payment-related functions (embedding at dim 0)
    //   Cluster 1: chart/rendering functions (embedding at dim 1)

    await ops.upsertFile({
      path: '/src/payments.ts', name: 'payments.ts', extension: 'ts',
      loc: 100, lastModified: '2025-01-01', hash: 'pay001',
    });

    // Payment cluster — dim 0
    await ops.upsertFunction({
      name: 'processPayment', filePath: '/src/payments.ts',
      startLine: 1, endLine: 20,
      isExported: true, isAsync: true, isArrow: false, params: [],
    });
    await ops.upsertFunction({
      name: 'validatePayment', filePath: '/src/payments.ts',
      startLine: 22, endLine: 40,
      isExported: true, isAsync: false, isArrow: false, params: [],
    });

    // Chart cluster — dim 1
    await ops.upsertFunction({
      name: 'renderChart', filePath: '/src/payments.ts',
      startLine: 42, endLine: 60,
      isExported: true, isAsync: false, isArrow: false, params: [],
    });

    // Set embeddings on code nodes
    const PAY_VEC_1 = makeVec(0, 0.95);
    const PAY_VEC_2 = makeVec(0, 0.90);
    const CHART_VEC = makeVec(1, 0.95);

    await ops.updateEmbedding(
      'Function',
      { name: 'processPayment', filePath: '/src/payments.ts', startLine: 1 },
      PAY_VEC_1, 'h1',
    );
    await ops.updateEmbedding(
      'Function',
      { name: 'validatePayment', filePath: '/src/payments.ts', startLine: 22 },
      PAY_VEC_2, 'h2',
    );
    await ops.updateEmbedding(
      'Function',
      { name: 'renderChart', filePath: '/src/payments.ts', startLine: 42 },
      CHART_VEC, 'h3',
    );
  }, 30_000);

  afterAll(async () => {
    vi.restoreAllMocks();
    if (client) {
      try { await client.query('MATCH (n) DETACH DELETE n', { params: {} }); } catch { /* ok */ }
      try { await client.close(); } catch { /* ok */ }
    }
  }, 15_000);

  beforeEach(async () => {
    // Remove all Entity nodes and ABOUT edges between tests
    try {
      await client.query('MATCH (e:Entity) DETACH DELETE e', { params: {} });
    } catch { /* ok */ }
    vi.mocked(isEmbeddingAvailable).mockReturnValue(true);
  });

  // ==========================================================================
  // Scenario 1: Above-threshold match → ABOUT edge created
  // ==========================================================================

  it('creates an ABOUT edge when entity embedding matches a code node above threshold', async () => {
    // Entity "payment retry" is near the payment cluster (dim 0)
    await kg.createEntity({ text: 'payment retry', type: 'Bug', confidence: 0.9 });

    // Mock: entity embedding lands near dim 0 (cosine sim ≈ 1.0 with processPayment)
    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: makeVec(0, 0.93),
      dimensions: DIM,
      provider: 'test',
    });

    const result = await linkByEmbedding(client, kg, { threshold: 0.7, force: true });

    expect(result.linked).toBeGreaterThanOrEqual(1);

    // At least one link must point to a payment function
    const paymentLink = result.links.find((l) =>
      l.entityText === 'payment retry' &&
      (l.targetValue === 'processPayment' || l.targetValue === 'validatePayment'),
    );
    expect(paymentLink).toBeDefined();
    expect(paymentLink!.confidence).toBeGreaterThanOrEqual(0.7);

    // The ABOUT edge must be stored with method = 'embedding_similarity'
    const aboutEdges = await kg.getAboutEdgesForEntity('payment retry', 'Bug');
    expect(aboutEdges.length).toBeGreaterThanOrEqual(1);
    expect(aboutEdges.every((e) => e.method === 'embedding_similarity')).toBe(true);
  });

  // ==========================================================================
  // Scenario 2: Below-threshold → no ABOUT edge
  // ==========================================================================

  it('creates no ABOUT edge when entity embedding is below threshold', async () => {
    // Entity "obscure bug" whose embedding is orthogonal to all code nodes (dim 100)
    await kg.createEntity({ text: 'obscure bug', type: 'Bug', confidence: 0.8 });

    // Mock: orthogonal vector → cosine sim ≈ 0.0 with all code nodes
    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: makeVec(100, 1.0),
      dimensions: DIM,
      provider: 'test',
    });

    const result = await linkByEmbedding(client, kg, {
      threshold: 0.99, // very high — nothing will match
      force: true,
    });

    expect(result.linked).toBe(0);

    const aboutEdges = await kg.getAboutEdgesForEntity('obscure bug', 'Bug');
    expect(aboutEdges).toHaveLength(0);
  });

  // ==========================================================================
  // Scenario 3: Top-K gap documentation
  //
  // The spec expects top-K ABOUT edges (K configurable, default 3).
  // The actual linkByEmbedding implementation picks the SINGLE best match
  // across all node types per entity. This test asserts the actual behavior
  // and documents the gap for future implementation.
  // ==========================================================================

  it('creates at most 1 ABOUT edge per entity (top-K gap: implementation links best match only)', async () => {
    // Entity "payment work" is in the middle of the payment cluster
    await kg.createEntity({ text: 'payment work', type: 'Task', confidence: 0.9 });

    // Mock: embedding near dim 0 — both processPayment and validatePayment are candidates
    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: makeVec(0, 0.92),
      dimensions: DIM,
      provider: 'test',
    });

    const result = await linkByEmbedding(client, kg, { threshold: 0.7, force: true });

    // Current implementation: at most 1 ABOUT edge per entity (best match wins)
    // The spec wanted K=3 but the EmbeddingLinkConfig has no topK parameter.
    const paymentLinks = result.links.filter((l) => l.entityText === 'payment work');
    expect(paymentLinks.length).toBeLessThanOrEqual(1);

    // GAP: If top-K support is added, this test should be updated to assert
    // paymentLinks.length >= 2 (both processPayment and validatePayment should link).
  });

  // ==========================================================================
  // Scenario 4 / 5: Threshold tuning — lower threshold → more edges
  // ==========================================================================

  it('lowering threshold from 0.99 to 0.7 increases linked edge count', async () => {
    // Two entities: one near payment cluster, one near chart cluster
    await kg.createEntity({ text: 'payment issue', type: 'Bug', confidence: 0.9 });
    await kg.createEntity({ text: 'chart render bug', type: 'Bug', confidence: 0.9 });

    // For "payment issue" → near dim 0; for "chart render bug" → near dim 1
    let callCount = 0;
    vi.mocked(generateEmbedding).mockImplementation(async () => {
      callCount++;
      const dim = callCount % 2 === 1 ? 0 : 1;
      return {
        embedding: makeVec(dim, 0.93),
        dimensions: DIM,
        provider: 'test',
      };
    });

    // With very high threshold: no links expected
    const resultHigh = await linkByEmbedding(client, kg, { threshold: 0.999, force: true });
    expect(resultHigh.linked).toBe(0);

    // Clean ABOUT edges and reset call counter for the second run
    await client.query('MATCH ()-[r:ABOUT]->() DELETE r', { params: {} }).catch(() => {});
    callCount = 0;

    // With lower threshold: at least 1 link expected
    const resultLow = await linkByEmbedding(client, kg, { threshold: 0.5, force: true });
    expect(resultLow.linked).toBeGreaterThanOrEqual(1);
    // Lower threshold produces >= edges than higher threshold
    expect(resultLow.linked).toBeGreaterThan(resultHigh.linked);
  });

  // ==========================================================================
  // Scenario 6: Skip-list — Person/Organization/etc. are not linked
  // ==========================================================================

  it('respects the skip-list: Person, Organization, Event, Document, and similar types are not linked', async () => {
    const skipTypes = ['Person', 'Organization', 'Event', 'Document', 'Lesson', 'Goal', 'Constraint', 'Resource'];

    for (const type of skipTypes) {
      await kg.createEntity({ text: `Test ${type}`, type, confidence: 0.9 });
    }

    // Mock: embeddings that would match code nodes above threshold
    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: makeVec(0, 0.95), // near payment cluster
      dimensions: DIM,
      provider: 'test',
    });

    const result = await linkByEmbedding(client, kg, {
      threshold: 0.5, // very permissive — would match if not skipped
      force: true,
    });

    // None of the skip-listed entity types should appear in links
    for (const type of skipTypes) {
      const link = result.links.find((l) => l.entityType === type);
      expect(link).toBeUndefined();
    }

    // All skip-listed entities should be counted as skipped
    expect(result.skipped).toBeGreaterThanOrEqual(skipTypes.length);
  });
});
