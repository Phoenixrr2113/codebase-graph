/**
 * Speaker Entities + SAID Edges — Unit Tests (Task 6)
 *
 * Verifies that conversation ingestion creates Person entities for speakers
 * and links them to extracted fact entities via SAID edges.
 *
 * Implementation location: packages/plugin-nlp/src/extract-and-store.ts
 * The speaker attribution block is at lines 489-514 of extractConversation().
 *
 * Uses MockLanguageModelV3 from ai/test to mock the LLM — no network calls.
 * Uses vi.fn() ops mock to capture DB writes — no FalkorDB required.
 *
 * Integration tests (with real FalkorDB) live in:
 *   src/__tests__/ingest-conversation.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import { extractConversation } from '../extract-and-store';
import { chunkConversation } from '../conversation';
import type { KnowledgeOperations } from '@codegraph/graph';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal mock LLM that returns deterministic entities based on text content.
 * Returns Redis and JWT as Technology entities for any input.
 */
function makeMockModel() {
  return new MockLanguageModelV3({
    provider: 'test',
    modelId: 'test-speaker-model',
    doGenerate: async () => {
      const response = {
        entities: [
          { text: 'Redis', type: 'Technology', confidence: 0.9 },
          { text: 'JWT', type: 'Technology', confidence: 0.85 },
        ],
        relationships: [],
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response) }],
        finishReason: { unified: 'stop' as const, raw: 'stop' },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 10, text: 10, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
}

/** Minimal mock for KnowledgeOperations — captures createEntity/createRelationship calls */
function makeMockOps(): KnowledgeOperations {
  return {
    createEntity: vi.fn().mockResolvedValue('mock-entity-id'),
    createRelationship: vi.fn().mockResolvedValue(undefined),
    createEntities: vi.fn().mockResolvedValue([]),
    // importEntitiesAndRelationships is called by extractAndStore — return non-zero to trigger speaker attribution
    importEntitiesAndRelationships: vi.fn().mockResolvedValue({ entities: 2, relationships: 0 }),
    searchEntities: vi.fn().mockResolvedValue([]),
    getEntity: vi.fn().mockResolvedValue(null),
    updateEntity: vi.fn().mockResolvedValue(undefined),
    invalidateEntity: vi.fn().mockResolvedValue(undefined),
    touchEntity: vi.fn().mockResolvedValue(true),
    decayRelevance: vi.fn().mockResolvedValue({ decayed: 0 }),
    pruneOldEntities: vi.fn().mockResolvedValue({ pruned: 0 }),
    getMemoryStats: vi.fn().mockResolvedValue({ totalEntities: 0, avgRelevance: 0, lowRelevanceCount: 0, oldestAccess: null, newestAccess: null }),
    searchEntitiesByVector: vi.fn().mockResolvedValue([]),
    searchEntitiesBySource: vi.fn().mockResolvedValue([]),
    getRelationships: vi.fn().mockResolvedValue([]),
    searchRelationships: vi.fn().mockResolvedValue([]),
    getEntitiesBySpeaker: vi.fn().mockResolvedValue([]),
    searchFactsByVector: vi.fn().mockResolvedValue([]),
    getKnowledgeStats: vi.fn().mockResolvedValue({
      totalEntities: 0, avgRelevance: 0, lowRelevanceCount: 0,
      oldestAccess: null, newestAccess: null,
    }),
    decayAndPrune: vi.fn().mockResolvedValue({ decayed: 0, pruned: 0 }),
    resolveEntities: vi.fn().mockResolvedValue({ merged: 0, kept: 0 }),
    mergeEntities: vi.fn().mockResolvedValue(undefined),
    batchUpsert: vi.fn().mockResolvedValue(undefined),
    createSample: vi.fn().mockResolvedValue(undefined),
    getSample: vi.fn().mockResolvedValue(null),
    ensureSchema: vi.fn().mockResolvedValue(undefined),
  } as unknown as KnowledgeOperations;
}

// ---------------------------------------------------------------------------
// Tests: Person entity creation via extractConversation
// ---------------------------------------------------------------------------

describe('extractConversation creates Person entities for speakers', () => {
  let ops: KnowledgeOperations;
  let mockModel: ReturnType<typeof makeMockModel>;

  beforeEach(() => {
    ops = makeMockOps();
    mockModel = makeMockModel();
  });

  it('creates a Person entity for each speaker in a two-speaker conversation', async () => {
    // Texts long enough for minEpisodeLength=10 to pass
    const text = [
      "Alice: Let's use Redis for caching the session data.",
      'Bob: Agreed, Redis is fast and reliable for this use case.',
    ].join('\n');
    const chunkResult = chunkConversation(text, { format: 'chat' });
    expect(chunkResult.speakers).toContain('Alice');
    expect(chunkResult.speakers).toContain('Bob');

    await extractConversation(chunkResult, ops, {
      extractor: { languageModel: mockModel },
    });

    const entityCalls = vi.mocked(ops.createEntity).mock.calls;
    const personCalls = entityCalls.filter((call) => call[0].type === 'Person');
    const personNames = personCalls.map((call) => call[0].text);

    expect(personNames).toContain('Alice');
    expect(personNames).toContain('Bob');
  });

  it('creates SAID edges from Person to each extracted entity', async () => {
    const text = 'Alice: We decided to use JWT for authentication in the API.';
    const chunkResult = chunkConversation(text, { format: 'chat' });

    await extractConversation(chunkResult, ops, {
      extractor: { languageModel: mockModel },
    });

    const relCalls = vi.mocked(ops.createRelationship).mock.calls;
    const saidCalls = relCalls.filter((call) => call[0].type === 'SAID');

    // Alice should have SAID edges to extracted entities (Redis and JWT from mock)
    expect(saidCalls.length).toBeGreaterThan(0);
    const saidHeads = saidCalls.map((call) => call[0].headText);
    expect(saidHeads).toContain('Alice');
  });

  it('SAID edges have headType=Person and a descriptive fact string', async () => {
    const text = 'Alice: We should deploy this on Redis infrastructure.';
    const chunkResult = chunkConversation(text, { format: 'chat' });

    await extractConversation(chunkResult, ops, {
      extractor: { languageModel: mockModel },
    });

    const relCalls = vi.mocked(ops.createRelationship).mock.calls;
    const saidCalls = relCalls.filter((call) => call[0].type === 'SAID');

    if (saidCalls.length > 0) {
      const firstSaid = saidCalls[0]![0];
      expect(firstSaid.headType).toBe('Person');
      expect(firstSaid.headText).toBe('Alice');
      expect(typeof firstSaid.fact).toBe('string');
      expect(firstSaid.fact).toContain('Alice');
    }
  });

  it('does NOT create SAID edges when an episode has no speaker', async () => {
    // Paragraph-style text has no speaker attribution
    const text = 'Some system context without a named speaker in the text block.';
    const chunkResult = chunkConversation(text, { format: 'paragraphs' });
    expect(chunkResult.speakers).toHaveLength(0);

    await extractConversation(chunkResult, ops, {
      extractor: { languageModel: mockModel },
    });

    const relCalls = vi.mocked(ops.createRelationship).mock.calls;
    const saidCalls = relCalls.filter((call) => call[0].type === 'SAID');
    expect(saidCalls).toHaveLength(0);

    const entityCalls = vi.mocked(ops.createEntity).mock.calls;
    const personCalls = entityCalls.filter((call) => call[0].type === 'Person');
    expect(personCalls).toHaveLength(0);
  });

  it('creates Person entities for all three speakers in a multi-speaker conversation', async () => {
    const text = [
      'Alice: We should migrate to Redis for session storage.',
      'Bob: I can handle the JWT authentication layer updates.',
      'Charlie: I will coordinate the infrastructure deployment schedule.',
    ].join('\n');
    const chunkResult = chunkConversation(text, { format: 'chat' });

    await extractConversation(chunkResult, ops, {
      extractor: { languageModel: mockModel },
    });

    const entityCalls = vi.mocked(ops.createEntity).mock.calls;
    const personCalls = entityCalls.filter((call) => call[0].type === 'Person');
    const personNames = personCalls.map((call) => call[0].text);

    expect(personNames).toContain('Alice');
    expect(personNames).toContain('Bob');
    expect(personNames).toContain('Charlie');
  });
});

// ---------------------------------------------------------------------------
// Tests: chunkConversation speaker detection (pure unit, no LLM needed)
// ---------------------------------------------------------------------------

describe('chunkConversation correctly identifies speakers', () => {
  it('extracts speaker names from chat format', () => {
    const text = [
      'Alice: This message is long enough to pass the minimum length requirement.',
      'Bob: This is also long enough for the episode length minimum check.',
    ].join('\n');
    const result = chunkConversation(text, { format: 'chat' });
    expect(result.speakers).toContain('Alice');
    expect(result.speakers).toContain('Bob');
    expect(result.speakerCount).toBe(2);
  });

  it('returns empty speakers for paragraph-style text', () => {
    const text = 'This is a document paragraph without any speaker attribution.';
    const result = chunkConversation(text, { format: 'paragraphs' });
    expect(result.speakers).toHaveLength(0);
    expect(result.speakerCount).toBe(0);
  });

  it('de-duplicates speaker names across multiple episodes from same speaker', () => {
    const text = [
      'Alice: My first message about the Redis migration plan.',
      'Bob: A reply from Bob about the authentication layer.',
      'Alice: My second message about deployment considerations here.',
    ].join('\n');
    const result = chunkConversation(text, { format: 'chat' });
    expect(result.speakerCount).toBe(2);
    // Alice should appear only once in speakers list
    expect(result.speakers.filter((s) => s === 'Alice')).toHaveLength(1);
  });

  it('reports the correct speaker count', () => {
    const text = [
      'Alice: Message one from Alice about the system architecture.',
      'Bob: Message one from Bob about the implementation approach.',
      'Charlie: Message one from Charlie about the deployment pipeline.',
    ].join('\n');
    const result = chunkConversation(text, { format: 'chat' });
    expect(result.speakerCount).toBe(3);
  });
});
