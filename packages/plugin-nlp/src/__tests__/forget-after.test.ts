/**
 * forgetAfter: Unit Tests
 *
 * Verifies that:
 * 1. LLM-provided forgetAfter + forgetReason land on the RelationshipAnnotation returned
 *    by EntityExtractor.extract()
 * 2. forgetAfter + forgetReason propagate from ExtractedRelationship through extractAndStore
 *    and reach importEntitiesAndRelationships as KnowledgeRelationship fields
 * 3. When forgetAfter is omitted by the LLM, the fields are undefined/null on the annotation
 */

import { describe, it, expect, vi } from 'vitest';
import { EntityExtractor } from '../extractor';
import { extractAndStore } from '../extract-and-store';
import type { KnowledgeOperations, KnowledgeEntity, KnowledgeRelationship } from '@codegraph/graph';
import type { Sample } from '@codegraph/types';
import { makeToolCallModel } from './helpers/mock-tool-call-model';

// ============================================================================
// Helpers
// ============================================================================

function makeSample(text: string): Sample {
  return {
    id: `test-${Math.random().toString(36).slice(2, 10)}`,
    text,
    source: 'test',
    createdAt: new Date().toISOString(),
  };
}

/**
 * Minimal mock of KnowledgeOperations that captures what was passed to
 * importEntitiesAndRelationships so tests can assert on persisted values.
 */
function makeMockOps(): KnowledgeOperations & {
  capturedRelationships: KnowledgeRelationship[];
} {
  const capturedRelationships: KnowledgeRelationship[] = [];

  return {
    capturedRelationships,
    createEntity: vi.fn().mockResolvedValue('entity-id'),
    searchEntities: vi.fn().mockResolvedValue([]),
    createRelationship: vi.fn().mockResolvedValue(undefined),
    getRelationships: vi.fn().mockResolvedValue([]),
    invalidateRelationship: vi.fn().mockResolvedValue(false),
    importEntitiesAndRelationships: vi.fn(
      async (
        _entities: KnowledgeEntity[],
        relationships: KnowledgeRelationship[],
        _sampleId: string,
      ) => {
        capturedRelationships.push(...relationships);
        return { entities: _entities.length, relationships: relationships.length };
      },
    ),
    touchEntity: vi.fn().mockResolvedValue(true),
    decayRelevance: vi.fn().mockResolvedValue({ decayed: 0 }),
    pruneOldEntities: vi.fn().mockResolvedValue({ pruned: 0 }),
    getMemoryStats: vi.fn().mockResolvedValue({
      totalEntities: 0,
      avgRelevance: 1,
      lowRelevanceCount: 0,
      oldestAccess: null,
      newestAccess: null,
    }),
    searchEntitiesByVector: vi.fn().mockResolvedValue([]),
    createAboutEdge: vi.fn().mockResolvedValue(false),
    getAboutEdgesForEntity: vi.fn().mockResolvedValue([]),
    mergeEntities: vi.fn().mockResolvedValue({ transferredRelationships: 0, transferredAboutEdges: 0 }),
    getEntitiesBySpeaker: vi.fn().mockResolvedValue([]),
    searchFactsByVector: vi.fn().mockResolvedValue([]),
    searchEntitiesBySource: vi.fn().mockResolvedValue([]),
    queryAtPointInTime: vi.fn().mockResolvedValue([]),
    queryChangesInRange: vi.fn().mockResolvedValue([]),
    getEntityTimeline: vi.fn().mockResolvedValue([]),
    searchByRelevance: vi.fn().mockResolvedValue([]),
  };
}

// ============================================================================
// EntityExtractor: forgetAfter propagation to RelationshipAnnotation
// ============================================================================

describe('EntityExtractor: forgetAfter', () => {
  it('should preserve forgetAfter and forgetReason on RelationshipAnnotation when LLM provides them', async () => {
    const forgetAfterTs = '2026-05-01T15:00:00Z';
    const mockModel = makeToolCallModel({
      entities: [
        { text: 'Alice', type: 'Person' },
        { text: 'standup meeting', type: 'Event' },
      ],
      relationships: [
        {
          headText: 'Alice',
          tailText: 'standup meeting',
          type: 'ATTENDS',
          forgetAfter: forgetAfterTs,
          forgetReason: 'scheduled event',
        },
      ],
    });

    const extractor = new EntityExtractor({ languageModel: mockModel });
    const sample = makeSample('Alice attends standup meeting at 3pm');
    const result = await extractor.extract(sample);

    expect(result.relationships).toHaveLength(1);
    const rel = result.relationships[0]!;
    expect(rel.forgetAfter).toBe(forgetAfterTs);
    expect(rel.forgetReason).toBe('scheduled event');
  });

  it('should leave forgetAfter undefined when LLM omits it for a permanent fact', async () => {
    const mockModel = makeToolCallModel({
      entities: [
        { text: 'Randy', type: 'Person' },
        { text: 'FalkorDB', type: 'Technology' },
      ],
      relationships: [
        {
          headText: 'Randy',
          tailText: 'FalkorDB',
          type: 'USES',
          // forgetAfter intentionally omitted
        },
      ],
    });

    const extractor = new EntityExtractor({ languageModel: mockModel });
    const sample = makeSample('Randy uses FalkorDB for the knowledge graph');
    const result = await extractor.extract(sample);

    expect(result.relationships).toHaveLength(1);
    const rel = result.relationships[0]!;
    expect(rel.forgetAfter).toBeUndefined();
    expect(rel.forgetReason).toBeUndefined();
  });

  it('should treat explicit null forgetAfter as permanent fact', async () => {
    const mockModel = makeToolCallModel({
      entities: [
        { text: 'Randy', type: 'Person' },
        { text: 'codebase-graph', type: 'Project' },
      ],
      relationships: [
        {
          headText: 'Randy',
          tailText: 'codebase-graph',
          type: 'CREATED',
          forgetAfter: null,
          forgetReason: null,
        },
      ],
    });

    const extractor = new EntityExtractor({ languageModel: mockModel });
    const sample = makeSample('Randy created codebase-graph');
    const result = await extractor.extract(sample);

    expect(result.relationships).toHaveLength(1);
    const rel = result.relationships[0]!;
    // null from LLM does not set the field (only non-null values are copied)
    expect(rel.forgetAfter == null).toBe(true);
    expect(rel.forgetReason == null).toBe(true);
  });
});

// ============================================================================
// extractAndStore: forgetAfter propagation to KnowledgeRelationship
// ============================================================================

describe('extractAndStore: forgetAfter persistence', () => {
  it('should pass forgetAfter and forgetReason to importEntitiesAndRelationships', async () => {
    const forgetAfterTs = '2026-06-15T09:00:00Z';
    const mockModel = makeToolCallModel({
      entities: [
        { text: 'Bob', type: 'Person' },
        { text: 'sprint review', type: 'Event' },
      ],
      relationships: [
        {
          headText: 'Bob',
          tailText: 'sprint review',
          type: 'PRESENTS_AT',
          forgetAfter: forgetAfterTs,
          forgetReason: 'scheduled event',
        },
      ],
    });

    const ops = makeMockOps();
    await extractAndStore('Bob presents at sprint review on June 15', ops, {
      embeddings: false,
      extractor: { languageModel: mockModel },
    });

    expect(ops.capturedRelationships).toHaveLength(1);
    const rel = ops.capturedRelationships[0]!;
    expect(rel.forgetAfter).toBe(forgetAfterTs);
    expect(rel.forgetReason).toBe('scheduled event');
  });

  it('should leave forgetAfter absent on KnowledgeRelationship when LLM omits it', async () => {
    const mockModel = makeToolCallModel({
      entities: [
        { text: 'Alice', type: 'Person' },
        { text: 'codegraph', type: 'Project' },
      ],
      relationships: [
        {
          headText: 'Alice',
          tailText: 'codegraph',
          type: 'OWNS',
          // no forgetAfter
        },
      ],
    });

    const ops = makeMockOps();
    await extractAndStore('Alice owns codegraph', ops, {
      embeddings: false,
      extractor: { languageModel: mockModel },
    });

    expect(ops.capturedRelationships).toHaveLength(1);
    const rel = ops.capturedRelationships[0]!;
    // forgetAfter should be absent (undefined or null: not set to a value)
    expect(rel.forgetAfter == null).toBe(true);
  });
});
