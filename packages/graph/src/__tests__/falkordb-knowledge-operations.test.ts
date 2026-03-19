/**
 * Knowledge Graph Operations — FalkorDB Integration Tests
 *
 * Tests Entity + RELATES_TO CRUD, temporal memory, and vector search
 * against a real FalkorDB Docker instance (localhost:6379).
 *
 * Prerequisites: docker compose up -d falkordb
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type GraphClient, createKnowledgeOperations, type KnowledgeOperations } from '../index';

const GRAPH_NAME = `test_kg_${Date.now()}`;

describe('Knowledge Graph Operations (FalkorDB)', () => {
  let client: GraphClient;
  let ops: KnowledgeOperations;

  beforeAll(async () => {
    try {
      client = await createClient({
        driver: 'falkordb',
        host: 'localhost',
        port: 6379,
        graphName: GRAPH_NAME,
      });
    } catch (error) {
      console.error('FalkorDB not available — skipping tests. Run: docker compose up -d falkordb');
      throw error;
    }

    await client.ensureIndexes();
    ops = createKnowledgeOperations(client);
  });

  afterAll(async () => {
    // Drop the test graph to clean up
    try {
      await client.query(`MATCH (n) DETACH DELETE n`, { params: {} });
    } catch { /* best effort */ }
    try {
      await client.close();
    } catch { /* best effort */ }
  });

  // ============================
  // Entity CRUD
  // ============================

  it('should create a new entity', async () => {
    const id = await ops.createEntity({
      text: 'authorizePayment',
      type: 'Function',
      confidence: 0.95,
    });

    expect(id).toBeTruthy();
    expect(typeof id).toBe('string');
  });

  it('should deduplicate entities by text+type', async () => {
    const id1 = await ops.createEntity({
      text: 'UserService',
      type: 'Class',
      confidence: 0.9,
      sampleId: 'sample-1',
    });

    const id2 = await ops.createEntity({
      text: 'UserService',
      type: 'Class',
      confidence: 0.95,
      sampleId: 'sample-2',
    });

    // Same entity should return same ID
    expect(id2).toBe(id1);
  });

  it('should search entities by type', async () => {
    await ops.createEntity({ text: 'Alice', type: 'Person' });
    await ops.createEntity({ text: 'Bob', type: 'Person' });
    await ops.createEntity({ text: 'Project Alpha', type: 'Project' });

    const people = await ops.searchEntities({ type: 'Person' });
    expect(people.length).toBeGreaterThanOrEqual(2);
    expect(people.every(p => p.type === 'Person')).toBe(true);
  });

  it('should search entities by text content', async () => {
    await ops.createEntity({ text: 'Payment Authorization System', type: 'Concept' });

    const results = await ops.searchEntities({ textContains: 'Payment' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(r => r.text.includes('Payment'))).toBe(true);
  });

  // ============================
  // Relationship CRUD
  // ============================

  it('should create a relationship between entities', async () => {
    await ops.createEntity({ text: 'Randy', type: 'Person' });
    await ops.createEntity({ text: 'Use FalkorDB for graph storage', type: 'Decision' });

    await ops.createRelationship({
      headText: 'Randy',
      headType: 'Person',
      tailText: 'Use FalkorDB for graph storage',
      tailType: 'Decision',
      type: 'DECIDED',
      confidence: 0.95,
      fact: 'Randy decided to use FalkorDB for graph storage',
    });

    const rels = await ops.getRelationships({ entityText: 'Randy' });
    expect(rels.length).toBeGreaterThanOrEqual(1);
    expect(rels.some(r => r.relationType === 'DECIDED')).toBe(true);
  });

  it('should deduplicate relationships', async () => {
    // Create same relationship again
    await ops.createRelationship({
      headText: 'Randy',
      headType: 'Person',
      tailText: 'Use FalkorDB for graph storage',
      tailType: 'Decision',
      type: 'DECIDED',
      confidence: 0.95,
      sampleId: 'sample-2',
    });

    // Should still have just one DECIDED relationship
    const rels = await ops.getRelationships({ entityText: 'Randy' });
    const decided = rels.filter(r => r.relationType === 'DECIDED');
    expect(decided.length).toBe(1);
  });

  it('should query relationships by type', async () => {
    const rels = await ops.getRelationships({ relationType: 'DECIDED' });
    expect(rels.length).toBeGreaterThanOrEqual(1);
    expect(rels.every(r => r.relationType === 'DECIDED')).toBe(true);
  });

  // ============================
  // Temporal Memory
  // ============================

  it('should touch an entity to refresh relevance', async () => {
    await ops.createEntity({ text: 'Temporal Test Entity', type: 'Concept' });
    const touched = await ops.touchEntity('Temporal Test Entity', 'Concept');
    expect(touched).toBe(true);
  });

  it('should return false when touching non-existent entity', async () => {
    const touched = await ops.touchEntity('NonExistent', 'Unknown');
    expect(touched).toBe(false);
  });

  it('should get memory stats', async () => {
    const stats = await ops.getMemoryStats();
    expect(stats.totalEntities).toBeGreaterThan(0);
    expect(stats.avgRelevance).toBeGreaterThan(0);
    expect(stats.oldestAccess).toBeTruthy();
    expect(stats.newestAccess).toBeTruthy();
  });

  // ============================
  // Batch Import
  // ============================

  it('should batch import entities and relationships', async () => {
    const result = await ops.importEntitiesAndRelationships(
      [
        { text: 'Import Test Person', type: 'Person' },
        { text: 'Import Test Decision', type: 'Decision' },
      ],
      [
        {
          headText: 'Import Test Person',
          headType: 'Person',
          tailText: 'Import Test Decision',
          tailType: 'Decision',
          type: 'DECIDED',
        },
      ],
      'import-test-sample'
    );

    expect(result.entities).toBe(2);
    expect(result.relationships).toBe(1);
  });

  // ============================
  // Vector Search (FalkorDB native HNSW)
  // ============================

  it('should create entities with embeddings and search by vector', async () => {
    // Create entities with 768-dim embeddings (padded with zeros for test)
    const makeEmbedding = (seed: number): number[] => {
      const emb = new Array(768).fill(0);
      for (let i = 0; i < 10; i++) emb[i] = seed + i * 0.1;
      // Normalize
      const mag = Math.sqrt(emb.reduce((s, v) => s + v * v, 0));
      return emb.map(v => v / mag);
    };

    const emb1 = makeEmbedding(1.0);  // "payment" entity
    const emb2 = makeEmbedding(1.05); // "billing" entity — close to payment
    const emb3 = makeEmbedding(5.0);  // "authentication" entity — far from payment

    await ops.createEntity({
      text: 'processPayment',
      type: 'Function',
      confidence: 0.95,
      embedding: emb1,
    });

    await ops.createEntity({
      text: 'calculateBilling',
      type: 'Function',
      confidence: 0.9,
      embedding: emb2,
    });

    await ops.createEntity({
      text: 'authenticateUser',
      type: 'Function',
      confidence: 0.9,
      embedding: emb3,
    });

    // Search for entities similar to emb1 (payment)
    const results = await ops.searchEntitiesByVector(emb1, 2);

    expect(results.length).toBeGreaterThanOrEqual(1);
    // processPayment should be closest (exact match on embedding)
    expect(results[0]!.text).toBe('processPayment');
    // calculateBilling should be second (close embedding)
    if (results.length >= 2) {
      expect(results[1]!.text).toBe('calculateBilling');
    }
  });

});
