/**
 * Conversation / SAID Edge Integration Tests (FalkorDBLite)
 *
 * Tests speaker attribution in the knowledge graph layer:
 * - Person node creation for speakers
 * - SAID edge creation linking Person → Entity
 * - Multi-speaker attribution correctness
 * - Person node deduplication across separate ingest sessions
 * - Recall by speaker (getEntitiesBySpeaker)
 * - SAID edges preserved across bitemporal supersession
 *
 * This tests the KnowledgeOperations layer directly (not the full NLP pipeline).
 * The NLP pipeline integration tests live in packages/plugin-nlp/src/__tests__/.
 *
 * Prerequisites: falkordblite (embedded) — no Docker needed.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient, type GraphClient } from '../client';
import { createKnowledgeOperations, type KnowledgeOperations } from '../knowledge-operations';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ============================================================================
// Availability guard
// ============================================================================

let falkordbliteAvailable = false;
try {
  await import('falkordblite');
  falkordbliteAvailable = true;
} catch {
  // not installed
}

const describeIfAvailable = falkordbliteAvailable ? describe : describe.skip;

// ============================================================================
// Tests
// ============================================================================

describeIfAvailable('Conversation / SAID edges (FalkorDBLite)', () => {
  let client: GraphClient;
  let kg: KnowledgeOperations;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'codegraph-said-'));

    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: `test_said_${Date.now()}`,
      redisServerPath: '/opt/homebrew/bin/redis-server',
    });

    // Pass embeddingDim so vector indexes are created regardless of env vars.
    await client.ensureIndexes({ embeddingDim: 768 });
    kg = createKnowledgeOperations(client);
  }, 30_000);

  afterAll(async () => {
    if (client) {
      try { await client.query('MATCH (n) DETACH DELETE n', { params: {} }); } catch { /* ok */ }
      await client.close();
    }
    try { await rm(dataDir, { recursive: true, force: true }); } catch { /* ok */ }
  }, 15_000);

  beforeEach(async () => {
    // Clean between tests to prevent cross-test interference
    try { await client.query('MATCH (n) DETACH DELETE n', { params: {} }); } catch { /* ok */ }
  });

  // ==========================================================================
  // Scenario 1: Single-speaker conversation
  // ==========================================================================

  it('creates a Person node and SAID edges to extracted facts', async () => {
    // Simulate what the NLP pipeline does after extracting entities from
    // "Alice: We should use Redis for caching"
    await kg.createEntity({ text: 'Alice', type: 'Person', confidence: 0.9, sampleId: 'conv-1' });
    await kg.createEntity({ text: 'Redis', type: 'Technology', confidence: 0.95, sampleId: 'conv-1' });

    await kg.createRelationship({
      headText: 'Alice',
      headType: 'Person',
      tailText: 'Redis',
      tailType: 'Technology',
      type: 'SAID',
      confidence: 0.9,
      fact: 'Alice mentioned Redis',
      sampleId: 'conv-1',
    });

    // Person node must exist
    const persons = await kg.searchEntities({ type: 'Person' });
    expect(persons.map((p) => p.text)).toContain('Alice');

    // getEntitiesBySpeaker returns the fact
    const aliceFacts = await kg.getEntitiesBySpeaker('Alice');
    expect(aliceFacts.length).toBeGreaterThanOrEqual(1);
    const texts = aliceFacts.map((f) => f.text);
    expect(texts).toContain('Redis');
  });

  // ==========================================================================
  // Scenario 2: Multi-speaker conversation — attribution correctness
  // ==========================================================================

  it('attributes facts to the correct speaker in multi-speaker conversations', async () => {
    // Alice says Redis; Bob says BullMQ
    await kg.createEntity({ text: 'Alice', type: 'Person', confidence: 0.9 });
    await kg.createEntity({ text: 'Bob', type: 'Person', confidence: 0.9 });
    await kg.createEntity({ text: 'Redis', type: 'Technology', confidence: 0.9 });
    await kg.createEntity({ text: 'BullMQ', type: 'Technology', confidence: 0.9 });

    await kg.createRelationship({
      headText: 'Alice', headType: 'Person',
      tailText: 'Redis', tailType: 'Technology',
      type: 'SAID', confidence: 0.85,
      fact: 'Alice mentioned Redis',
    });
    await kg.createRelationship({
      headText: 'Bob', headType: 'Person',
      tailText: 'BullMQ', tailType: 'Technology',
      type: 'SAID', confidence: 0.85,
      fact: 'Bob mentioned BullMQ',
    });

    const aliceFacts = await kg.getEntitiesBySpeaker('Alice');
    const bobFacts = await kg.getEntitiesBySpeaker('Bob');

    // Alice gets exactly Redis
    expect(aliceFacts.map((f) => f.text)).toContain('Redis');
    expect(aliceFacts.map((f) => f.text)).not.toContain('BullMQ');

    // Bob gets exactly BullMQ
    expect(bobFacts.map((f) => f.text)).toContain('BullMQ');
    expect(bobFacts.map((f) => f.text)).not.toContain('Redis');
  });

  // ==========================================================================
  // Scenario 3: Person node reuse across separate conversations
  // ==========================================================================

  it('reuses a single Person node when the same speaker appears in two conversations', async () => {
    // First conversation — Alice mentions Redis
    await kg.createEntity({ text: 'Alice', type: 'Person', confidence: 0.9, sampleId: 'conv-a' });
    await kg.createEntity({ text: 'Redis', type: 'Technology', confidence: 0.9, sampleId: 'conv-a' });
    await kg.createRelationship({
      headText: 'Alice', headType: 'Person',
      tailText: 'Redis', tailType: 'Technology',
      type: 'SAID', confidence: 0.8,
      fact: 'Alice mentioned Redis',
      sampleId: 'conv-a',
    });

    // Second conversation — Alice mentions JWT
    // createEntity uses MERGE semantics, so Alice should be reused
    await kg.createEntity({ text: 'Alice', type: 'Person', confidence: 0.92, sampleId: 'conv-b' });
    await kg.createEntity({ text: 'JWT', type: 'Technology', confidence: 0.9, sampleId: 'conv-b' });
    await kg.createRelationship({
      headText: 'Alice', headType: 'Person',
      tailText: 'JWT', tailType: 'Technology',
      type: 'SAID', confidence: 0.85,
      fact: 'Alice mentioned JWT',
      sampleId: 'conv-b',
    });

    // Only one Person node for Alice
    const persons = await kg.searchEntities({ type: 'Person' });
    const aliceNodes = persons.filter((p) => p.text === 'Alice');
    expect(aliceNodes).toHaveLength(1);

    // SAID edges from both conversations are accessible
    const aliceFacts = await kg.getEntitiesBySpeaker('Alice');
    const factTexts = aliceFacts.map((f) => f.text);
    expect(factTexts).toContain('Redis');
    expect(factTexts).toContain('JWT');
  });

  // ==========================================================================
  // Scenario 4: Recall by speaker — returns only that speaker's facts
  // ==========================================================================

  it('getEntitiesBySpeaker returns only facts attributed to the queried speaker', async () => {
    await kg.createEntity({ text: 'Alice', type: 'Person', confidence: 0.9 });
    await kg.createEntity({ text: 'Bob', type: 'Person', confidence: 0.9 });
    await kg.createEntity({ text: 'Redis', type: 'Technology', confidence: 0.9 });
    await kg.createEntity({ text: 'Postgres', type: 'Technology', confidence: 0.9 });
    await kg.createEntity({ text: 'JWT', type: 'Technology', confidence: 0.9 });

    // Alice said Redis and JWT; Bob said Postgres
    await kg.createRelationship({
      headText: 'Alice', headType: 'Person',
      tailText: 'Redis', tailType: 'Technology',
      type: 'SAID', confidence: 0.8,
      fact: 'Alice mentioned Redis',
    });
    await kg.createRelationship({
      headText: 'Alice', headType: 'Person',
      tailText: 'JWT', tailType: 'Technology',
      type: 'SAID', confidence: 0.8,
      fact: 'Alice mentioned JWT',
    });
    await kg.createRelationship({
      headText: 'Bob', headType: 'Person',
      tailText: 'Postgres', tailType: 'Technology',
      type: 'SAID', confidence: 0.8,
      fact: 'Bob mentioned Postgres',
    });

    const aliceFacts = await kg.getEntitiesBySpeaker('Alice');
    const aliceTexts = aliceFacts.map((f) => f.text);

    // Must include Alice's facts
    expect(aliceTexts).toContain('Redis');
    expect(aliceTexts).toContain('JWT');

    // Must NOT include Bob's facts
    expect(aliceTexts).not.toContain('Postgres');

    // Unknown speaker returns empty
    const charlieFacts = await kg.getEntitiesBySpeaker('Charlie');
    expect(charlieFacts).toHaveLength(0);
  });

  // ==========================================================================
  // Scenario 5: SAID edges preserved across bitemporal supersession
  // ==========================================================================

  it('preserves SAID edges after a related fact is superseded', async () => {
    const T1 = 1700000000000; // older timestamp
    const T2 = 1700100000000; // newer timestamp (supersedes T1)

    await kg.createEntity({ text: 'Alice', type: 'Person', confidence: 0.9 });
    await kg.createEntity({ text: 'JWT', type: 'Technology', confidence: 0.9 });
    await kg.createEntity({ text: 'SessionToken', type: 'Technology', confidence: 0.9 });

    // Alice said JWT at T1
    await kg.createRelationship({
      headText: 'Alice', headType: 'Person',
      tailText: 'JWT', tailType: 'Technology',
      type: 'SAID', confidence: 0.85,
      fact: 'Alice mentioned JWT',
      validAt: T1,
    });

    // A separate fact relationship between JWT and SessionToken is established at T1,
    // then superseded at T2 (e.g., the decision to replace JWT with SessionToken)
    await kg.createRelationship({
      headText: 'JWT', headType: 'Technology',
      tailText: 'SessionToken', tailType: 'Technology',
      type: 'USES', confidence: 0.9,
      fact: 'JWT used for sessions',
      validAt: T1,
    });
    await kg.invalidateRelationship('JWT', 'Technology', 'SessionToken', 'Technology', 'USES');

    // The SAID edge from Alice → JWT should still exist (supersession of a different
    // relationship must not affect Alice's SAID edge)
    const aliceFacts = await kg.getEntitiesBySpeaker('Alice');
    const factTexts = aliceFacts.map((f) => f.text);
    expect(factTexts).toContain('JWT');

    // The USES relationship was invalidated; confirm it is no longer in active results
    const usesRels = await kg.getRelationships({
      entityText: 'JWT',
      relationType: 'USES',
    });
    // Active USES relationships should be empty (the one relationship was invalidated)
    const activeUses = usesRels.filter((r) => r.relationType === 'USES');
    expect(activeUses).toHaveLength(0);
  });
});
