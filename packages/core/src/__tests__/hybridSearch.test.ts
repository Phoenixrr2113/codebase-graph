/**
 * Hybrid Search — Integration Tests
 *
 * Tests the hybrid search orchestration against a real Kuzu database.
 * Acceptance criteria:
 *   1. Hybrid search finds results from both code and knowledge graphs
 *   2. Graph traversal expands results with related nodes
 *   3. Falls back to text-only search when no embeddings exist
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  createClient,
  type GraphClient,
  createOperations,
  type GraphOperations,
  createKnowledgeOperations,
  type KnowledgeOperations,
  ALL_DDL,
  VECTOR_INDEX_STMTS,
} from '@codegraph/graph';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Mock the plugin-nlp embedding functions
vi.mock('@codegraph/plugin-nlp', () => ({
  isEmbeddingAvailable: vi.fn(() => false),
  generateEmbedding: vi.fn(),
}));

import { isEmbeddingAvailable, generateEmbedding } from '@codegraph/plugin-nlp';
import { hybridSearch } from '../hybridSearch';

// ============================================================================
// Test Data
// ============================================================================

const DIM = 768;

/** Create a synthetic vector with weight on specific dimensions */
function makeVec(weights: Record<number, number>): number[] {
  const vec = new Array(DIM).fill(0);
  for (const [idx, val] of Object.entries(weights)) {
    vec[Number(idx)] = val;
  }
  return vec;
}

// Predefined embeddings for test data
const PAYMENT_VEC = makeVec({ 0: 1.0, 1: 0.0, 2: 0.1 });
const CARD_VEC = makeVec({ 0: 0.9, 1: 0.1, 2: 0.1 });
const CHART_VEC = makeVec({ 0: 0.1, 1: 0.9, 2: 0.0 });
const ENTITY_VEC = makeVec({ 0: 0.8, 1: 0.0, 2: 0.2 });

// ============================================================================
// Tests
// ============================================================================

describe('Hybrid Search (Kuzu)', () => {
  let client: GraphClient;
  let ops: GraphOperations;
  let kgOps: KnowledgeOperations;
  let parentDir: string;

  beforeAll(async () => {
    parentDir = mkdtempSync(join(tmpdir(), 'codegraph-hybrid-test-'));
    const dbPath = join(parentDir, 'kuzu-db');

    client = await createClient({
      driver: 'kuzu',
      databasePath: dbPath,
      graphName: 'test',
    });

    // Step 1: Create tables (no vector indexes yet — allows SET on embedding)
    for (const ddl of ALL_DDL) {
      try { await client.query(ddl); } catch { /* skip existing */ }
    }

    ops = createOperations(client);
    kgOps = createKnowledgeOperations(client);

    // Step 2: Populate code graph
    const filePath = '/src/payments.ts';
    const helperPath = '/src/helpers.ts';

    await ops.upsertFile({
      path: filePath, name: 'payments.ts', extension: 'ts',
      loc: 100, lastModified: '2025-01-01T00:00:00Z', hash: 'abc',
    });
    await ops.upsertFile({
      path: helperPath, name: 'helpers.ts', extension: 'ts',
      loc: 50, lastModified: '2025-01-01T00:00:00Z', hash: 'def',
    });

    // Functions
    await ops.upsertFunction({
      name: 'processPayment', filePath, startLine: 1, endLine: 10,
      isExported: true, isAsync: true, isArrow: false, params: [],
    });
    await ops.upsertFunction({
      name: 'validateCard', filePath, startLine: 15, endLine: 25,
      isExported: true, isAsync: false, isArrow: false, params: [],
    });
    await ops.upsertFunction({
      name: 'renderChart', filePath, startLine: 30, endLine: 40,
      isExported: true, isAsync: false, isArrow: false, params: [],
    });
    await ops.upsertFunction({
      name: 'formatCurrency', filePath: helperPath, startLine: 1, endLine: 8,
      isExported: true, isAsync: false, isArrow: false, params: [],
    });

    // Edges: processPayment → validateCard (CALLS), processPayment → formatCurrency (CALLS)
    await ops.createCallEdge('processPayment', filePath, 'validateCard', filePath, 5);
    await ops.createCallEdge('processPayment', filePath, 'formatCurrency', helperPath, 7);
    await ops.createImportsEdge(filePath, helperPath, ['formatCurrency']);

    // Set embeddings on code nodes
    await ops.updateEmbedding(
      'Function', { name: 'processPayment', filePath, startLine: 1 },
      PAYMENT_VEC, 'hash-payment',
    );
    await ops.updateEmbedding(
      'Function', { name: 'validateCard', filePath, startLine: 15 },
      CARD_VEC, 'hash-card',
    );
    await ops.updateEmbedding(
      'Function', { name: 'renderChart', filePath, startLine: 30 },
      CHART_VEC, 'hash-chart',
    );

    // Step 3: Populate knowledge graph
    await kgOps.createEntity({
      text: 'Payment Gateway Integration',
      type: 'Decision',
      confidence: 0.95,
      embedding: ENTITY_VEC,
    });

    // Step 4: Create vector indexes AFTER data is populated
    for (const stmt of VECTOR_INDEX_STMTS) {
      try { await client.query(stmt); } catch { /* skip existing */ }
    }
  }, 30000);

  afterAll(async () => {
    try { await client.close(); } catch { /* Kuzu SIGSEGV on close — ignore */ }
    try { rmSync(parentDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  // --------------------------------------------------------------------------
  // Test: text-only fallback (no embeddings)
  // --------------------------------------------------------------------------

  it('falls back to text-only search when no embeddings available', async () => {
    vi.mocked(isEmbeddingAvailable).mockReturnValue(false);

    const result = await hybridSearch('payment', client, {
      includeKnowledge: true,
      expandGraph: false,
    });

    // Should find processPayment via text search
    expect(result.meta.embeddingAvailable).toBe(false);
    expect(result.meta.vectorHits).toBe(0);
    expect(result.meta.textHits).toBeGreaterThan(0);
    expect(result.hits.length).toBeGreaterThan(0);

    const names = result.hits.map(h => h.name);
    expect(names).toContain('processPayment');

    // Should only have 'text' source
    for (const hit of result.hits) {
      expect(hit.sources).toContain('text');
      expect(hit.sources).not.toContain('vector');
    }
  });

  // --------------------------------------------------------------------------
  // Test: hybrid search with vector + text + knowledge
  // --------------------------------------------------------------------------

  it('finds results from both code and knowledge graphs', async () => {
    // Enable embeddings and return a synthetic query vector near payment
    vi.mocked(isEmbeddingAvailable).mockReturnValue(true);
    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: makeVec({ 0: 0.95, 1: 0.0, 2: 0.15 }),
      dimensions: DIM,
      provider: 'test',
    });

    const result = await hybridSearch('payment', client, {
      includeKnowledge: true,
      expandGraph: false,
    });

    expect(result.meta.embeddingAvailable).toBe(true);
    expect(result.hits.length).toBeGreaterThan(0);

    // Should have both vector and text hits
    expect(result.meta.vectorHits).toBeGreaterThan(0);
    expect(result.meta.textHits).toBeGreaterThan(0);

    // processPayment should be found (via both vector + text)
    const paymentHit = result.hits.find(h => h.name === 'processPayment');
    expect(paymentHit).toBeDefined();
    expect(paymentHit!.sources).toContain('vector');
    expect(paymentHit!.sources).toContain('text');
    // Multi-source hit should have higher score than single-source
    expect(paymentHit!.score).toBeGreaterThan(0);

    // Knowledge entity should be found
    const entityHit = result.hits.find(h => h.nodeType === 'Entity');
    expect(entityHit).toBeDefined();
    expect(entityHit!.name).toContain('Payment');
  });

  // --------------------------------------------------------------------------
  // Test: graph traversal
  // --------------------------------------------------------------------------

  it('graph traversal expands results with related nodes', async () => {
    vi.mocked(isEmbeddingAvailable).mockReturnValue(true);
    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: makeVec({ 0: 0.95, 1: 0.0, 2: 0.15 }),
      dimensions: DIM,
      provider: 'test',
    });

    const result = await hybridSearch('payment', client, {
      includeKnowledge: false,
      expandGraph: true,
      maxHops: 1,
    });

    expect(result.hits.length).toBeGreaterThan(0);

    // processPayment CALLS validateCard and formatCurrency
    // Graph traversal should find these as related nodes
    expect(result.related.length).toBeGreaterThan(0);
    expect(result.meta.graphExpanded).toBeGreaterThan(0);

    const relatedNames = result.related.map(r => r.name);
    // Should find at least one of the called functions
    const hasCalledFunction = relatedNames.includes('validateCard') ||
                               relatedNames.includes('formatCurrency');
    expect(hasCalledFunction).toBe(true);

    // Related hits should reference a source hit
    for (const rel of result.related) {
      expect(rel.sourceKey).toBeTruthy();
      expect(rel.edgeLabel).toBeTruthy();
      expect(['outgoing', 'incoming']).toContain(rel.direction);
    }
  });

  // --------------------------------------------------------------------------
  // Test: scope filtering
  // --------------------------------------------------------------------------

  it('scope filter limits results to specific file path', async () => {
    vi.mocked(isEmbeddingAvailable).mockReturnValue(false);

    const result = await hybridSearch('format', client, {
      includeKnowledge: false,
      expandGraph: false,
      scope: '/src/helpers',
    });

    // formatCurrency is in /src/helpers.ts — should be found
    // processPayment is in /src/payments.ts — should be excluded
    for (const hit of result.hits) {
      if (hit.filePath) {
        expect(hit.filePath.startsWith('/src/helpers')).toBe(true);
      }
    }
  });

  // --------------------------------------------------------------------------
  // Test: result deduplication
  // --------------------------------------------------------------------------

  it('deduplicates results found by both vector and text search', async () => {
    vi.mocked(isEmbeddingAvailable).mockReturnValue(true);
    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: makeVec({ 0: 0.95, 1: 0.0, 2: 0.15 }),
      dimensions: DIM,
      provider: 'test',
    });

    const result = await hybridSearch('processPayment', client, {
      includeKnowledge: false,
      expandGraph: false,
    });

    // processPayment should appear exactly once, even though it matches both vector + text
    const paymentHits = result.hits.filter(h => h.name === 'processPayment');
    expect(paymentHits.length).toBe(1);

    // The deduplicated hit should have both sources
    expect(paymentHits[0]!.sources).toContain('vector');
    expect(paymentHits[0]!.sources).toContain('text');
  });
});
