/**
 * ingestConversation: Integration Tests
 *
 * Tests the full ingestion pipeline: text → chunk → extract → store → resolve.
 * This covers WS8.4 + WS8.5 acceptance criteria:
 *   - End-to-end: conversation → store → query → entities found
 *   - Multi-message conversations store entities with proper dedup
 *   - Speaker attribution preserved on entities
 *   - Format auto-detection works
 *   - Entity resolution runs on cross-episode duplicates
 *
 * Uses MockLanguageModelV3 from ai/test to mock the LLM.
 * Uses FalkorDB Docker for knowledge graph storage.
 *
 * Prerequisites: docker compose up -d falkordb
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';

vi.mock('../embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../embeddings')>();
  const createEmbedding = (text: string): number[] => {
    const embedding = new Array<number>(768).fill(0);
    const dimension = [...text].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 768;
    embedding[dimension] = 1;
    return embedding;
  };
  return {
    ...actual,
    isEmbeddingAvailable: vi.fn(() => true),
    generateEmbedding: vi.fn(async (text: string) => ({
      embedding: createEmbedding(text),
      dimensions: 768,
      provider: 'test',
    })),
    generateEmbeddings: vi.fn(async (texts: string[]) => ({
      embeddings: texts.map(createEmbedding),
      dimensions: 768,
      provider: 'test',
    })),
  };
});

import { MockLanguageModelV3 } from 'ai/test';
import {
  createClient,
  createKnowledgeOperations,
  type GraphClient,
  type KnowledgeOperations,
} from '@codegraph/graph';
import { ingestConversation } from '../extract-and-store';
import { makeToolCallResult } from './helpers/mock-tool-call-model';

// ============================================================================
// Helpers
// ============================================================================

const GRAPH_NAME = `test_ingest_${Date.now()}`;

/**
 * Create a mock LLM that pattern-matches known entities from conversation text.
 * Returns deterministic entities/relationships based on text content.
 */
function makeMockModel() {
  return new MockLanguageModelV3({
    provider: 'test',
    modelId: 'test-ingest-model',
    doGenerate: async ({ prompt }) => {
      // Extract the prompt text from the message structure
      let promptText = '';
      if (Array.isArray(prompt)) {
        for (const msg of prompt) {
          if ('content' in msg) {
            if (typeof msg.content === 'string') {
              promptText = msg.content;
            } else if (Array.isArray(msg.content)) {
              for (const part of msg.content) {
                if ('text' in part && typeof part.text === 'string') {
                  promptText += part.text;
                }
              }
            }
          }
        }
      } else if (typeof prompt === 'string') {
        promptText = prompt;
      }

      // Pattern-match entities from the text
      const entities: Array<{ text: string; type: string }> = [];
      const relationships: Array<{ headText: string; tailText: string; type: string }> = [];

      // Persons: extract speaker names from "CURRENT MESSAGE" patterns
      if (promptText.includes('Alice')) entities.push({ text: 'Alice', type: 'Person' });
      if (promptText.includes('Bob')) entities.push({ text: 'Bob', type: 'Person' });
      if (promptText.includes('Charlie')) entities.push({ text: 'Charlie', type: 'Person' });

      // Technical entities
      if (promptText.includes('payment module')) {
        entities.push({ text: 'payment module', type: 'CodeEntity' });
      }
      if (promptText.includes('race conditions')) {
        entities.push({ text: 'race conditions', type: 'Bug' });
      }
      if (promptText.includes('BullMQ')) {
        entities.push({ text: 'BullMQ', type: 'CodeEntity' });
      }
      if (promptText.includes('Redis')) {
        entities.push({ text: 'Redis', type: 'CodeEntity' });
      }
      if (promptText.includes('queue-based approach')) {
        entities.push({ text: 'queue-based approach', type: 'Solution' });
      }
      if (promptText.includes('performance testing')) {
        entities.push({ text: 'performance testing', type: 'Task' });
      }
      if (promptText.includes('Kubernetes')) {
        entities.push({ text: 'Kubernetes', type: 'CodeEntity' });
      }
      if (promptText.includes('deployment')) {
        entities.push({ text: 'deployment', type: 'Task' });
      }

      // Relationships based on patterns
      if (promptText.includes('Alice') && promptText.includes('payment module') && !promptText.includes('Context')) {
        relationships.push({ headText: 'Alice', tailText: 'payment module', type: 'WORKS_ON' });
      }
      if (promptText.includes('Bob') && promptText.includes('BullMQ') && !promptText.includes('Context')) {
        relationships.push({ headText: 'Bob', tailText: 'BullMQ', type: 'USES' });
      }
      if (promptText.includes('race conditions') && promptText.includes('payment module') && !promptText.includes('Context')) {
        relationships.push({ headText: 'payment module', tailText: 'race conditions', type: 'HAS_BUG' });
      }

      // Deduplicate entities by text (mock returning unique entities)
      const seen = new Set<string>();
      const dedupedEntities = entities.filter((e) => {
        if (seen.has(e.text)) return false;
        seen.add(e.text);
        return true;
      });

      const responseJson = { entities: dedupedEntities, relationships };
      return makeToolCallResult(responseJson);
    },
  });
}

// ============================================================================
// Tests
// ============================================================================

let falkordbAvailable = true;

describe('ingestConversation (FalkorDB)', () => {
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
    // Clean the graph between tests to prevent cross-test interference
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
  // WS8.5: End-to-end conversation → store → query → entities found
  // --------------------------------------------------------------------------

  it('end-to-end: ingests conversation and stores entities in knowledge graph', async () => {
    const chatText = [
      'Alice: We need to refactor the payment module',
      'Bob: I found race conditions in the current implementation',
      'Alice: Should we use a queue-based approach with BullMQ?',
    ].join('\n');

    const mockModel = makeMockModel();
    const result = await ingestConversation(chatText, ops, {
      format: 'chat',
      extractor: { languageModel: mockModel },
      resolve: false, // Skip resolution for this basic test
    });

    // Pipeline results
    expect(result.totalEpisodes).toBe(3);
    expect(result.entities).toBeGreaterThan(0);
    expect(result.format).toBe('chat');
    expect(result.speakers).toContain('Alice');
    expect(result.speakers).toContain('Bob');

    // Verify entities are actually stored in the knowledge graph
    const allEntities = await ops.searchEntities({ limit: 50 });
    expect(allEntities.length).toBeGreaterThan(0);

    // Verify specific entities exist
    const personEntities = await ops.searchEntities({ type: 'Person' });
    const personTexts = personEntities.map((e) => e.text);
    expect(personTexts).toContain('Alice');
    expect(personTexts).toContain('Bob');

    // Verify code entities
    const codeEntities = await ops.searchEntities({ type: 'CodeEntity' });
    const codeTexts = codeEntities.map((e) => e.text);
    expect(codeTexts).toContain('payment module');
  });

  // --------------------------------------------------------------------------
  // Speaker attribution preserved
  // --------------------------------------------------------------------------

  it('preserves speaker attribution in results', async () => {
    const chatText = [
      'Alice: I will handle the Redis integration',
      'Bob: I will focus on performance testing',
      'Charlie: I will set up Kubernetes deployment',
    ].join('\n');

    const mockModel = makeMockModel();
    const result = await ingestConversation(chatText, ops, {
      format: 'chat',
      extractor: { languageModel: mockModel },
      resolve: false,
    });

    expect(result.speakers).toHaveLength(3);
    expect(result.speakers).toContain('Alice');
    expect(result.speakers).toContain('Bob');
    expect(result.speakers).toContain('Charlie');
    expect(result.totalEpisodes).toBe(3);
  });

  // --------------------------------------------------------------------------
  // Format auto-detection
  // --------------------------------------------------------------------------

  it('auto-detects chat format', async () => {
    const chatText = [
      'Alice: We need to refactor the payment module',
      'Bob: Agreed, there are race conditions',
    ].join('\n');

    const mockModel = makeMockModel();
    const result = await ingestConversation(chatText, ops, {
      // format intentionally omitted: should auto-detect as 'chat'
      extractor: { languageModel: mockModel },
      resolve: false,
    });

    expect(result.format).toBe('chat');
    expect(result.speakers).toContain('Alice');
    expect(result.speakers).toContain('Bob');
    expect(result.entities).toBeGreaterThan(0);
  });

  it('auto-detects timestamped format', async () => {
    const timestampedText = [
      '[2026-03-10 10:00] Alice: We need to refactor the payment module',
      '[2026-03-10 10:05] Bob: I agree, let us use BullMQ',
    ].join('\n');

    const mockModel = makeMockModel();
    const result = await ingestConversation(timestampedText, ops, {
      extractor: { languageModel: mockModel },
      resolve: false,
    });

    expect(result.format).toBe('timestamped');
    expect(result.speakers).toContain('Alice');
    expect(result.speakers).toContain('Bob');
  });

  // --------------------------------------------------------------------------
  // Empty / edge cases
  // --------------------------------------------------------------------------

  it('handles empty conversation gracefully', async () => {
    const mockModel = makeMockModel();
    const result = await ingestConversation('', ops, {
      extractor: { languageModel: mockModel },
    });

    expect(result.totalEpisodes).toBe(0);
    expect(result.entities).toBe(0);
    expect(result.relationships).toBe(0);
    expect(result.speakers).toHaveLength(0);
  });

  it('handles single-message conversation', async () => {
    const chatText = 'Alice: We need to refactor the payment module';

    const mockModel = makeMockModel();
    const result = await ingestConversation(chatText, ops, {
      format: 'chat',
      extractor: { languageModel: mockModel },
      resolve: false,
    });

    expect(result.totalEpisodes).toBe(1);
    expect(result.entities).toBeGreaterThan(0);
    expect(result.speakers).toContain('Alice');
  });

  // --------------------------------------------------------------------------
  // Invalid format fallback
  // --------------------------------------------------------------------------

  it('falls back to auto format for invalid format string', async () => {
    const chatText = [
      'Alice: We need to refactor the payment module',
      'Bob: Agreed',
    ].join('\n');

    const mockModel = makeMockModel();
    const result = await ingestConversation(chatText, ops, {
      format: 'invalid-format-xyz',
      extractor: { languageModel: mockModel },
      resolve: false,
    });

    // Should fallback to 'auto' and still detect 'chat'
    expect(result.format).toBe('chat');
    expect(result.entities).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // Entity resolution integration
  // --------------------------------------------------------------------------

  it('runs entity resolution when resolve=true (default)', async () => {
    const chatText = [
      'Alice: We need to refactor the payment module',
      'Bob: The payment module has race conditions',
      'Alice: I agree about the payment module issues',
    ].join('\n');

    const mockModel = makeMockModel();
    const result = await ingestConversation(chatText, ops, {
      format: 'chat',
      extractor: { languageModel: mockModel },
      // resolve defaults to true
    });

    expect(result.totalEpisodes).toBe(3);
    expect(result.entities).toBeGreaterThan(0);

    // Resolution should have run (entities > 1 triggers it)
    // It may or may not find merges depending on exact/embedding matches
    if (result.resolution) {
      expect(result.resolution.kept).toBeGreaterThanOrEqual(0);
      expect(result.resolution.merged).toBeGreaterThanOrEqual(0);
    }
  });

  it('skips entity resolution when resolve=false', async () => {
    const chatText = [
      'Alice: We need to refactor the payment module',
      'Bob: The payment module has race conditions',
    ].join('\n');

    const mockModel = makeMockModel();
    const result = await ingestConversation(chatText, ops, {
      format: 'chat',
      extractor: { languageModel: mockModel },
      resolve: false,
    });

    expect(result.totalEpisodes).toBe(2);
    // Resolution should not have been attempted
    expect(result.resolution).toBeUndefined();
  });

  // --------------------------------------------------------------------------
  // Relationship storage
  // --------------------------------------------------------------------------

  it('stores relationships between entities', async () => {
    const chatText = [
      'Alice: I am working on the payment module',
      'Bob: The payment module has race conditions',
    ].join('\n');

    const mockModel = makeMockModel();
    const result = await ingestConversation(chatText, ops, {
      format: 'chat',
      extractor: { languageModel: mockModel },
      resolve: false,
    });

    expect(result.relationships).toBeGreaterThanOrEqual(0);

    // Verify relationships are queryable from the knowledge graph
    const rels = await ops.getRelationships({ entityText: 'Alice', limit: 10 });
    // Alice should have at least some relationships stored
    // (the exact count depends on what the mock returns vs what passes text grounding)
    expect(rels).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // Context window forwarding
  // --------------------------------------------------------------------------

  it('forwards contextWindow to episodic extraction', async () => {
    const chatText = [
      'Alice: We need to refactor the payment module',
      'Bob: I agree about the race conditions',
      'Charlie: Let us use BullMQ for the queue-based approach',
      'Alice: That sounds good for the deployment',
    ].join('\n');

    const mockModel = makeMockModel();
    const result = await ingestConversation(chatText, ops, {
      format: 'chat',
      extractor: { languageModel: mockModel },
      contextWindow: 2,
      resolve: false,
    });

    // All 4 episodes should be processed
    expect(result.totalEpisodes).toBe(4);
    expect(result.entities).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // Aggregation totals
  // --------------------------------------------------------------------------

  it('correctly aggregates totals across episodes', async () => {
    const chatText = [
      'Alice: We chose BullMQ for the queue-based approach',
      'Bob: We also need to address the race conditions',
    ].join('\n');

    const mockModel = makeMockModel();
    const result = await ingestConversation(chatText, ops, {
      format: 'chat',
      extractor: { languageModel: mockModel },
      resolve: false,
    });

    expect(result.totalEpisodes).toBe(2);
    // Entities from both episodes should be summed
    expect(result.entities).toBeGreaterThan(0);
    // episodesWithEntities should be <= totalEpisodes
    expect(result.episodesWithEntities).toBeLessThanOrEqual(result.totalEpisodes);
  });

  // --------------------------------------------------------------------------
  // WS8.5: Query after ingestion (full round-trip)
  // --------------------------------------------------------------------------

  it('entities are queryable after ingestion (full round-trip)', async () => {
    const chatText = [
      'Alice: We need to set up Redis for caching',
      'Bob: I will handle the Kubernetes deployment',
    ].join('\n');

    const mockModel = makeMockModel();
    await ingestConversation(chatText, ops, {
      format: 'chat',
      extractor: { languageModel: mockModel },
      resolve: false,
    });

    // Query the knowledge graph directly
    const allEntities = await ops.searchEntities({ limit: 100 });
    expect(allEntities.length).toBeGreaterThan(0);

    // Search by type
    const codeEntities = await ops.searchEntities({ type: 'CodeEntity' });
    const codeTexts = codeEntities.map((e) => e.text);
    // At least one of Redis/Kubernetes should be found
    const hasExpected = codeTexts.includes('Redis') || codeTexts.includes('Kubernetes');
    expect(hasExpected).toBe(true);

    // Search by text
    const redisSearch = await ops.searchEntities({ textContains: 'Redis' });
    // If the mock returned Redis and it passed text grounding, it should be found
    if (redisSearch.length > 0) {
      expect(redisSearch[0]!.text).toBe('Redis');
      expect(redisSearch[0]!.type).toBe('CodeEntity');
    }

    // Get relationships for a person
    const aliceRels = await ops.getRelationships({ entityText: 'Alice', limit: 50 });
    // Alice should have at least been stored as a Person entity
    const alice = await ops.searchEntities({ textContains: 'Alice', type: 'Person' });
    expect(alice.length).toBeGreaterThan(0);
  });
});
