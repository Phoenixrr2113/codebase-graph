/**
 * Temporal Query Integration Tests (FalkorDBLite)
 *
 * Tests point-in-time, range, timeline, relevance, provenance,
 * and fact search queries against an embedded FalkorDBLite instance.
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

describeIfAvailable('Temporal Queries (FalkorDBLite)', () => {
  let client: GraphClient;
  let kg: KnowledgeOperations;
  let dataDir: string;

  // Fixed timestamps for deterministic testing
  const T1 = 1700000000000; // Nov 14, 2023
  const T2 = 1700100000000; // ~1 day later
  const T3 = 1700200000000; // ~2 days later

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'codegraph-temporal-'));

    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: `test_temporal_${Date.now()}`,
      redisServerPath: '/opt/homebrew/bin/redis-server',
    });

    await client.ensureIndexes();
    kg = createKnowledgeOperations(client);

    // Seed test data: entities
    await kg.createEntity({ text: 'AuthModule', type: 'CodeEntity', confidence: 0.9 });
    await kg.createEntity({ text: 'JWT', type: 'Technology', confidence: 0.95 });
    await kg.createEntity({ text: 'SessionToken', type: 'Technology', confidence: 0.8 });
    await kg.createEntity({ text: 'PaymentService', type: 'Service', confidence: 0.9 });

    // Relationship 1: established at T1, still valid
    await kg.createRelationship({
      headText: 'AuthModule',
      headType: 'CodeEntity',
      tailText: 'JWT',
      tailType: 'Technology',
      type: 'USES',
      confidence: 0.9,
      fact: 'Auth module uses JWT for authentication',
      validAt: T1,
    });

    // Relationship 2: established at T1, superseded at T2
    await kg.createRelationship({
      headText: 'AuthModule',
      headType: 'CodeEntity',
      tailText: 'SessionToken',
      tailType: 'Technology',
      type: 'USES',
      confidence: 0.7,
      fact: 'Auth module used session tokens',
      validAt: T1,
    });
    // Invalidate it at T2 (set invalid_at directly to T2 for deterministic testing)
    await client.query(
      `MATCH (h:Entity)-[r:RELATES_TO]->(t:Entity)
       WHERE h.text = 'AuthModule' AND t.text = 'SessionToken' AND r.type = 'USES'
       SET r.invalid_at = $t2`,
      { params: { t2: T2 } },
    );

    // Relationship 3: established at T3
    await kg.createRelationship({
      headText: 'PaymentService',
      headType: 'Service',
      tailText: 'JWT',
      tailType: 'Technology',
      type: 'USES',
      confidence: 0.85,
      fact: 'Payment service adopted JWT for API auth',
      validAt: T3,
    });
  }, 30_000);

  afterAll(async () => {
    if (client) {
      try { await client.query('MATCH (n) DETACH DELETE n', { params: {} }); } catch { /* ok */ }
      await client.close();
    }
    try { await rm(dataDir, { recursive: true, force: true }); } catch { /* ok */ }
  }, 15_000);

  // ========== Point-in-time ==========

  it('queryAtPointInTime returns facts valid at a given timestamp', async () => {
    // At T1+1ms: both AuthModule→JWT and AuthModule→SessionToken should be valid
    const results = await kg.queryAtPointInTime(T1 + 1);
    expect(results.length).toBeGreaterThanOrEqual(2);

    const authJwt = results.find(r => r.headText === 'AuthModule' && r.tailText === 'JWT');
    expect(authJwt).toBeDefined();

    const authSession = results.find(r => r.headText === 'AuthModule' && r.tailText === 'SessionToken');
    expect(authSession).toBeDefined();
  });

  it('queryAtPointInTime excludes invalidated facts', async () => {
    // At T3: SessionToken relationship was invalidated at T2, should NOT appear
    const results = await kg.queryAtPointInTime(T3);
    const authSession = results.find(r => r.headText === 'AuthModule' && r.tailText === 'SessionToken');
    expect(authSession).toBeUndefined();

    // But AuthModule→JWT should still be valid
    const authJwt = results.find(r => r.headText === 'AuthModule' && r.tailText === 'JWT');
    expect(authJwt).toBeDefined();
  });

  // ========== Range queries ==========

  it('queryChangesInRange returns established and superseded facts', async () => {
    // Query full range: should see all established + the invalidation
    const results = await kg.queryChangesInRange(T1 - 1, T3 + 1);
    expect(results.length).toBeGreaterThanOrEqual(3);

    const established = results.filter(r => r.change === 'established');
    expect(established.length).toBeGreaterThanOrEqual(2);

    const superseded = results.filter(r => r.change === 'superseded');
    expect(superseded.length).toBeGreaterThanOrEqual(1);
  });

  it('queryChangesInRange with narrow window', async () => {
    // Query only around T3: should only see PaymentService→JWT established
    const results = await kg.queryChangesInRange(T3 - 1, T3 + 1);
    const established = results.filter(r => r.change === 'established');
    expect(established.length).toBeGreaterThanOrEqual(1);
    const payment = established.find(r => r.headText === 'PaymentService');
    expect(payment).toBeDefined();
  });

  // ========== Entity timeline ==========

  it('getEntityTimeline returns chronological history', async () => {
    const timeline = await kg.getEntityTimeline('AuthModule');
    expect(timeline.length).toBeGreaterThanOrEqual(2);

    // Should include both active and inactive entries
    const active = timeline.filter(t => t.isActive);
    const inactive = timeline.filter(t => !t.isActive);
    expect(active.length).toBeGreaterThanOrEqual(1); // JWT relationship still active
    expect(inactive.length).toBeGreaterThanOrEqual(1); // SessionToken was invalidated
  });

  it('getEntityTimeline with type filter', async () => {
    const timeline = await kg.getEntityTimeline('AuthModule', 'CodeEntity');
    expect(timeline.length).toBeGreaterThanOrEqual(2);
  });

  // ========== Relevance search ==========

  it('searchByRelevance returns entities above threshold', async () => {
    // All entities were just created, so relevance should be 1.0
    const results = await kg.searchByRelevance({ minRelevance: 0.5 });
    expect(results.length).toBeGreaterThanOrEqual(4);
    for (const r of results) {
      expect(r.relevanceScore).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('searchByRelevance with high threshold', async () => {
    const results = await kg.searchByRelevance({ minRelevance: 2.0 });
    // No entity should have relevance > 2.0
    expect(results.length).toBe(0);
  });

  // ========== Provenance ==========

  it('searchEntitiesBySource filters by sampleId prefix', async () => {
    // Create an entity with a known sampleId
    await kg.createEntity({
      text: 'ProvenanceTest',
      type: 'Concept',
      confidence: 0.9,
      sampleId: 'meeting-2024-01-15-abc123',
    });

    const results = await kg.searchEntitiesBySource('meeting-2024-01-15');
    expect(results.length).toBeGreaterThanOrEqual(1);
    const found = results.find(r => r.text === 'ProvenanceTest');
    expect(found).toBeDefined();
  });

  it('searchEntitiesBySource returns empty for unknown prefix', async () => {
    const results = await kg.searchEntitiesBySource('nonexistent-prefix-xyz');
    expect(results.length).toBe(0);
  });
});
