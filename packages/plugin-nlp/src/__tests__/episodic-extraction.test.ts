/**
 * Episodic Extraction — Unit Tests
 *
 * Tests the conversation episodic extraction pipeline:
 *   1. Context window builds correct prior episode context
 *   2. Each episode is processed with appropriate context
 *   3. Results are aggregated correctly
 *   4. Progress callbacks fire
 *
 * Uses MockLanguageModelV3 from ai/test to mock the LLM.
 * Uses FalkorDB Docker for knowledge graph storage.
 *
 * Prerequisites: docker compose up -d falkordb
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import {
  createClient,
  createKnowledgeOperations,
  type GraphClient,
  type KnowledgeOperations,
} from '@codegraph/graph';
import { chunkConversation } from '../conversation';
import { extractConversation } from '../extract-and-store';

// ============================================================================
// Helpers
// ============================================================================

const GRAPH_NAME = `test_episodic_${Date.now()}`;

/** Track LLM prompts received */
let capturedPrompts: string[] = [];

/**
 * Create a mock LLM that captures prompts and returns deterministic entities.
 * The mock inspects the text for known entity patterns and returns them.
 */
function makeMockModel() {
  capturedPrompts = [];

  return new MockLanguageModelV3({
    provider: 'test',
    modelId: 'test-episodic-model',
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

      capturedPrompts.push(promptText);

      // Parse the text to determine what entities to return
      const entities: Array<{ text: string; type: string }> = [];
      const relationships: Array<{ headText: string; tailText: string; type: string }> = [];

      // Simple pattern matching for test data
      if (promptText.includes('payment module')) {
        entities.push({ text: 'payment module', type: 'CodeEntity' });
      }
      if (promptText.includes('race conditions')) {
        entities.push({ text: 'race conditions', type: 'Problem' });
      }
      if (promptText.includes('queue-based approach')) {
        entities.push({ text: 'queue-based approach', type: 'Solution' });
      }
      if (promptText.includes('BullMQ')) {
        entities.push({ text: 'BullMQ', type: 'CodeEntity' });
      }
      if (promptText.includes('implementation')) {
        entities.push({ text: 'implementation', type: 'Task' });
      }

      // Extract speaker names as Person entities if they appear in the current message
      const speakerMatch = promptText.match(/CURRENT MESSAGE[^"]*"([A-Za-z]+):/);
      if (speakerMatch) {
        entities.push({ text: speakerMatch[1]!, type: 'Person' });
      }

      // Only keep entities whose text actually appears in the "text" portion
      // (This is what the real parseResponse does via indexOf)

      const responseJson = { entities, relationships };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(responseJson) }],
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

// ============================================================================
// Tests
// ============================================================================

describe('Episodic Extraction (FalkorDB)', () => {
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
    } catch {
      console.error(
        'FalkorDB not available — skipping tests. Run: docker compose up -d falkordb',
      );
      throw new Error('FalkorDB not available');
    }

    await client.ensureIndexes();
    ops = createKnowledgeOperations(client);
  }, 30_000);

  afterAll(async () => {
    try {
      await client.query('MATCH (n) DETACH DELETE n', { params: {} });
    } catch { /* best effort */ }
    try {
      await client.close();
    } catch { /* best effort */ }
  });

  // --------------------------------------------------------------------------
  // Test: basic episodic extraction
  // --------------------------------------------------------------------------

  it('processes each episode and stores entities', async () => {
    const chatText = [
      'Alice: We need to refactor the payment module',
      'Bob: I agree, the current implementation has race conditions',
      'Alice: Should we use a queue-based approach?',
    ].join('\n');

    const chunks = chunkConversation(chatText, { format: 'chat' });
    expect(chunks.episodes).toHaveLength(3);

    const mockModel = makeMockModel();
    const result = await extractConversation(chunks, ops, {
      extractor: { languageModel: mockModel },
      contextWindow: 4,
    });

    expect(result.totalEpisodes).toBe(3);
    // At least some episodes should produce entities
    expect(result.entities).toBeGreaterThan(0);
    expect(result.episodeResults).toHaveLength(3);
  });

  // --------------------------------------------------------------------------
  // Test: context window limits
  // --------------------------------------------------------------------------

  it('limits context to specified window size', async () => {
    const chatText = [
      'Alice: Message one about testing',
      'Bob: Message two about deployment',
      'Charlie: Message three about security',
      'Alice: Message four about monitoring',
      'Bob: Message five about the payment module',
    ].join('\n');

    const chunks = chunkConversation(chatText, { format: 'chat' });
    expect(chunks.episodes).toHaveLength(5);

    const mockModel = makeMockModel();
    await extractConversation(chunks, ops, {
      extractor: { languageModel: mockModel },
      contextWindow: 2,
    });

    // The last episode (index 4) should only have context from episodes 2 and 3
    // (window size = 2), not episodes 0 and 1
    // Episode 0 (first) should have NO context
    // We can verify by checking prompts captured

    // First prompt should not contain "Context" or prior messages
    // (it will use the standard buildPrompt since context is empty)
    expect(capturedPrompts).toHaveLength(5);

    // Last prompt should have context but NOT include episode 0 or 1
    const lastPrompt = capturedPrompts[4]!;
    expect(lastPrompt).toContain('security'); // episode 2 (in context)
    expect(lastPrompt).toContain('monitoring'); // episode 3 (in context)
    // Episode 0 and 1 should NOT be in context
    expect(lastPrompt).not.toContain('Message one');
    expect(lastPrompt).not.toContain('Message two');
  });

  // --------------------------------------------------------------------------
  // Test: first episode has no context
  // --------------------------------------------------------------------------

  it('first episode is extracted without context', async () => {
    const chatText = [
      'Alice: We need to refactor the payment module',
      'Bob: I agree completely with that assessment',
    ].join('\n');

    const chunks = chunkConversation(chatText, { format: 'chat' });
    const mockModel = makeMockModel();

    await extractConversation(chunks, ops, {
      extractor: { languageModel: mockModel },
      contextWindow: 4,
    });

    expect(capturedPrompts).toHaveLength(2);

    // First prompt should NOT contain "Context" markers since there's no context
    const firstPrompt = capturedPrompts[0]!;
    expect(firstPrompt).not.toContain('Context (prior messages');

    // Second prompt SHOULD contain context from first episode
    const secondPrompt = capturedPrompts[1]!;
    expect(secondPrompt).toContain('payment module'); // from episode 0
  });

  // --------------------------------------------------------------------------
  // Test: progress callback
  // --------------------------------------------------------------------------

  it('fires progress callback for each episode', async () => {
    const chatText = [
      'Alice: First message about the payment module',
      'Bob: Second message about race conditions',
      'Charlie: Third message about BullMQ library',
    ].join('\n');

    const chunks = chunkConversation(chatText, { format: 'chat' });
    const mockModel = makeMockModel();

    const progressCalls: Array<[number, number]> = [];

    await extractConversation(chunks, ops, {
      extractor: { languageModel: mockModel },
      contextWindow: 4,
      onProgress: (current, total) => {
        progressCalls.push([current, total]);
      },
    });

    expect(progressCalls).toHaveLength(3);
    expect(progressCalls[0]).toEqual([1, 3]);
    expect(progressCalls[1]).toEqual([2, 3]);
    expect(progressCalls[2]).toEqual([3, 3]);
  });

  // --------------------------------------------------------------------------
  // Test: empty conversation
  // --------------------------------------------------------------------------

  it('handles empty conversation gracefully', async () => {
    const chunks = chunkConversation('');
    const mockModel = makeMockModel();

    const result = await extractConversation(chunks, ops, {
      extractor: { languageModel: mockModel },
    });

    expect(result.totalEpisodes).toBe(0);
    expect(result.entities).toBe(0);
    expect(result.episodeResults).toHaveLength(0);
  });

  // --------------------------------------------------------------------------
  // Test: speaker attribution in results
  // --------------------------------------------------------------------------

  it('preserves speaker information in extraction metadata', async () => {
    const chatText = [
      'Alice: We need to refactor the payment module',
      'Bob: I agree, the current implementation has race conditions',
    ].join('\n');

    const chunks = chunkConversation(chatText, { format: 'chat' });
    const mockModel = makeMockModel();

    const result = await extractConversation(chunks, ops, {
      extractor: { languageModel: mockModel },
    });

    expect(result.speakers).toContain('Alice');
    expect(result.speakers).toContain('Bob');
    expect(result.format).toBe('chat');
  });

  // --------------------------------------------------------------------------
  // Test: context includes speaker names
  // --------------------------------------------------------------------------

  it('context includes speaker names for pronoun resolution', async () => {
    const chatText = [
      'Alice: I will refactor the payment module',
      'Bob: She should also fix the retry logic',
    ].join('\n');

    const chunks = chunkConversation(chatText, { format: 'chat' });
    const mockModel = makeMockModel();

    await extractConversation(chunks, ops, {
      extractor: { languageModel: mockModel },
      contextWindow: 4,
    });

    expect(capturedPrompts).toHaveLength(2);

    // Second prompt should have Alice's message as context with her name
    const secondPrompt = capturedPrompts[1]!;
    expect(secondPrompt).toContain('Alice');
    expect(secondPrompt).toContain('refactor the payment module');
  });

  // --------------------------------------------------------------------------
  // Test: aggregation totals
  // --------------------------------------------------------------------------

  it('correctly aggregates totals across episodes', async () => {
    const chatText = [
      'Alice: We chose BullMQ for the queue-based approach',
      'Bob: We also need to address the race conditions',
    ].join('\n');

    const chunks = chunkConversation(chatText, { format: 'chat' });
    const mockModel = makeMockModel();

    const result = await extractConversation(chunks, ops, {
      extractor: { languageModel: mockModel },
    });

    expect(result.totalEpisodes).toBe(2);
    // Entities from both episodes should be summed
    expect(result.entities).toBe(
      result.episodeResults.reduce((sum, r) => sum + r.entities, 0),
    );
    expect(result.relationships).toBe(
      result.episodeResults.reduce((sum, r) => sum + r.relationships, 0),
    );
  });
});
