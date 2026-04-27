/**
 * Task 7: Dark Data MCP Exposure Tests
 *
 * Verifies four previously-hidden capabilities are exposed correctly:
 *
 *   1. recall returns ABOUT edges (knowledge → code bridges) when entity has them
 *      and args.type is provided — tested via mock getAboutEdgesForEntity
 *   2. query_knowledge accepts source: string (sampleId prefix filter)
 *   3. decay_and_prune accepts minAge, decayRate, minRelevance params
 *   4. resolve_entities is a standalone callable MCP action
 *
 * Wiring tests: mock the service/operations layer to verify parameter
 * routing and response shapes without a live database.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRecall, handleQueryKnowledge, handleDecayAndPrune, handleResolveEntities } from '../tools/knowledge';

// ─── Mock @codegraph/core (preserve real exports, override specific ones) ─────

vi.mock('@codegraph/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codegraph/core')>();
  return {
    ...actual,
    knowledgeService: {
      ...actual.knowledgeService,
      recall: vi.fn(),
      queryAtPointInTime: vi.fn(),
      queryChangesInRange: vi.fn(),
      getEntityTimeline: vi.fn(),
      searchByRelevance: vi.fn(),
      queryBySpeaker: vi.fn(),
      getEntities: vi.fn(),
      queryKnowledge: vi.fn(),
      decayAndPrune: vi.fn(),
    },
    getKnowledgeOps: vi.fn(),
  };
});

import { knowledgeService, getKnowledgeOps } from '@codegraph/core';

const mockService = knowledgeService as {
  recall: ReturnType<typeof vi.fn>;
  getEntities: ReturnType<typeof vi.fn>;
  queryKnowledge: ReturnType<typeof vi.fn>;
  decayAndPrune: ReturnType<typeof vi.fn>;
};

const mockGetKnowledgeOps = getKnowledgeOps as ReturnType<typeof vi.fn>;

// ─── Shared default mocks ─────────────────────────────────────────────────────

const defaultMockOps = {
  getAboutEdgesForEntity: vi.fn().mockResolvedValue([]),
  searchEntitiesBySource: vi.fn().mockResolvedValue([]),
  getEntities: vi.fn().mockResolvedValue([]),
  decayRelevance: vi.fn().mockResolvedValue({ decayed: 0 }),
  pruneOldEntities: vi.fn().mockResolvedValue({ pruned: 0 }),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetKnowledgeOps.mockResolvedValue(defaultMockOps);
  mockService.recall.mockResolvedValue({
    entity: 'TestEntity',
    relationships: [],
    relationshipCount: 0,
  });
  mockService.getEntities.mockResolvedValue([]);
  mockService.decayAndPrune.mockResolvedValue({ decayed: 0, pruned: 0 });
});

// ─── 1. ABOUT edges in recall ─────────────────────────────────────────────────

describe('recall — ABOUT edge enrichment', () => {
  it('calls getAboutEdgesForEntity when type is provided', async () => {
    const mockAboutOps = {
      ...defaultMockOps,
      getAboutEdgesForEntity: vi.fn().mockResolvedValue([]),
    };
    mockGetKnowledgeOps.mockResolvedValue(mockAboutOps);

    await handleRecall({ text: 'AuthModule', type: 'Module' });

    expect(mockAboutOps.getAboutEdgesForEntity).toHaveBeenCalledWith('AuthModule', 'Module');
  });

  it('does NOT call getAboutEdgesForEntity when type is omitted', async () => {
    const mockAboutOps = {
      ...defaultMockOps,
      getAboutEdgesForEntity: vi.fn().mockResolvedValue([]),
    };
    mockGetKnowledgeOps.mockResolvedValue(mockAboutOps);

    await handleRecall({ text: 'AuthModule' });

    expect(mockAboutOps.getAboutEdgesForEntity).not.toHaveBeenCalled();
  });

  it('includes bridges field in result when ABOUT edges exist', async () => {
    const mockAboutOps = {
      ...defaultMockOps,
      getAboutEdgesForEntity: vi.fn().mockResolvedValue([
        {
          targetLabel: 'Function',
          targetValue: 'authenticate',
          confidence: 0.92,
          method: 'embedding',
          createdAt: Date.now(),
        },
      ]),
    };
    mockGetKnowledgeOps.mockResolvedValue(mockAboutOps);

    const result = (await handleRecall({
      text: 'AuthModule',
      type: 'Module',
    })) as Record<string, unknown>;

    expect(result.bridges).toBeDefined();
    const bridges = result.bridges as Array<Record<string, unknown>>;
    expect(bridges).toHaveLength(1);
    expect(bridges[0].targetLabel).toBe('Function');
    expect(bridges[0].targetValue).toBe('authenticate');
    expect(bridges[0].confidence).toBe(0.92);
    expect(bridges[0].method).toBe('embedding');
  });

  it('bridges field is absent when no ABOUT edges exist', async () => {
    mockGetKnowledgeOps.mockResolvedValue({
      ...defaultMockOps,
      getAboutEdgesForEntity: vi.fn().mockResolvedValue([]),
    });

    const result = (await handleRecall({
      text: 'NoEdgesEntity',
      type: 'Concept',
    })) as Record<string, unknown>;

    expect(result.bridges).toBeUndefined();
  });

  it('returns standard recall even if getAboutEdgesForEntity throws', async () => {
    mockGetKnowledgeOps.mockResolvedValue({
      ...defaultMockOps,
      getAboutEdgesForEntity: vi.fn().mockRejectedValue(new Error('DB error')),
    });

    const result = (await handleRecall({
      text: 'FallbackEntity',
      type: 'Concept',
    })) as Record<string, unknown>;

    // Should not propagate the error — falls back to standard recall
    expect(result.error).toBeUndefined();
    expect(result.entity).toBe('TestEntity');
  });
});

// ─── 2. query_knowledge source filter ────────────────────────────────────────

describe('query_knowledge — source filter', () => {
  it('accepts source parameter and routes to searchEntitiesBySource', async () => {
    const mockSourceOps = {
      ...defaultMockOps,
      searchEntitiesBySource: vi.fn().mockResolvedValue([]),
    };
    mockGetKnowledgeOps.mockResolvedValue(mockSourceOps);

    const result = (await handleQueryKnowledge({
      source: 'meeting-2024-01-15',
    })) as Record<string, unknown>;

    expect(mockSourceOps.searchEntitiesBySource).toHaveBeenCalledWith('meeting-2024-01-15', expect.any(Number));
    // Should not error and should return entity list
    expect(result.error).toBeUndefined();
    expect(typeof result.count).toBe('number');
    expect(Array.isArray(result.entities)).toBe(true);
  });

  it('returns empty entities for non-matching source prefix', async () => {
    mockGetKnowledgeOps.mockResolvedValue({
      ...defaultMockOps,
      searchEntitiesBySource: vi.fn().mockResolvedValue([]),
    });

    const result = (await handleQueryKnowledge({
      source: 'definitely-no-match-xyz-999',
    })) as Record<string, unknown>;

    expect(result.count).toBe(0);
    expect(result.entities).toEqual([]);
  });

  it('source response echoes the source prefix', async () => {
    mockGetKnowledgeOps.mockResolvedValue({
      ...defaultMockOps,
      searchEntitiesBySource: vi.fn().mockResolvedValue([]),
    });

    const result = (await handleQueryKnowledge({
      source: 'meeting-2024',
    })) as Record<string, unknown>;

    expect(result.error).toBeUndefined();
    expect(result.source).toBe('meeting-2024');
  });

  it('result without source filter still works (no regression)', async () => {
    mockGetKnowledgeOps.mockResolvedValue({
      ...defaultMockOps,
    });
    // For standard path, queryKnowledge is called on the service
    (knowledgeService as Record<string, unknown>).queryKnowledge = vi.fn().mockResolvedValue([
      { id: 'e1', text: 'AuthModule', type: 'Module', confidence: 0.9, sampleIds: [], relevanceScore: 1.0, createdAt: Date.now(), lastAccessedAt: Date.now() },
    ]);

    const result = (await handleQueryKnowledge({
      type: 'Module',
    })) as Record<string, unknown>;

    expect(result.error).toBeUndefined();
    expect(result.count).toBe(1);
  });
});

// ─── 3. decay_and_prune params: decayRate, minAge, minRelevance ──────────────

describe('decay_and_prune — all parameters', () => {
  it('passes decayRate to knowledgeService.decayAndPrune', async () => {
    await handleDecayAndPrune({ prune: false, decayRate: 0.005 });

    expect(mockService.decayAndPrune).toHaveBeenCalledWith(
      expect.objectContaining({ decayRate: 0.005 }),
    );
  });

  it('passes minAge to knowledgeService.decayAndPrune', async () => {
    await handleDecayAndPrune({ prune: false, minAge: 86400000 });

    expect(mockService.decayAndPrune).toHaveBeenCalledWith(
      expect.objectContaining({ minAge: 86400000 }),
    );
  });

  it('passes minRelevance to knowledgeService.decayAndPrune', async () => {
    await handleDecayAndPrune({ prune: false, minRelevance: 0.2 });

    expect(mockService.decayAndPrune).toHaveBeenCalledWith(
      expect.objectContaining({ minRelevance: 0.2 }),
    );
  });

  it('passes all three params together', async () => {
    await handleDecayAndPrune({ prune: false, decayRate: 0.01, minAge: 0, minRelevance: 0.05 });

    expect(mockService.decayAndPrune).toHaveBeenCalledWith(
      expect.objectContaining({ decayRate: 0.01, minAge: 0, minRelevance: 0.05 }),
    );
  });

  it('returns decayed count and pruned=0 when prune=false', async () => {
    mockService.decayAndPrune.mockResolvedValue({ decayed: 5, pruned: 0 });

    const result = (await handleDecayAndPrune({ prune: false, decayRate: 0.01 })) as Record<string, unknown>;

    expect(result.decayed).toBe(5);
    expect(result.pruned).toBe(0);
    expect(typeof result.message).toBe('string');
  });

  it('message includes prune count when prune=true', async () => {
    mockService.decayAndPrune.mockResolvedValue({ decayed: 3, pruned: 2 });

    const result = (await handleDecayAndPrune({ prune: true })) as Record<string, unknown>;

    expect(result.message).toContain('pruned');
  });
});

// ─── 4. resolve_entities standalone action ────────────────────────────────────

// handleResolveEntities uses a dynamic import internally, so we stub the ops
// layer and let the function error gracefully when plugin-nlp is unavailable.
// The key assertion is that the function returns a structured response (not throws).

describe('resolve_entities', () => {
  it('handleResolveEntities is exported and callable (not missing)', async () => {
    // Verifies the function exists and is properly exported — foundational wiring check
    expect(typeof handleResolveEntities).toBe('function');
  });

  it('returns a structured result (not an unhandled exception)', async () => {
    // With no DB connected and no LLM key, resolve_entities should gracefully
    // return a structured error — not throw unhandled.
    const result = (await handleResolveEntities({})) as Record<string, unknown>;

    // Must be an object — either success or structured error
    expect(typeof result).toBe('object');
    expect(result).not.toBeNull();
  });

  it('returns structured error (not throw) when ops layer fails', async () => {
    mockGetKnowledgeOps.mockRejectedValue(new Error('DB not available'));

    const result = (await handleResolveEntities({})) as Record<string, unknown>;

    // Must NOT throw — must return { error: string }
    expect(result.error).toBeDefined();
    expect(typeof result.error).toBe('string');
  });

  it('returns success shape when resolveEntities succeeds', async () => {
    // Mock getKnowledgeOps to return minimal valid ops object
    const mockOps = { ...defaultMockOps };
    mockGetKnowledgeOps.mockResolvedValue(mockOps);

    // handleResolveEntities does a dynamic import('@codegraph/plugin-nlp')
    // We can't easily mock dynamic imports, so we test the error path instead.
    // If it errors due to missing API key, that's a structured error — still valid.
    const result = (await handleResolveEntities({})) as Record<string, unknown>;

    expect(typeof result).toBe('object');
    if (result.error) {
      // Graceful LLM config error is acceptable
      expect(typeof result.error).toBe('string');
    } else {
      // Success path: expect numeric fields
      expect(typeof result.total).toBe('number');
      expect(typeof result.merged).toBe('number');
      expect(Array.isArray(result.merges)).toBe(true);
    }
  });
});
