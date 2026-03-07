/**
 * C1 — End-to-End Knowledge Graph Validation
 *
 * Validates the full pipeline across all three layers:
 *   Text → NLP Extraction (MockLLM) → Knowledge Graph (Kuzu) → MCP Tool Retrieval
 *
 * Unlike the unit tests in knowledge.test.ts (which test individual tools),
 * this test exercises the complete lifecycle:
 *
 * 1. Store entities and relationships via MCP tools
 * 2. Query them back via MCP tools
 * 3. Recall relationships with touch-on-access
 * 4. Verify stats reflect accumulated state
 * 5. Decay/prune lifecycle
 * 6. Full NLP→KG→MCP round-trip (mock LLM extraction → store → recall)
 */

import { describe, it, expect, afterAll } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import { extractAndStore } from '@codegraph/nlp';
import { handleToolCall } from '../tools/consolidated';
import { teardownGraphClient, assertNoError } from './helpers';
import { resetKnowledgeOps, getKnowledgeOps } from '@codegraph/core';

afterAll(async () => {
  resetKnowledgeOps();
  await teardownGraphClient();
});

// ─── Full lifecycle E2E ─────────────────────────────────────────────────────

describe('E2E: knowledge graph lifecycle', () => {
  // Phase 1: Build up a knowledge graph via MCP tools
  it('step 1: store entities describing a software decision', async () => {
    const entities = [
      { text: 'E2E_Alice', type: 'Person', confidence: 0.95 },
      { text: 'E2E_Kuzu', type: 'Technology', confidence: 0.92 },
      { text: 'E2E_FalkorDB', type: 'Technology', confidence: 0.88 },
      { text: 'E2E_GraphStorage', type: 'Decision', confidence: 0.90 },
    ];

    for (const entity of entities) {
      const result = (await handleToolCall('store_entity', entity)) as Record<string, unknown>;
      assertNoError(result, `store_entity ${entity.text}`);
      expect(result.stored).toBe(true);
    }
  });

  it('step 2: store relationships connecting the entities', async () => {
    const rels = [
      {
        headText: 'E2E_Alice', headType: 'Person',
        tailText: 'E2E_GraphStorage', tailType: 'Decision',
        type: 'DECIDED',
        fact: 'Alice decided on the graph storage approach',
      },
      {
        headText: 'E2E_GraphStorage', headType: 'Decision',
        tailText: 'E2E_Kuzu', tailType: 'Technology',
        type: 'CHOSE',
        fact: 'The decision was to use Kuzu as the primary graph store',
        confidence: 0.95,
      },
      {
        headText: 'E2E_GraphStorage', headType: 'Decision',
        tailText: 'E2E_FalkorDB', tailType: 'Technology',
        type: 'REJECTED',
        fact: 'FalkorDB was evaluated but rejected due to deployment complexity',
        confidence: 0.85,
      },
    ];

    for (const rel of rels) {
      const result = (await handleToolCall('store_relationship', rel)) as Record<string, unknown>;
      assertNoError(result, `store_relationship ${rel.headText}→${rel.tailText}`);
      expect(result.stored).toBe(true);
    }
  });

  // Phase 2: Query the graph via MCP tools
  it('step 3: query_knowledge finds all Technology entities', async () => {
    const result = (await handleToolCall('query_knowledge', {
      type: 'Technology',
      textContains: 'E2E_',
    })) as Record<string, unknown>;

    assertNoError(result, 'query_knowledge Technology');
    expect(result.count).toBe(2);
    const entities = result.entities as Array<Record<string, unknown>>;
    const names = entities.map(e => e.text as string).sort();
    expect(names).toEqual(['E2E_FalkorDB', 'E2E_Kuzu']);
  });

  it('step 4: recall returns the decision graph for Alice', async () => {
    const result = (await handleToolCall('recall', {
      text: 'E2E_Alice',
      type: 'Person',
    })) as Record<string, unknown>;

    assertNoError(result, 'recall E2E_Alice');
    expect(result.entity).toBe('E2E_Alice');
    expect(result.relationshipCount).toBeGreaterThanOrEqual(1);

    const rels = result.relationships as Array<Record<string, unknown>>;
    // Alice should have DECIDED → GraphStorage
    expect(rels.some(r => r.type === 'DECIDED')).toBe(true);
    expect(rels.some(r => (r.tail as string).includes('E2E_GraphStorage'))).toBe(true);
  });

  it('step 5: recall returns the full decision with reasons', async () => {
    const result = (await handleToolCall('recall', {
      text: 'E2E_GraphStorage',
      type: 'Decision',
    })) as Record<string, unknown>;

    assertNoError(result, 'recall E2E_GraphStorage');
    const rels = result.relationships as Array<Record<string, unknown>>;

    // Should have both CHOSE and REJECTED relationships
    const chose = rels.find(r => r.type === 'CHOSE');
    const rejected = rels.find(r => r.type === 'REJECTED');

    expect(chose).toBeDefined();
    expect((chose!.tail as string)).toContain('E2E_Kuzu');
    expect(chose!.fact).toContain('Kuzu');

    expect(rejected).toBeDefined();
    expect((rejected!.tail as string)).toContain('E2E_FalkorDB');
    expect(rejected!.fact).toContain('FalkorDB');
  });

  // Phase 3: Verify stats and lifecycle
  it('step 6: get_knowledge_stats shows accumulated entities', async () => {
    const result = (await handleToolCall('get_knowledge_stats', {})) as Record<string, unknown>;

    assertNoError(result, 'get_knowledge_stats');
    // Should have at least our 4 E2E entities (plus any from other tests)
    expect(Number(result.totalEntities)).toBeGreaterThanOrEqual(4);
  });

  it('step 7: decay_and_prune executes without error', async () => {
    // Note: Decay only affects entities older than minAge (default: 7 days).
    // Freshly-created test entities won't be decayed, so we verify the tool
    // runs cleanly and returns the expected shape rather than asserting counts.
    const result = (await handleToolCall('decay_and_prune', {
      decayRate: 0.1,
      prune: false,
    })) as Record<string, unknown>;

    assertNoError(result, 'decay_and_prune');
    expect(typeof result.decayed).toBe('number');
    expect(result.pruned).toBe(0);
    expect(result.message).toContain('Decayed');
  });

  it('step 8: recall after decay still returns data (touch refreshes)', async () => {
    // Recalling should touch the entity, refreshing its relevance
    const result = (await handleToolCall('recall', {
      text: 'E2E_Alice',
      type: 'Person',
    })) as Record<string, unknown>;

    assertNoError(result, 'recall after decay');
    expect(result.relationshipCount).toBeGreaterThanOrEqual(1);
  });
});

// ─── NLP → KG → MCP round-trip ─────────────────────────────────────────────

describe('E2E: NLP extraction → knowledge graph → MCP recall', () => {
  it('round-trips text through the full pipeline', async () => {
    // Step 1: Use the extractAndStore function from @codegraph/nlp
    //         with mock LLM to extract entities from text
    // Entity texts MUST appear as substrings in the sample text
    // (the EntityExtractor's parseResponse filters out entities not found in the text).
    // Entity types must be from the valid set (Person, Project, Decision, Concept, etc.)
    // Relationship types must also be valid (OWNS, DECIDED, USES, etc.)
    const sampleText = 'Charlie decided to build GraphProject for distributed analytics';

    const mockModel = new MockLanguageModelV3({
      provider: 'test',
      modelId: 'test-model',
      doGenerate: {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            entities: [
              { text: 'Charlie', type: 'Person' },
              { text: 'GraphProject', type: 'Project' },
            ],
            relationships: [
              { headText: 'Charlie', tailText: 'GraphProject', type: 'OWNS' },
            ],
          }),
        }],
        finishReason: { unified: 'stop' as const, raw: 'stop' },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 10, text: 10, reasoning: 0 },
        },
        warnings: [],
      },
    });

    // Get KnowledgeOperations from the MCP singleton (same one the tools use)
    const ops = await getKnowledgeOps();

    // Step 2: Extract and store via NLP pipeline
    const result = await extractAndStore(sampleText, ops, {
      extractor: { languageModel: mockModel },
    });

    expect(result.entities).toBe(2);
    expect(result.relationships).toBe(1);

    // Step 3: Verify via MCP tools — the entities should be queryable
    const queryResult = (await handleToolCall('query_knowledge', {
      textContains: 'Charlie',
    })) as Record<string, unknown>;

    assertNoError(queryResult, 'query_knowledge Charlie');
    expect(queryResult.count).toBeGreaterThanOrEqual(1);
    const entities = queryResult.entities as Array<Record<string, unknown>>;
    expect(entities.some(e => e.text === 'Charlie')).toBe(true);

    // Step 4: Recall via MCP tools — the relationship should be there
    const recallResult = (await handleToolCall('recall', {
      text: 'Charlie',
      type: 'Person',
    })) as Record<string, unknown>;

    assertNoError(recallResult, 'recall Charlie');
    expect(recallResult.relationshipCount).toBeGreaterThanOrEqual(1);

    const rels = recallResult.relationships as Array<Record<string, unknown>>;
    const ownsRel = rels.find(r => r.type === 'OWNS');
    expect(ownsRel).toBeDefined();
    expect((ownsRel!.tail as string)).toContain('GraphProject');
  });
});
