/**
 * Extract-and-Store — Integration Tests
 *
 * Tests the full pipeline: LLM extraction (mocked) → knowledge graph storage (real Kuzu).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MockLanguageModelV3 } from 'ai/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createClient, createKnowledgeOperations, type GraphClient, type KnowledgeOperations } from '@codegraph/graph';
import { extractAndStore, extractAndStoreBatch } from '../extract-and-store';

// ============================================================================
// Helpers
// ============================================================================

function makeMockModel(responseJson: object) {
  return new MockLanguageModelV3({
    provider: 'test',
    modelId: 'test-model',
    doGenerate: {
      content: [{ type: 'text' as const, text: JSON.stringify(responseJson) }],
      finishReason: { unified: 'stop' as const, raw: 'stop' },
      usage: {
        inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 10, text: 10, reasoning: 0 },
      },
      warnings: [],
    },
  });
}

// ============================================================================
// Test suite
// ============================================================================

describe('extractAndStore (integration)', () => {
  let client: GraphClient;
  let ops: KnowledgeOperations;
  let dbPath: string;

  beforeAll(async () => {
    const parentDir = mkdtempSync(join(tmpdir(), 'codegraph-eas-test-'));
    dbPath = join(parentDir, 'kuzu-db');

    client = await createClient({
      driver: 'kuzu',
      databasePath: dbPath,
      graphName: 'test',
    });

    await client.ensureIndexes();
    ops = createKnowledgeOperations(client);
  });

  afterAll(async () => {
    try {
      await client.close();
    } catch {
      // Kuzu SIGSEGV on close is known — ignore
    }
    try {
      rmSync(join(dbPath, '..'), { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  it('should extract entities from text and store them in the knowledge graph', async () => {
    const mockModel = makeMockModel({
      entities: [
        { text: 'Randy', type: 'Person' },
        { text: 'codebase-graph', type: 'Project' },
      ],
      relationships: [
        { headText: 'Randy', tailText: 'codebase-graph', type: 'CREATED' },
      ],
    });

    const result = await extractAndStore(
      'Randy created codebase-graph for code analysis',
      ops,
      { extractor: { languageModel: mockModel } }
    );

    expect(result.entities).toBe(2);
    expect(result.relationships).toBe(1);
    expect(result.sampleId).toBeTruthy();
    expect(result.annotated.entities).toHaveLength(2);

    // Verify entities are actually in the knowledge graph
    const randy = await ops.getEntityByText('Randy', 'Person');
    expect(randy).toBeTruthy();
    expect(randy!.text).toBe('Randy');

    const project = await ops.getEntityByText('codebase-graph', 'Project');
    expect(project).toBeTruthy();

    // Verify relationship was stored
    const rels = await ops.getRelationships({ entityText: 'Randy' });
    expect(rels.some((r) => r.relationType === 'CREATED')).toBe(true);
  });

  it('should handle text with no extractable entities', async () => {
    const mockModel = makeMockModel({
      entities: [],
      relationships: [],
    });

    const result = await extractAndStore(
      'The quick brown fox jumps over the lazy dog',
      ops,
      { extractor: { languageModel: mockModel } }
    );

    expect(result.entities).toBe(0);
    expect(result.relationships).toBe(0);
  });

  it('should respect minConfidence threshold', async () => {
    // The extractor assigns 0.9 confidence by default
    const mockModel = makeMockModel({
      entities: [
        { text: 'HighConf', type: 'Concept' },
      ],
      relationships: [],
    });

    // Set threshold above 0.9 — nothing should pass
    const result = await extractAndStore(
      'HighConf is a concept',
      ops,
      {
        extractor: { languageModel: mockModel },
        minConfidence: 0.95,
      }
    );

    expect(result.entities).toBe(0);
  });

  it('should batch extract and store multiple texts', async () => {
    const mockModel = makeMockModel({
      entities: [
        { text: 'Alice', type: 'Person' },
      ],
      relationships: [],
    });

    const results = await extractAndStoreBatch(
      [
        'Alice joined the engineering team',
        'Alice presented at the all-hands',
      ],
      ops,
      { extractor: { languageModel: mockModel } }
    );

    expect(results).toHaveLength(2);
    expect(results[0]!.entities).toBe(1);
    expect(results[1]!.entities).toBe(1);

    // Verify Alice is in the graph (deduplicated)
    const people = await ops.searchEntities({ type: 'Person' });
    const aliceCount = people.filter((p) => p.text === 'Alice').length;
    expect(aliceCount).toBe(1); // dedup should merge them
  });

  it('should track provenance via sampleId', async () => {
    const mockModel = makeMockModel({
      entities: [
        { text: 'ProvenanceTest', type: 'Concept' },
      ],
      relationships: [],
    });

    const result = await extractAndStore(
      'ProvenanceTest is a concept for testing provenance',
      ops,
      { extractor: { languageModel: mockModel } }
    );

    // The sampleId should be recorded in the entity
    expect(result.sampleId).toMatch(/^sample-/);

    // Verify entity exists
    const entity = await ops.getEntityByText('ProvenanceTest', 'Concept');
    expect(entity).toBeTruthy();
  });
});
