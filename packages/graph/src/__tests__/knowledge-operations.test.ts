/**
 * Knowledge Graph Operations — Integration Tests
 *
 * Tests Entity + RELATES_TO schema creation and CRUD operations
 * against a real Kuzu database instance.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type GraphClient, createKnowledgeOperations, type KnowledgeOperations } from '../index';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Knowledge Graph Operations (Kuzu)', () => {
  let client: GraphClient;
  let ops: KnowledgeOperations;
  let dbPath: string;

  beforeAll(async () => {
    // Create a temp parent directory, then use a subdirectory for Kuzu
    // (Kuzu creates the database directory itself — it must not already exist)
    const parentDir = mkdtempSync(join(tmpdir(), 'codegraph-kg-test-'));
    dbPath = join(parentDir, 'kuzu-db');

    client = await createClient({
      driver: 'kuzu',
      databasePath: dbPath,
      graphName: 'test',
    });

    await client.ensureIndexes();
    ops = createKnowledgeOperations(client);
  });

  afterAll(async () => {
    try {
      await client.close();
    } catch {
      // Kuzu SIGSEGV on close is known — ignore
    }
    // Clean up temp directory (parent of dbPath)
    try {
      rmSync(join(dbPath, '..'), { recursive: true, force: true });
    } catch {
      // best effort
    }
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

  it('should get entity by ID', async () => {
    const id = await ops.createEntity({
      text: 'PaymentGateway',
      type: 'Concept',
      confidence: 0.85,
    });

    const entity = await ops.getEntity(id);
    expect(entity).toBeTruthy();
    expect(entity!.text).toBe('PaymentGateway');
    expect(entity!.type).toBe('Concept');
  });

  it('should get entity by text+type', async () => {
    await ops.createEntity({
      text: 'Sprint Planning Meeting',
      type: 'Event',
      confidence: 0.9,
    });

    const entity = await ops.getEntityByText('Sprint Planning Meeting', 'Event');
    expect(entity).toBeTruthy();
    expect(entity!.text).toBe('Sprint Planning Meeting');
  });

  it('should return null for non-existent entity', async () => {
    const entity = await ops.getEntity('non-existent-id');
    expect(entity).toBeNull();
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
    await ops.createEntity({ text: 'Use Kuzu for graph storage', type: 'Decision' });

    await ops.createRelationship({
      headText: 'Randy',
      headType: 'Person',
      tailText: 'Use Kuzu for graph storage',
      tailType: 'Decision',
      type: 'DECIDED',
      confidence: 0.95,
      fact: 'Randy decided to use Kuzu for graph storage',
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
      tailText: 'Use Kuzu for graph storage',
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
  // Cleanup
  // ============================

  it('should delete all knowledge data', async () => {
    await ops.deleteAllKnowledge();
    const stats = await ops.getMemoryStats();
    expect(stats.totalEntities).toBe(0);
  });
});
