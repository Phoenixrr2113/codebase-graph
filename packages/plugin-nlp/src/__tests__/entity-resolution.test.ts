/**
 * Entity Resolution: Tests
 *
 * Tests the three-tier entity resolution strategy:
 *   Tier 1: Exact text match (case-insensitive)
 *   Tier 2: Embedding similarity auto-merge
 *   Tier 3: LLM verification for ambiguous cases
 *
 * Prerequisites: docker compose up -d falkordb
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../embeddings')>();
  return {
    ...actual,
    isEmbeddingAvailable: vi.fn(() => true),
    generateEmbedding: vi.fn(async (text: string) => {
      const embedding = new Array<number>(768).fill(0);
      const dimension = [...text].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 768;
      embedding[dimension] = 1;
      return { embedding, dimensions: 768, provider: 'test' };
    }),
  };
});

import { MockLanguageModelV3 } from 'ai/test';
import {
  createClient,
  createKnowledgeOperations,
  type GraphClient,
  type KnowledgeOperations,
  type EntitySearchResult,
} from '@codegraph/graph';
import { resolveEntities } from '../entity-resolution';

// ============================================================================
// Helpers
// ============================================================================

const GRAPH_NAME = `test_entity_res_${Date.now()}`;

/**
 * Create a mock LLM that answers YES/NO for entity resolution questions.
 * By default answers YES (entities are the same).
 */
function makeLlmMock(answer: 'YES' | 'NO' = 'YES') {
  const response = answer === 'YES'
    ? {
        op: 'merge',
        canonical: 'Sarah Chen',
        duplicate: 'Sarah',
        reason: 'Both names refer to the same person.',
      }
    : {
        op: 'keep',
        reason: 'The concepts describe different components.',
      };
  return new MockLanguageModelV3({
    provider: 'test',
    modelId: 'test-entity-res',
    doGenerate: {
      content: [{ type: 'text' as const, text: JSON.stringify(response) }],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    },
  });
}

// ============================================================================
// Tests
// ============================================================================

let falkordbAvailable = true;

describe('Entity Resolution (FalkorDB)', () => {
  let client: GraphClient;
  let ops: KnowledgeOperations;

  beforeAll(async () => {
    try {
      client = await createClient({
        driver: 'falkordb',
        host: process.env['FALKORDB_HOST'] ?? 'localhost',
        port: Number(process.env['FALKORDB_PORT'] ?? '6379'),
        graphName: GRAPH_NAME,
      });
    } catch {
      console.warn('FalkorDB not available: skipping tests. Run: docker compose up -d falkordb');
      falkordbAvailable = false;
      return;
    }

    await client.ensureIndexes();
    ops = createKnowledgeOperations(client);
  }, 30_000);

  beforeEach(async (ctx) => {
    if (!falkordbAvailable) {
      ctx.skip('FalkorDB not available: run: docker compose up -d falkordb');
      return;
    }
    // Clean state before each test
    try {
      await client.query('MATCH (n) DETACH DELETE n', { params: {} });
    } catch { /* best effort */ }
  });

  afterAll(async () => {
    try {
      await client.query('MATCH (n) DETACH DELETE n', { params: {} });
    } catch { /* best effort */ }
    try {
      await client.close();
    } catch { /* best effort */ }
  });

  // --------------------------------------------------------------------------
  // Tier 1: Exact text match
  // --------------------------------------------------------------------------

  it('Tier 1: merges entities with identical text (case-insensitive)', async () => {
    // Create two entities with same text
    await ops.createEntity({ text: 'Sarah', type: 'Person', confidence: 0.9 });
    await ops.createEntity({ text: 'sarah', type: 'Person', confidence: 0.8 });
    await ops.createEntity({ text: 'Bob', type: 'Person', confidence: 0.9 });

    const result = await resolveEntities(ops);

    expect(result.tier1Merges).toBe(1);
    expect(result.merged).toBe(1);
    expect(result.kept).toBe(2); // Sarah + Bob
    expect(result.merges[0]?.tier).toBe(1);
    expect(result.merges[0]?.canonical).toBe('Sarah'); // longer text wins
    expect(result.merges[0]?.duplicate).toBe('sarah');
  });

  it('Tier 1: preserves relationships when merging', async () => {
    // Create entities
    await ops.createEntity({ text: 'Alice', type: 'Person', confidence: 0.9 });
    await ops.createEntity({ text: 'alice', type: 'Person', confidence: 0.8 });
    await ops.createEntity({ text: 'payment module', type: 'CodeEntity', confidence: 0.9 });

    // Create a relationship from duplicate to another entity
    await ops.createRelationship({
      headText: 'alice',
      headType: 'Person',
      tailText: 'payment module',
      tailType: 'CodeEntity',
      type: 'CREATED',
      confidence: 0.9,
    });

    const result = await resolveEntities(ops);

    expect(result.tier1Merges).toBe(1);
    // Canonical should be 'Alice' (proper casing wins tiebreaker)
    expect(result.merges[0]?.canonical).toBe('Alice');
    expect(result.merges[0]?.duplicate).toBe('alice');

    // Verify canonical Alice now has the CREATED relationship
    const rels = await ops.getRelationships({ entityText: 'Alice' });
    expect(rels.some((r) => r.relationType === 'CREATED')).toBe(true);

    // Verify duplicate 'alice' no longer exists
    const duplicate = await client.roQuery<{ count: number }>(
      'MATCH (e:Entity {text: $text, type: $type}) RETURN count(e) AS count',
      { params: { text: 'alice', type: 'Person' } },
    );
    expect(duplicate.data[0]?.count).toBe(0);
  });

  it('Tier 1: does not merge entities of different types', async () => {
    await ops.createEntity({ text: 'Sprint', type: 'Event', confidence: 0.9 });
    await ops.createEntity({ text: 'sprint', type: 'Task', confidence: 0.8 });

    const result = await resolveEntities(ops);

    // Different types → no merge even though text matches
    expect(result.tier1Merges).toBe(0);
    expect(result.kept).toBe(2);
  });

  // --------------------------------------------------------------------------
  // Tier 2: Embedding similarity
  // --------------------------------------------------------------------------

  it('Tier 2: auto-merges entities with very high embedding similarity', async () => {
    // Create entities with near-identical embeddings
    const dim = 768;
    const baseVec = new Array(dim).fill(0);
    baseVec[0] = 1.0;
    baseVec[1] = 0.5;

    // Nearly identical vector (cosine similarity > 0.99)
    const slightlyDifferent = [...baseVec];
    slightlyDifferent[2] = 0.01;

    await ops.createEntity({
      text: 'payment processing',
      type: 'Concept',
      confidence: 0.9,
      embedding: baseVec,
    });
    await ops.createEntity({
      text: 'payment processing system',
      type: 'Concept',
      confidence: 0.85,
      embedding: slightlyDifferent,
    });
    await ops.createEntity({
      text: 'unrelated concept',
      type: 'Concept',
      confidence: 0.9,
      embedding: new Array(dim).fill(0).map((_v, i) => (i === 100 ? 1.0 : 0)),
    });

    const result = await resolveEntities(ops, {
      autoMergeThreshold: 0.95,
      candidateThreshold: 0.85,
    });

    expect(result.tier2Merges).toBe(1);
    expect(result.merged).toBe(1);
    expect(result.merges[0]?.tier).toBe(2);
    // Longer text should be canonical
    expect(result.merges[0]?.canonical).toBe('payment processing system');
  });

  // --------------------------------------------------------------------------
  // Tier 3: LLM verification
  // --------------------------------------------------------------------------

  it('Tier 3: uses LLM to verify ambiguous candidates', async () => {
    // Create entities with moderate embedding similarity (in the 0.85-0.95 range)
    // Using unit vectors with controlled angle: cos(θ) = 0.90
    const dim = 768;
    const vecA = new Array(dim).fill(0);
    vecA[0] = 1.0;

    // cos(acos(0.90)) ≈ 0.90, sin(acos(0.90)) ≈ 0.4359
    const vecB = new Array(dim).fill(0);
    vecB[0] = 0.9;
    vecB[1] = 0.4358898943540673;

    await ops.createEntity({
      text: 'Sarah',
      type: 'Person',
      confidence: 0.9,
      embedding: vecA,
    });
    await ops.createEntity({
      text: 'Sarah Chen',
      type: 'Person',
      confidence: 0.85,
      embedding: vecB,
    });

    const llm = makeLlmMock('YES');

    const result = await resolveEntities(ops, {
      llm,
      autoMergeThreshold: 0.95,
      candidateThreshold: 0.80, // wider range to catch the pair
    });

    // Should have used LLM (Tier 3) since similarity is between thresholds
    expect(result.llmCalls).toBeGreaterThanOrEqual(1);
    expect(result.tier3Merges).toBe(1);
    expect(result.merged).toBe(1);
    expect(result.merges[0]?.canonical).toBe('Sarah Chen'); // longer text wins
    expect(result.merges[0]?.duplicate).toBe('Sarah');
  });

  it('Tier 3: keeps entities separate when LLM says NO', async () => {
    // Vectors with cosine similarity ~0.90 (in the 0.85-0.95 candidate range)
    const dim = 768;
    const vecA = new Array(dim).fill(0);
    vecA[0] = 1.0;

    const vecB = new Array(dim).fill(0);
    vecB[0] = 0.9;
    vecB[1] = 0.4358898943540673;

    await ops.createEntity({
      text: 'Payment Gateway',
      type: 'Concept',
      confidence: 0.9,
      embedding: vecA,
    });
    await ops.createEntity({
      text: 'Payment Processor',
      type: 'Concept',
      confidence: 0.85,
      embedding: vecB,
    });

    const llm = makeLlmMock('NO');

    const result = await resolveEntities(ops, {
      llm,
      autoMergeThreshold: 0.95,
      candidateThreshold: 0.80,
    });

    expect(result.llmCalls).toBeGreaterThanOrEqual(1);
    expect(result.tier3Merges).toBe(0);
    expect(result.merged).toBe(0);
    expect(result.kept).toBe(2);
  });

  // --------------------------------------------------------------------------
  // Edge cases
  // --------------------------------------------------------------------------

  it('handles empty entity set', async () => {
    const result = await resolveEntities(ops);

    expect(result.total).toBe(0);
    expect(result.merged).toBe(0);
    expect(result.kept).toBe(0);
  });

  it('handles single entity', async () => {
    await ops.createEntity({ text: 'Alice', type: 'Person', confidence: 0.9 });

    const result = await resolveEntities(ops);

    expect(result.total).toBe(1);
    expect(result.merged).toBe(0);
    expect(result.kept).toBe(1);
  });

  it('skips Tier 3 when no LLM provided', async () => {
    // Vectors with cosine similarity ~0.90 (in the 0.85-0.95 candidate range)
    const dim = 768;
    const vecA = new Array(dim).fill(0);
    vecA[0] = 1.0;
    const vecB = new Array(dim).fill(0);
    vecB[0] = 0.9;
    vecB[1] = 0.4358898943540673;

    await ops.createEntity({
      text: 'Sarah',
      type: 'Person',
      confidence: 0.9,
      embedding: vecA,
    });
    await ops.createEntity({
      text: 'Sarah Chen',
      type: 'Person',
      confidence: 0.85,
      embedding: vecB,
    });

    // No LLM provided
    const result = await resolveEntities(ops, {
      autoMergeThreshold: 0.95,
      candidateThreshold: 0.80,
    });

    // Tier 3 should be skipped
    expect(result.llmCalls).toBe(0);
    expect(result.tier3Merges).toBe(0);
  });

  it('fires progress callback for each tier', async () => {
    await ops.createEntity({ text: 'Alice', type: 'Person', confidence: 0.9 });
    await ops.createEntity({ text: 'alice', type: 'Person', confidence: 0.8 });
    await ops.createEntity({ text: 'Bob', type: 'Person', confidence: 0.9 });

    const progressCalls: Array<[string, number, number]> = [];

    await resolveEntities(ops, {
      onProgress: (phase, current, total) => {
        progressCalls.push([phase, current, total]);
      },
    });

    // Should have tier1 and tier2 progress calls
    expect(progressCalls.some(([phase]) => phase === 'tier1')).toBe(true);
    expect(progressCalls.some(([phase]) => phase === 'tier2')).toBe(true);
  });
});

// ============================================================================
// Merge accounting for no-op merges
// ============================================================================
//
// mergeEntities can succeed without deleting anything: if the duplicate is
// already gone by the time it runs (e.g. an earlier merge in this same run
// already consumed it, or a concurrent process did), it returns
// `{ success: true, deleted: false }` rather than throwing. The three call
// sites in resolveEntities used to increment their merge counters on
// `success` alone, so a run that did no work for that pair still reported a
// merge - the exact class of defect ("report work that did not happen")
// this whole fix exists to close. The fix checks `deleted` too, so only
// merges that actually removed a duplicate get counted.
//
// This uses a fake KnowledgeOperations (no FalkorDB, no server) with full
// control over what mergeEntities reports, so both outcomes - a real merge
// and a no-op - can be produced deterministically in the same run.
// ============================================================================

describe('Entity Resolution - merge accounting for no-op merges', () => {
  function makeEntity(text: string, type: string): EntitySearchResult {
    return {
      id: `${type}:${text}`,
      text,
      type,
      confidence: 0.9,
      relevanceScore: 1,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    };
  }

  /**
   * Exposes two Tier 1 (exact text match) duplicate pairs, of different
   * entity types so Tier 2's embedding comparison never pairs them with each
   * other and stays a no-op:
   *   - "Acme Corp" / "acme corp" (Organization): mergeEntities reports a
   *     real merge, `deleted: true`.
   *   - "Ghost Project" / "ghost project" (Project): mergeEntities reports a
   *     no-op success, `deleted: false` - standing in for a duplicate that
   *     turned out to already be gone.
   */
  function makeFakeKgOps(): {
    kgOps: KnowledgeOperations;
    mergeCalls: Array<{ canonicalText: string; duplicateText: string }>;
  } {
    const mergeCalls: Array<{ canonicalText: string; duplicateText: string }> = [];
    const notUsed = (): never => {
      throw new Error('not used in this test');
    };

    const kgOps: KnowledgeOperations = {
      async searchEntities() {
        return [
          makeEntity('Acme Corp', 'Organization'),
          makeEntity('acme corp', 'Organization'),
          makeEntity('Ghost Project', 'Project'),
          makeEntity('ghost project', 'Project'),
        ];
      },
      async mergeEntities(canonicalText, canonicalType, duplicateText, duplicateType) {
        mergeCalls.push({ canonicalText, duplicateText });
        if (duplicateText === 'acme corp') {
          return { transferredRelationships: 0, transferredAboutEdges: 0, success: true, deleted: true, errors: [] };
        }
        if (duplicateText === 'ghost project') {
          return { transferredRelationships: 0, transferredAboutEdges: 0, success: true, deleted: false, errors: [] };
        }
        throw new Error(
          `unexpected mergeEntities call in test: "${duplicateText}" (${duplicateType}) -> "${canonicalText}" (${canonicalType})`,
        );
      },
      createEntity: notUsed,
      createRelationship: notUsed,
      getRelationships: notUsed,
      invalidateRelationship: notUsed,
      importEntitiesAndRelationships: notUsed,
      touchEntity: notUsed,
      decayRelevance: notUsed,
      pruneOldEntities: notUsed,
      getMemoryStats: notUsed,
      searchEntitiesByVector: notUsed,
      createAboutEdge: notUsed,
      getAboutEdgesForEntity: notUsed,
      getEntitiesBySpeaker: notUsed,
      searchFactsByVector: notUsed,
      searchEntitiesBySource: notUsed,
      queryAtPointInTime: notUsed,
      queryChangesInRange: notUsed,
      getEntityTimeline: notUsed,
      searchByRelevance: notUsed,
    };

    return { kgOps, mergeCalls };
  }

  it('counts only the merge that actually deleted a duplicate, not the no-op', async () => {
    const { kgOps, mergeCalls } = makeFakeKgOps();

    const result = await resolveEntities(kgOps);

    // Both duplicate pairs were attempted...
    expect(mergeCalls).toEqual([
      { canonicalText: 'Acme Corp', duplicateText: 'acme corp' },
      { canonicalText: 'Ghost Project', duplicateText: 'ghost project' },
    ]);

    // ...but a run with one real merge and one already-gone duplicate must
    // report exactly one merge, not two.
    expect(result.total).toBe(4);
    expect(result.tier1Merges).toBe(1);
    expect(result.merged).toBe(1);
    expect(result.kept).toBe(3);
    expect(result.merges).toEqual([
      { canonical: 'Acme Corp', duplicate: 'acme corp', tier: 1 },
    ]);
  });
});
