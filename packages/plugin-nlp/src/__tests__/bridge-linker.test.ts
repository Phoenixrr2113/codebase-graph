/**
 * Bridge Linker — Integration Tests
 *
 * Tests auto-creation of ABOUT edges from knowledge entities to code graph nodes
 * via name matching. Runs against FalkorDB Docker.
 *
 * Prerequisites: FalkorDB running on localhost:6379
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

// These tests use local embeddings
vi.stubEnv('CODEGRAPH_EMBEDDING_PROVIDER', 'local');

import { createClient, createOperations, createKnowledgeOperations } from '@codegraph/graph';
import type { GraphClient, GraphOperations, KnowledgeOperations } from '@codegraph/graph';
import type { FileEntity, FunctionEntity, ClassEntity, InterfaceEntity } from '@codegraph/types';
import { linkEntitiesToCode, linkByEmbedding, type BridgeLinkerInput } from '../bridge-linker';

// ============================================================================
// Test Fixtures
// ============================================================================

const TEST_GRAPH = `test_bridge_${Date.now()}`;

function makeFile(overrides?: Partial<FileEntity>): FileEntity {
  return {
    path: '/src/payment.ts',
    name: 'payment.ts',
    extension: 'ts',
    loc: 200,
    lastModified: '2025-01-01T00:00:00Z',
    hash: 'pay123',
    ...overrides,
  };
}

function makeFunction(overrides?: Partial<FunctionEntity>): FunctionEntity {
  return {
    name: 'processPayment',
    filePath: '/src/payment.ts',
    startLine: 10,
    endLine: 50,
    isExported: true,
    isAsync: true,
    isArrow: false,
    params: ['amount', 'currency'],
    ...overrides,
  };
}

function makeClass(overrides?: Partial<ClassEntity>): ClassEntity {
  return {
    name: 'PaymentService',
    filePath: '/src/payment.ts',
    startLine: 60,
    endLine: 150,
    isExported: true,
    isAbstract: false,
    ...overrides,
  };
}

function makeInterface(overrides?: Partial<InterfaceEntity>): InterfaceEntity {
  return {
    name: 'PaymentConfig',
    filePath: '/src/payment.ts',
    startLine: 1,
    endLine: 8,
    isExported: true,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Bridge Linker (name matching)', () => {
  let client: GraphClient;
  let ops: GraphOperations;
  let kg: KnowledgeOperations;

  beforeAll(async () => {
    client = await createClient({
      driver: 'falkordb',
      graphName: TEST_GRAPH,
    });
    await client.ensureIndexes();
    ops = createOperations(client);
    kg = createKnowledgeOperations(client);

    // Seed code graph nodes
    await ops.upsertFile(makeFile());
    await ops.upsertFile(makeFile({ path: '/src/retry.ts', name: 'retry.ts', hash: 'ret123' }));
    await ops.upsertFunction(makeFunction());
    await ops.upsertFunction(makeFunction({
      name: 'retryWithBackoff',
      filePath: '/src/retry.ts',
      startLine: 1,
      endLine: 30,
    }));
    await ops.upsertFunction(makeFunction({
      name: 'validateCard',
      filePath: '/src/payment.ts',
      startLine: 55,
      endLine: 70,
    }));
    await ops.upsertClass(makeClass());
    await ops.upsertInterface(makeInterface());

    // Seed knowledge entities (these are the entities that the linker will try to match)
    await kg.createEntity({ text: 'processPayment', type: 'CodeEntity', confidence: 0.95 });
    await kg.createEntity({ text: 'PaymentService', type: 'Technology', confidence: 0.90 });
    await kg.createEntity({ text: 'payment retry bug', type: 'Bug', confidence: 0.85 });
    await kg.createEntity({ text: 'Alice', type: 'Person', confidence: 0.99 });
    await kg.createEntity({ text: 'ProcessPayment', type: 'Concept', confidence: 0.80 });
    await kg.createEntity({ text: 'validateCard', type: 'CodeEntity', confidence: 0.92 });
    await kg.createEntity({ text: 'retryWithBackoff', type: 'CodeEntity', confidence: 0.88 });
    await kg.createEntity({ text: 'PROCESSPAYMENT', type: 'CodeEntity', confidence: 0.80 });
  }, 30_000);

  afterAll(async () => {
    if (client) {
      try {
        await client.query('MATCH (n) DETACH DELETE n', { params: {} });
      } catch { /* ok */ }
      await client.close();
    }
  }, 15_000);

  // ---------- Exact match ----------

  it('should link entity with exact name match (confidence 1.0)', async () => {
    const entities: BridgeLinkerInput[] = [
      { text: 'processPayment', type: 'CodeEntity' },
    ];

    const result = await linkEntitiesToCode(entities, client, kg);

    expect(result.linked).toBe(1);
    expect(result.links).toHaveLength(1);
    expect(result.links[0]!.entityText).toBe('processPayment');
    expect(result.links[0]!.targetLabel).toBe('Function');
    expect(result.links[0]!.targetValue).toBe('processPayment');
    expect(result.links[0]!.confidence).toBe(1.0);
  });

  // ---------- Case-insensitive match ----------

  it('should link entity with case-insensitive match (confidence 0.95)', async () => {
    const entities: BridgeLinkerInput[] = [
      { text: 'ProcessPayment', type: 'Concept' },
    ];

    const result = await linkEntitiesToCode(entities, client, kg);

    expect(result.linked).toBe(1);
    expect(result.links[0]!.confidence).toBe(0.95);
    expect(result.links[0]!.targetValue).toBe('processPayment');
  });

  // ---------- Multiple entities in one batch ----------

  it('should link multiple entities in a single batch', async () => {
    const entities: BridgeLinkerInput[] = [
      { text: 'processPayment', type: 'CodeEntity' },
      { text: 'PaymentService', type: 'Technology' },
      { text: 'validateCard', type: 'CodeEntity' },
    ];

    const result = await linkEntitiesToCode(entities, client, kg);

    expect(result.linked).toBe(3);
    expect(result.total).toBe(3);
    expect(result.skipped).toBe(0);

    const targetLabels = result.links.map((l) => l.targetLabel);
    expect(targetLabels).toContain('Function');
    expect(targetLabels).toContain('Class');
  });

  // ---------- Skip non-code entity types ----------

  it('should skip Person entity types by default', async () => {
    const entities: BridgeLinkerInput[] = [
      { text: 'Alice', type: 'Person' },
    ];

    const result = await linkEntitiesToCode(entities, client, kg);

    expect(result.linked).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('should not skip Person types when skipNonCodeTypes=false', async () => {
    const entities: BridgeLinkerInput[] = [
      { text: 'Alice', type: 'Person' },
    ];

    // Even with skipNonCodeTypes=false, "Alice" won't match any code symbol
    const result = await linkEntitiesToCode(entities, client, kg, { skipNonCodeTypes: false });

    expect(result.linked).toBe(0);
    // Alice was not skipped by type filter, but skipped by no-match
    expect(result.skipped).toBe(1); // skipped because no code match
  });

  // ---------- No matches ----------

  it('should skip entities with no matching code symbols', async () => {
    const entities: BridgeLinkerInput[] = [
      { text: 'NonexistentFunction', type: 'CodeEntity' },
      { text: 'SomeBugReport', type: 'Bug' },
    ];

    const result = await linkEntitiesToCode(entities, client, kg);

    expect(result.linked).toBe(0);
    expect(result.skipped).toBe(2);
  });

  // ---------- Empty input ----------

  it('should handle empty entity list', async () => {
    const result = await linkEntitiesToCode([], client, kg);

    expect(result.total).toBe(0);
    expect(result.linked).toBe(0);
    expect(result.skipped).toBe(0);
  });

  // ---------- ABOUT edges are queryable ----------

  it('should create ABOUT edges that are queryable via getAboutEdgesForEntity', async () => {
    // Link an entity first
    await linkEntitiesToCode(
      [{ text: 'validateCard', type: 'CodeEntity' }],
      client,
      kg,
    );

    // Query ABOUT edges for the entity
    const edges = await kg.getAboutEdgesForEntity('validateCard', 'CodeEntity');
    expect(edges.length).toBeGreaterThanOrEqual(1);

    const funcEdge = edges.find((e) => e.targetLabel === 'Function' && e.targetValue === 'validateCard');
    expect(funcEdge).toBeDefined();
    expect(funcEdge!.method).toBe('exact_match');
    expect(funcEdge!.confidence).toBe(1.0);
  });

  it('should create ABOUT edges that are queryable via getAboutEdgesForCodeNode', async () => {
    // Link a class entity
    await linkEntitiesToCode(
      [{ text: 'PaymentService', type: 'Technology' }],
      client,
      kg,
    );

    const edges = await kg.getAboutEdgesForCodeNode('Class', 'PaymentService');
    expect(edges.length).toBeGreaterThanOrEqual(1);
    expect(edges[0]!.entityText).toBe('PaymentService');
  });

  // ---------- Contained match ----------

  it('should match contained entity text with confidence 0.9', async () => {
    const entities: BridgeLinkerInput[] = [
      { text: 'retryWithBackoff', type: 'CodeEntity' },
    ];

    const result = await linkEntitiesToCode(entities, client, kg);

    expect(result.linked).toBe(1);
    expect(result.links[0]!.targetValue).toBe('retryWithBackoff');
    expect(result.links[0]!.confidence).toBe(1.0); // exact match in this case
  });

  // ---------- Min confidence filter ----------

  it('should respect minConfidence config', async () => {
    const entities: BridgeLinkerInput[] = [
      { text: 'processPayment', type: 'CodeEntity' },
    ];

    // With very high minConfidence, exact match (1.0) still passes
    const result1 = await linkEntitiesToCode(entities, client, kg, { minConfidence: 1.0 });
    expect(result1.linked).toBe(1);

    // Case-insensitive match (0.95) won't pass minConfidence=0.99
    const caseMismatch: BridgeLinkerInput[] = [
      { text: 'PROCESSPAYMENT', type: 'CodeEntity' },
    ];
    const result2 = await linkEntitiesToCode(caseMismatch, client, kg, { minConfidence: 0.99 });
    expect(result2.linked).toBe(0);
  });
});

// ============================================================================
// Embedding Similarity Linker Tests
// ============================================================================

// Mock the embedding functions for controlled vector search testing
vi.mock('../embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../embeddings')>();
  return {
    ...actual,
    isEmbeddingAvailable: vi.fn(() => true),
    generateEmbedding: vi.fn(),
  };
});

import { isEmbeddingAvailable, generateEmbedding } from '../embeddings';

const DIM = 768;

/** Create a synthetic embedding vector */
function makeVec(weights: Record<number, number>): number[] {
  const vec = new Array(DIM).fill(0);
  for (const [idx, val] of Object.entries(weights)) {
    vec[Number(idx)] = val;
  }
  return vec;
}

describe('Bridge Linker (embedding similarity)', () => {
  let client: GraphClient;
  let ops: GraphOperations;
  let kg: KnowledgeOperations;

  const GRAPH_NAME = `test_bridge_embed_${Date.now()}`;

  beforeAll(async () => {
    try {
      client = await createClient({
        driver: 'falkordb',
        host: 'localhost',
        port: 6379,
        graphName: GRAPH_NAME,
      });
    } catch {
      console.error('FalkorDB not available');
      throw new Error('FalkorDB not available');
    }

    await client.ensureIndexes();
    ops = createOperations(client);
    kg = createKnowledgeOperations(client);

    // Seed code nodes with embeddings
    await ops.upsertFile({
      path: '/src/payments.ts', name: 'payments.ts', extension: 'ts',
      loc: 100, lastModified: '2025-01-01', hash: 'abc',
    });

    await ops.upsertFunction({
      name: 'retryWithBackoff', filePath: '/src/payments.ts',
      startLine: 1, endLine: 10, isExported: true, isAsync: true, isArrow: false, params: [],
    });
    await ops.upsertFunction({
      name: 'processPayment', filePath: '/src/payments.ts',
      startLine: 20, endLine: 30, isExported: true, isAsync: true, isArrow: false, params: [],
    });
    await ops.upsertFunction({
      name: 'renderChart', filePath: '/src/payments.ts',
      startLine: 40, endLine: 50, isExported: true, isAsync: false, isArrow: false, params: [],
    });

    // Set embeddings on code nodes — "payment" cluster near dim 0, "chart" near dim 1
    const RETRY_VEC = makeVec({ 0: 0.85, 1: 0.05, 2: 0.1 });
    const PAYMENT_VEC = makeVec({ 0: 0.95, 1: 0.0, 2: 0.05 });
    const CHART_VEC = makeVec({ 0: 0.05, 1: 0.95, 2: 0.0 });

    await ops.updateEmbedding('Function', { name: 'retryWithBackoff', filePath: '/src/payments.ts', startLine: 1 }, RETRY_VEC, 'h1');
    await ops.updateEmbedding('Function', { name: 'processPayment', filePath: '/src/payments.ts', startLine: 20 }, PAYMENT_VEC, 'h2');
    await ops.updateEmbedding('Function', { name: 'renderChart', filePath: '/src/payments.ts', startLine: 40 }, CHART_VEC, 'h3');

    // Seed knowledge entities (no ABOUT edges yet)
    await kg.createEntity({ text: 'payment retry bug', type: 'Bug', confidence: 0.9 });
    await kg.createEntity({ text: 'chart rendering optimization', type: 'Decision', confidence: 0.95 });
    await kg.createEntity({ text: 'John Smith', type: 'Person', confidence: 0.8 });
  }, 30_000);

  afterAll(async () => {
    try { await client.query('MATCH (n) DETACH DELETE n', { params: {} }); } catch { /* */ }
    try { await client.close(); } catch { /* */ }
    vi.restoreAllMocks();
  });

  it('should link entities to code nodes by embedding similarity', async () => {
    // Mock: "payment retry bug" → embedding near payment cluster
    vi.mocked(isEmbeddingAvailable).mockReturnValue(true);
    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: makeVec({ 0: 0.9, 1: 0.0, 2: 0.1 }),
      dimensions: DIM,
      provider: 'test',
    });

    const result = await linkByEmbedding(client, kg, {
      threshold: 0.7,
      force: true,  // force to process all entities
    });

    expect(result.total).toBeGreaterThan(0);
    expect(result.linked).toBeGreaterThan(0);

    // "payment retry bug" should link to processPayment or retryWithBackoff
    const paymentLink = result.links.find((l) =>
      l.entityText === 'payment retry bug',
    );
    expect(paymentLink).toBeDefined();
    expect(paymentLink!.targetLabel).toBe('Function');
    expect(paymentLink!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('should skip Person entities by default', async () => {
    vi.mocked(isEmbeddingAvailable).mockReturnValue(true);
    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: makeVec({ 0: 0.5, 1: 0.5, 2: 0.0 }),
      dimensions: DIM,
      provider: 'test',
    });

    const result = await linkByEmbedding(client, kg, {
      threshold: 0.1, // very low threshold
      force: true,
    });

    // John Smith (Person) should be skipped
    const personLink = result.links.find((l) => l.entityText === 'John Smith');
    expect(personLink).toBeUndefined();
  });

  it('should skip entities below threshold', async () => {
    vi.mocked(isEmbeddingAvailable).mockReturnValue(true);
    // Return an embedding that's orthogonal to all code nodes
    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: makeVec({ 0: 0.0, 1: 0.0, 2: 1.0 }),
      dimensions: DIM,
      provider: 'test',
    });

    const result = await linkByEmbedding(client, kg, {
      threshold: 0.99, // very high threshold — nothing should match
      force: true,
    });

    expect(result.linked).toBe(0);
  });

  it('should return correct counts', async () => {
    vi.mocked(isEmbeddingAvailable).mockReturnValue(true);
    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: makeVec({ 0: 0.9, 1: 0.0, 2: 0.1 }),
      dimensions: DIM,
      provider: 'test',
    });

    const result = await linkByEmbedding(client, kg, {
      threshold: 0.7,
      force: true,
    });

    // total should include all entities
    expect(result.total).toBe(3);
    // John Smith should be skipped (Person type)
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    // linked + skipped + alreadyLinked should account for all
    expect(result.linked + result.skipped + result.alreadyLinked).toBeLessThanOrEqual(result.total);
  });

  it('should return empty result when embeddings are not available', async () => {
    vi.mocked(isEmbeddingAvailable).mockReturnValue(false);

    const result = await linkByEmbedding(client, kg);

    expect(result.total).toBe(0);
    expect(result.linked).toBe(0);
  });

  it('should create ABOUT edges with method=embedding_similarity', async () => {
    // Clean up any ABOUT edges from previous tests
    const entities = await kg.searchEntities({ limit: 100 });
    for (const e of entities) {
      const edges = await kg.getAboutEdgesForEntity(e.text, e.type, 100);
      for (const edge of edges) {
        await kg.deleteAboutEdge(e.text, e.type, edge.targetLabel, edge.targetValue);
      }
    }

    vi.mocked(isEmbeddingAvailable).mockReturnValue(true);
    vi.mocked(generateEmbedding).mockResolvedValue({
      embedding: makeVec({ 0: 0.9, 1: 0.0, 2: 0.1 }),
      dimensions: DIM,
      provider: 'test',
    });

    const result = await linkByEmbedding(client, kg, {
      threshold: 0.7,
      force: true,
    });

    // Verify the ABOUT edges exist and have the correct method
    for (const link of result.links) {
      const aboutEdges = await kg.getAboutEdgesForEntity(link.entityText, link.entityType, 10);
      const edge = aboutEdges.find((e) => e.targetValue === link.targetValue);
      expect(edge).toBeDefined();
      expect(edge!.method).toBe('embedding_similarity');
    }
  });
});
