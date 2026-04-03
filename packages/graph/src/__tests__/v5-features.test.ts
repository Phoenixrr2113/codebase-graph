/**
 * V5/V5.1 Feature Integration Tests (FalkorDBLite)
 *
 * Tests speaker queries, provenance filtering, fact search,
 * and ABOUT edge querying against an embedded FalkorDBLite instance.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type GraphClient } from '../client';
import { createKnowledgeOperations, type KnowledgeOperations } from '../knowledge-operations';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let falkordbliteAvailable = false;
try {
  await import('falkordblite');
  falkordbliteAvailable = true;
} catch {
  // not installed
}

const describeIfAvailable = falkordbliteAvailable ? describe : describe.skip;

describeIfAvailable('V5 Features (FalkorDBLite)', () => {
  let client: GraphClient;
  let kg: KnowledgeOperations;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'codegraph-v5-'));

    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: `test_v5_${Date.now()}`,
      redisServerPath: '/opt/homebrew/bin/redis-server',
    });

    await client.ensureIndexes();
    kg = createKnowledgeOperations(client);

    // Seed: Speaker entities + SAID relationships
    await kg.createEntity({ text: 'Alice', type: 'Person', confidence: 0.85, sampleId: 'standup-2026-04-01' });
    await kg.createEntity({ text: 'Bob', type: 'Person', confidence: 0.85, sampleId: 'standup-2026-04-01' });
    await kg.createEntity({ text: 'JWT Auth', type: 'Decision', confidence: 0.9, sampleId: 'standup-2026-04-01' });
    await kg.createEntity({ text: 'Redis Cache', type: 'Technology', confidence: 0.9, sampleId: 'retro-2026-04-02' });
    await kg.createEntity({ text: 'Payment Retry', type: 'Pattern', confidence: 0.8, sampleId: 'standup-2026-04-01' });

    // Alice said JWT Auth and Payment Retry
    await kg.createRelationship({
      headText: 'Alice', headType: 'Person',
      tailText: 'JWT Auth', tailType: 'Decision',
      type: 'SAID', confidence: 0.8,
      fact: 'Alice mentioned JWT Auth',
      sampleId: 'standup-2026-04-01',
    });
    await kg.createRelationship({
      headText: 'Alice', headType: 'Person',
      tailText: 'Payment Retry', tailType: 'Pattern',
      type: 'SAID', confidence: 0.8,
      fact: 'Alice mentioned Payment Retry',
      sampleId: 'standup-2026-04-01',
    });

    // Bob said Redis Cache
    await kg.createRelationship({
      headText: 'Bob', headType: 'Person',
      tailText: 'Redis Cache', tailType: 'Technology',
      type: 'SAID', confidence: 0.8,
      fact: 'Bob mentioned Redis Cache',
      sampleId: 'standup-2026-04-01',
    });
  }, 30_000);

  afterAll(async () => {
    if (client) {
      try { await client.query('MATCH (n) DETACH DELETE n', { params: {} }); } catch { /* ok */ }
      await client.close();
    }
    try { await rm(dataDir, { recursive: true, force: true }); } catch { /* ok */ }
  }, 15_000);

  // ========== Speaker Queries ==========

  it('getEntitiesBySpeaker returns entities mentioned by Alice', async () => {
    const results = await kg.getEntitiesBySpeaker('Alice');
    expect(results.length).toBe(2);
    const texts = results.map(r => r.text);
    expect(texts).toContain('JWT Auth');
    expect(texts).toContain('Payment Retry');
  });

  it('getEntitiesBySpeaker returns entities mentioned by Bob', async () => {
    const results = await kg.getEntitiesBySpeaker('Bob');
    expect(results.length).toBe(1);
    expect(results[0]!.text).toBe('Redis Cache');
  });

  it('getEntitiesBySpeaker returns empty for unknown speaker', async () => {
    const results = await kg.getEntitiesBySpeaker('Charlie');
    expect(results.length).toBe(0);
  });

  // ========== Provenance ==========

  it('searchEntitiesBySource finds entities from standup', async () => {
    const results = await kg.searchEntitiesBySource('standup-2026-04-01');
    expect(results.length).toBeGreaterThanOrEqual(3);
    const texts = results.map(r => r.text);
    expect(texts).toContain('Alice');
    expect(texts).toContain('JWT Auth');
  });

  it('searchEntitiesBySource finds entities from retro', async () => {
    const results = await kg.searchEntitiesBySource('retro-2026-04-02');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.some(r => r.text === 'Redis Cache')).toBe(true);
  });

  // ========== ABOUT Edge Querying ==========

  it('createAboutEdge and getAboutEdgesForEntity work', async () => {
    // Create a code node to link to
    await client.query(
      `CREATE (f:Function {name: 'authenticate', filePath: '/src/auth.ts', startLine: 10, endLine: 20})`,
      { params: {} },
    );

    // Create ABOUT edge: JWT Auth → authenticate function
    const created = await kg.createAboutEdge({
      entityText: 'JWT Auth',
      entityType: 'Decision',
      targetLabel: 'Function',
      targetKey: 'name',
      targetValue: 'authenticate',
      confidence: 0.85,
      method: 'embedding_similarity',
    });
    expect(created).toBe(true);

    // Query ABOUT edges for JWT Auth
    const edges = await kg.getAboutEdgesForEntity('JWT Auth', 'Decision');
    expect(edges.length).toBeGreaterThanOrEqual(1);
    expect(edges[0]!.targetValue).toBe('authenticate');
    expect(edges[0]!.confidence).toBe(0.85);
  });

  // ========== Merge Entities ==========

  it('mergeEntities transfers relationships', async () => {
    // Create a duplicate entity
    await kg.createEntity({ text: 'jwt-auth', type: 'Decision', confidence: 0.7 });
    await kg.createRelationship({
      headText: 'jwt-auth', headType: 'Decision',
      tailText: 'Redis Cache', tailType: 'Technology',
      type: 'USES', confidence: 0.6,
    });

    // Merge duplicate into canonical
    const result = await kg.mergeEntities('JWT Auth', 'Decision', 'jwt-auth', 'Decision');
    expect(result.transferredRelationships).toBeGreaterThanOrEqual(1);

    // Verify the canonical now has the transferred relationship
    const rels = await kg.getRelationships({ entityText: 'JWT Auth' });
    const usesRedis = rels.find(r => r.tailText === 'Redis Cache' && r.relationType === 'USES');
    expect(usesRedis).toBeDefined();
  });
});
