/**
 * Knowledge Graph MCP Tool Tests
 *
 * Tests the 7 knowledge graph tools against a real Kuzu instance:
 * - store_entity, store_relationship, query_knowledge, recall
 * - decay_and_prune, get_knowledge_stats
 * - store_fact is tested separately (requires LLM / OpenRouter key)
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { handleToolCall } from '../tools/consolidated';
import { teardownGraphClient, assertNoError } from './helpers';
import { resetKnowledgeOps } from '@codegraph/core';

afterAll(async () => {
  resetKnowledgeOps();
  await teardownGraphClient();
});

// ─── store_entity ─────────────────────────────────────────────────────────────

describe('store_entity', () => {
  it('stores a new entity', async () => {
    const result = (await handleToolCall('store_entity', {
      text: 'TestPerson',
      type: 'Person',
      confidence: 0.95,
    })) as Record<string, unknown>;

    assertNoError(result, 'store_entity');
    expect(result.stored).toBe(true);
    expect(result.entityId).toBeDefined();
    expect(result.text).toBe('TestPerson');
    expect(result.type).toBe('Person');
  });

  it('stores an entity with properties', async () => {
    const result = (await handleToolCall('store_entity', {
      text: 'TestProject',
      type: 'Project',
      confidence: 0.8,
      properties: { language: 'TypeScript', status: 'active' },
    })) as Record<string, unknown>;

    assertNoError(result, 'store_entity with properties');
    expect(result.stored).toBe(true);
    expect(result.text).toBe('TestProject');
  });

  it('upserts existing entity (same text + type)', async () => {
    const result = (await handleToolCall('store_entity', {
      text: 'TestPerson',
      type: 'Person',
      confidence: 0.99,
    })) as Record<string, unknown>;

    assertNoError(result, 'store_entity upsert');
    expect(result.stored).toBe(true);
    // Should still succeed (upsert, not duplicate)
  });

  it('stores entity with default confidence', async () => {
    const result = (await handleToolCall('store_entity', {
      text: 'DefaultConfEntity',
      type: 'Concept',
    })) as Record<string, unknown>;

    assertNoError(result, 'store_entity default conf');
    expect(result.stored).toBe(true);
  });
});

// ─── store_relationship ──────────────────────────────────────────────────────

describe('store_relationship', () => {
  it('stores a relationship between two entities', async () => {
    const result = (await handleToolCall('store_relationship', {
      headText: 'TestPerson',
      headType: 'Person',
      tailText: 'TestProject',
      tailType: 'Project',
      type: 'OWNS',
      confidence: 0.9,
    })) as Record<string, unknown>;

    assertNoError(result, 'store_relationship');
    expect(result.stored).toBe(true);
    expect(result.head).toBe('TestPerson (Person)');
    expect(result.tail).toBe('TestProject (Project)');
    expect(result.type).toBe('OWNS');
  });

  it('stores a relationship with a fact', async () => {
    const result = (await handleToolCall('store_relationship', {
      headText: 'TestPerson',
      headType: 'Person',
      tailText: 'Use Kuzu',
      tailType: 'Decision',
      type: 'DECIDED',
      fact: 'TestPerson decided to use Kuzu for graph storage',
    })) as Record<string, unknown>;

    assertNoError(result, 'store_relationship with fact');
    expect(result.stored).toBe(true);
    expect(result.type).toBe('DECIDED');
  });

  it('auto-creates entities that do not exist', async () => {
    const result = (await handleToolCall('store_relationship', {
      headText: 'AutoHead',
      headType: 'Concept',
      tailText: 'AutoTail',
      tailType: 'Concept',
      type: 'RELATED_TO',
    })) as Record<string, unknown>;

    assertNoError(result, 'store_relationship auto-create');
    expect(result.stored).toBe(true);
  });
});

// ─── query_knowledge ─────────────────────────────────────────────────────────

describe('query_knowledge', () => {
  it('finds entities by type', async () => {
    const result = (await handleToolCall('query_knowledge', {
      type: 'Person',
    })) as Record<string, unknown>;

    assertNoError(result, 'query_knowledge by type');
    expect(result.count).toBeGreaterThan(0);
    const entities = result.entities as Array<Record<string, unknown>>;
    for (const e of entities) {
      expect(e.type).toBe('Person');
      expect(e.text).toBeDefined();
      expect(e.confidence).toBeDefined();
    }
  });

  it('finds entities by text content', async () => {
    const result = (await handleToolCall('query_knowledge', {
      textContains: 'TestProject',
    })) as Record<string, unknown>;

    assertNoError(result, 'query_knowledge by text');
    expect(result.count).toBeGreaterThan(0);
    const entities = result.entities as Array<Record<string, unknown>>;
    expect(entities.some(e => (e.text as string).includes('TestProject'))).toBe(true);
  });

  it('returns empty results for nonexistent term', async () => {
    const result = (await handleToolCall('query_knowledge', {
      textContains: 'xyzNonexistent999AbcDef',
    })) as Record<string, unknown>;

    assertNoError(result, 'query_knowledge empty');
    expect(result.count).toBe(0);
  });

  it('respects limit parameter', async () => {
    const result = (await handleToolCall('query_knowledge', {
      limit: 1,
    })) as Record<string, unknown>;

    assertNoError(result, 'query_knowledge limit');
    const entities = result.entities as Array<Record<string, unknown>>;
    expect(entities.length).toBeLessThanOrEqual(1);
  });
});

// ─── recall ─────────────────────────────────────────────────────────────────

describe('recall', () => {
  it('recalls all relationships for an entity', async () => {
    const result = (await handleToolCall('recall', {
      text: 'TestPerson',
      type: 'Person',
    })) as Record<string, unknown>;

    assertNoError(result, 'recall');
    expect(result.entity).toBe('TestPerson');
    expect(result.relationshipCount).toBeGreaterThan(0);
    const rels = result.relationships as Array<Record<string, unknown>>;
    expect(rels.length).toBeGreaterThan(0);
    // Check shape
    for (const r of rels) {
      expect(r.head).toBeDefined();
      expect(r.tail).toBeDefined();
      expect(r.type).toBeDefined();
      expect(r.confidence).toBeDefined();
    }
  });

  it('accepts relationType parameter without error', async () => {
    // Note: getRelationships currently prioritizes entityText filter over relationType.
    // When both are passed, only entityText is used. This is a known API limitation.
    // This test verifies the handler doesn't error when relationType is passed.
    const result = (await handleToolCall('recall', {
      text: 'TestPerson',
      type: 'Person',
      relationType: 'DECIDED',
    })) as Record<string, unknown>;

    assertNoError(result, 'recall with relationType');
    expect(result.entity).toBe('TestPerson');
    // Should return relationships (entityText filter is active)
    expect(result.relationshipCount).toBeGreaterThan(0);
  });

  it('returns empty for unknown entity', async () => {
    const result = (await handleToolCall('recall', {
      text: 'xyzNonexistent999',
    })) as Record<string, unknown>;

    assertNoError(result, 'recall empty');
    expect(result.relationshipCount).toBe(0);
  });
});

// ─── get_knowledge_stats ────────────────────────────────────────────────────

describe('get_knowledge_stats', () => {
  it('returns statistics about the knowledge graph', async () => {
    const result = (await handleToolCall('get_knowledge_stats', {})) as Record<string, unknown>;

    assertNoError(result, 'get_knowledge_stats');
    expect(result.totalEntities).toBeGreaterThan(0);
    expect(typeof result.avgRelevance).toBe('number');
    // Kuzu returns INT64 as bigint, so accept both number and bigint
    expect(['number', 'bigint']).toContain(typeof result.lowRelevanceCount);
  });
});

// ─── decay_and_prune ────────────────────────────────────────────────────────

describe('decay_and_prune', () => {
  it('decays relevance without pruning', async () => {
    const result = (await handleToolCall('decay_and_prune', {
      prune: false,
      decayRate: 0.01,
    })) as Record<string, unknown>;

    assertNoError(result, 'decay_and_prune decay only');
    expect(typeof result.decayed).toBe('number');
    expect(result.pruned).toBe(0);
    expect(result.message).toContain('Decayed');
  });

  it('decays and prunes with high threshold', async () => {
    // First add a sacrificial entity so pruning has something to work on
    await handleToolCall('store_entity', {
      text: 'SacrificialEntity',
      type: 'Concept',
      confidence: 0.01,
    });

    // Decay heavily first
    await handleToolCall('decay_and_prune', {
      decayRate: 0.99,
    });

    // Now prune
    const result = (await handleToolCall('decay_and_prune', {
      prune: true,
      minRelevance: 0.99, // Very high threshold to catch things
    })) as Record<string, unknown>;

    assertNoError(result, 'decay_and_prune with prune');
    expect(typeof result.decayed).toBe('number');
    expect(typeof result.pruned).toBe('number');
    expect(result.message).toContain('pruned');
  });
});

// ─── store_fact (LLM-dependent) ─────────────────────────────────────────────

describe('store_fact', () => {
  it('returns error when OPENROUTER_API_KEY is not set', async () => {
    // Skip if API key IS set (we don't want to actually call the LLM in tests)
    if (process.env.OPENROUTER_API_KEY) {
      return; // Skip — would actually call LLM
    }

    const result = (await handleToolCall('store_fact', {
      text: 'Randy decided to use Kuzu for storage',
    })) as Record<string, unknown>;

    expect(result.error).toBeDefined();
  });

  it('returns error for empty text', async () => {
    const result = (await handleToolCall('store_fact', {
      text: '',
    })) as Record<string, unknown>;

    expect(result.error).toBeDefined();
  });
});

// ─── error handling ─────────────────────────────────────────────────────────

describe('knowledge error handling', () => {
  it('knowledge tools are registered', async () => {
    // Verify that all 7 knowledge tools exist in the handler map
    const knowledgeTools = [
      'store_entity', 'store_relationship', 'store_fact',
      'query_knowledge', 'recall', 'decay_and_prune', 'get_knowledge_stats',
    ];

    for (const tool of knowledgeTools) {
      // Should not throw "Unknown tool"
      await expect(
        handleToolCall(tool, tool === 'store_entity' ? { text: '__test__', type: 'Concept' } : { text: '__test__' })
      ).resolves.toBeDefined();
    }
  });
});
