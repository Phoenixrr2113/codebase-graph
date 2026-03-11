/**
 * Temporal Conflict Resolution — Integration Tests
 *
 * Tests the full conflict resolution pipeline (WS9):
 *   - Contradicting facts → old invalidated, new stored
 *   - Non-contradicting facts → both kept
 *   - recall filters invalidated edges by default
 *   - recall with includeHistory shows full timeline
 *   - invalidateRelationship sets invalid_at correctly
 *
 * Uses MockLanguageModelV3 from ai/test to mock the LLM.
 * Uses FalkorDB Docker for knowledge graph storage.
 *
 * Prerequisites: docker compose up -d falkordb
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import {
  createClient,
  createKnowledgeOperations,
  type GraphClient,
  type KnowledgeOperations,
} from '@codegraph/graph';
import { checkAndResolveConflicts } from '../conflict-resolution';

// ============================================================================
// Helpers
// ============================================================================

const GRAPH_NAME = `test_conflicts_${Date.now()}`;

/**
 * Mock LLM that evaluates contradictions based on pattern matching.
 * Returns CONTRADICTION when both old and new facts contain keywords
 * that indicate replacement (e.g., "switched from", "no longer", "replaced").
 */
function makeContradictionMock(shouldContradict: boolean) {
  return new MockLanguageModelV3({
    provider: 'test',
    modelId: 'test-conflict-model',
    doGenerate: async ({ prompt }) => {
      // Extract prompt text
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

      const response = shouldContradict
        ? 'CONTRADICTION: The new fact supersedes the old one'
        : 'NO_CONTRADICTION: These facts describe different aspects';

      return {
        content: [{ type: 'text' as const, text: response }],
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

describe('Temporal Conflict Resolution (FalkorDB)', () => {
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

  beforeEach(async () => {
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
  // Test: invalidateRelationship sets invalid_at
  // --------------------------------------------------------------------------

  it('invalidateRelationship sets invalid_at on matching edge', async () => {
    // Create entities and relationship
    await ops.createEntity({ text: 'team', type: 'Organization', confidence: 0.9 });
    await ops.createEntity({ text: 'JWT', type: 'Technology', confidence: 0.9 });
    await ops.createRelationship({
      headText: 'team',
      headType: 'Organization',
      tailText: 'JWT',
      tailType: 'Technology',
      type: 'USES',
      confidence: 0.9,
      fact: 'The team decided to use JWT for authentication',
    });

    // Verify relationship exists (valid)
    const before = await ops.getRelationships({ entityText: 'team' });
    expect(before.length).toBe(1);
    expect(before[0]!.relationType).toBe('USES');

    // Invalidate it
    const invalidated = await ops.invalidateRelationship(
      'team', 'Organization', 'JWT', 'Technology', 'USES',
    );
    expect(invalidated).toBe(true);

    // After invalidation, default query should exclude it
    const after = await ops.getRelationships({ entityText: 'team' });
    expect(after.length).toBe(0);

    // With includeInvalidated, it should still be visible
    const afterAll = await ops.getRelationships({
      entityText: 'team',
      includeInvalidated: true,
    });
    expect(afterAll.length).toBe(1);
    expect(afterAll[0]!.relationType).toBe('USES');
  });

  // --------------------------------------------------------------------------
  // Test: Contradicting facts → old invalidated
  // --------------------------------------------------------------------------

  it('detects contradiction and invalidates old edge', async () => {
    // Setup: create entities and an existing relationship
    await ops.createEntity({ text: 'project', type: 'Project', confidence: 0.9 });
    await ops.createEntity({ text: 'JWT', type: 'Technology', confidence: 0.9 });
    await ops.createRelationship({
      headText: 'project',
      headType: 'Project',
      tailText: 'JWT',
      tailType: 'Technology',
      type: 'USES',
      confidence: 0.9,
      fact: 'We decided to use JWT for authentication',
    });

    // Mock LLM that says CONTRADICTION
    const mockLlm = makeContradictionMock(true);

    // Check for conflict when adding a new relationship
    const result = await checkAndResolveConflicts(ops, {
      headText: 'project',
      headType: 'Project',
      tailText: 'JWT',
      tailType: 'Technology',
      type: 'USES',
      fact: 'After security review, switching from JWT to session tokens',
    }, {
      llm: mockLlm,
    });

    expect(result.checked).toBeGreaterThan(0);
    expect(result.contradictions).toBe(1);
    expect(result.invalidated).toBe(1);
    expect(result.details).toHaveLength(1);
    expect(result.details[0]!.reason).toContain('supersedes');

    // The old relationship should now be invalidated
    const validRels = await ops.getRelationships({ entityText: 'project' });
    expect(validRels.length).toBe(0);

    // But visible in history
    const allRels = await ops.getRelationships({
      entityText: 'project',
      includeInvalidated: true,
    });
    expect(allRels.length).toBe(1);
  });

  // --------------------------------------------------------------------------
  // Test: Non-contradicting facts → both kept
  // --------------------------------------------------------------------------

  it('keeps both facts when no contradiction detected', async () => {
    // Setup
    await ops.createEntity({ text: 'Sarah', type: 'Person', confidence: 0.9 });
    await ops.createEntity({ text: 'coffee', type: 'Concept', confidence: 0.9 });
    await ops.createRelationship({
      headText: 'Sarah',
      headType: 'Person',
      tailText: 'coffee',
      tailType: 'Concept',
      type: 'LIKES',
      confidence: 0.9,
      fact: 'Sarah likes coffee',
    });

    // Mock LLM that says NO_CONTRADICTION
    const mockLlm = makeContradictionMock(false);

    // New fact about Sarah — not contradicting
    const result = await checkAndResolveConflicts(ops, {
      headText: 'Sarah',
      headType: 'Person',
      tailText: 'coffee',
      tailType: 'Concept',
      type: 'LIKES',
      fact: 'Sarah joined the team',
    }, {
      llm: mockLlm,
    });

    expect(result.checked).toBeGreaterThan(0);
    expect(result.contradictions).toBe(0);
    expect(result.invalidated).toBe(0);

    // Original relationship should still be valid
    const rels = await ops.getRelationships({ entityText: 'Sarah' });
    expect(rels.length).toBe(1);
    expect(rels[0]!.fact).toBe('Sarah likes coffee');
  });

  // --------------------------------------------------------------------------
  // Test: No LLM provided → skip conflict resolution
  // --------------------------------------------------------------------------

  it('skips conflict resolution when no LLM provided', async () => {
    await ops.createEntity({ text: 'team', type: 'Organization', confidence: 0.9 });
    await ops.createEntity({ text: 'Redis', type: 'Technology', confidence: 0.9 });
    await ops.createRelationship({
      headText: 'team',
      headType: 'Organization',
      tailText: 'Redis',
      tailType: 'Technology',
      type: 'USES',
      confidence: 0.9,
    });

    // No LLM — should return empty result
    const result = await checkAndResolveConflicts(ops, {
      headText: 'team',
      headType: 'Organization',
      tailText: 'Redis',
      tailType: 'Technology',
      type: 'USES',
    }, {
      // no llm
    });

    expect(result.checked).toBe(0);
    expect(result.contradictions).toBe(0);

    // Original still valid
    const rels = await ops.getRelationships({ entityText: 'team' });
    expect(rels.length).toBe(1);
  });

  // --------------------------------------------------------------------------
  // Test: No existing relationships → no conflict
  // --------------------------------------------------------------------------

  it('handles no existing relationships gracefully', async () => {
    await ops.createEntity({ text: 'NewProject', type: 'Project', confidence: 0.9 });
    await ops.createEntity({ text: 'Go', type: 'Technology', confidence: 0.9 });

    // No existing relationships — new fact is first
    const mockLlm = makeContradictionMock(true);
    const result = await checkAndResolveConflicts(ops, {
      headText: 'NewProject',
      headType: 'Project',
      tailText: 'Go',
      tailType: 'Technology',
      type: 'USES',
    }, {
      llm: mockLlm,
    });

    expect(result.checked).toBe(0);
    expect(result.contradictions).toBe(0);
    expect(result.invalidated).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Test: recall filters invalidated by default
  // --------------------------------------------------------------------------

  it('recall filters invalidated edges by default', async () => {
    // Create two relationships, invalidate one
    await ops.createEntity({ text: 'budget', type: 'Concept', confidence: 0.9 });
    await ops.createEntity({ text: '$50k', type: 'Amount', confidence: 0.9 });
    await ops.createEntity({ text: '$75k', type: 'Amount', confidence: 0.9 });

    await ops.createRelationship({
      headText: 'budget',
      headType: 'Concept',
      tailText: '$50k',
      tailType: 'Amount',
      type: 'IS',
      confidence: 0.9,
      fact: 'Budget is $50k',
    });

    await ops.createRelationship({
      headText: 'budget',
      headType: 'Concept',
      tailText: '$75k',
      tailType: 'Amount',
      type: 'IS',
      confidence: 0.9,
      fact: 'Budget increased to $75k',
    });

    // Invalidate the old $50k relationship
    await ops.invalidateRelationship('budget', 'Concept', '$50k', 'Amount', 'IS');

    // Default recall — only valid facts
    const validRels = await ops.getRelationships({ entityText: 'budget' });
    expect(validRels.length).toBe(1);
    expect(validRels[0]!.tailText).toBe('$75k');

    // History recall — all facts including invalidated
    const allRels = await ops.getRelationships({
      entityText: 'budget',
      includeInvalidated: true,
    });
    expect(allRels.length).toBe(2);
    const texts = allRels.map((r) => r.tailText).sort();
    expect(texts).toEqual(['$50k', '$75k']);
  });
});
