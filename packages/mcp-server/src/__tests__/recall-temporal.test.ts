/**
 * Task 6: Temporal MCP Recall Parameter Tests
 *
 * Verifies that the `recall` action correctly routes all four bitemporal
 * parameters to the operations-layer methods via the service layer:
 *
 *   at        → knowledgeService.queryAtPointInTime
 *   from/to   → knowledgeService.queryChangesInRange
 *   timeline  → knowledgeService.getEntityTimeline
 *   minRelevance → knowledgeService.searchByRelevance
 *
 * These are wiring tests: they mock the service layer to verify parameter
 * routing, response shape, and correct `mode` tag in the return value.
 * No live database required.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleRecall } from '../tools/knowledge';

// ─── Mock @codegraph/core ─────────────────────────────────────────────────────

vi.mock('@codegraph/core', () => ({
  knowledgeService: {
    queryAtPointInTime: vi.fn(),
    queryChangesInRange: vi.fn(),
    getEntityTimeline: vi.fn(),
    searchByRelevance: vi.fn(),
    queryBySpeaker: vi.fn(),
    recall: vi.fn(),
  },
  getKnowledgeOps: vi.fn(),
  closeGraphClient: vi.fn(),
  resetKnowledgeOps: vi.fn(),
}));

// ─── Import mocked service after mock is set up ───────────────────────────────

import { knowledgeService, getKnowledgeOps } from '@codegraph/core';

const mockService = knowledgeService as {
  queryAtPointInTime: ReturnType<typeof vi.fn>;
  queryChangesInRange: ReturnType<typeof vi.fn>;
  getEntityTimeline: ReturnType<typeof vi.fn>;
  searchByRelevance: ReturnType<typeof vi.fn>;
  queryBySpeaker: ReturnType<typeof vi.fn>;
  recall: ReturnType<typeof vi.fn>;
};

const mockGetKnowledgeOps = getKnowledgeOps as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  // Default mock for getKnowledgeOps (ABOUT edge path) — return ops with empty result
  mockGetKnowledgeOps.mockResolvedValue({
    getAboutEdgesForEntity: vi.fn().mockResolvedValue([]),
  });
});

// ─── at: point-in-time query ──────────────────────────────────────────────────

describe('recall — at (point-in-time)', () => {
  it('routes to queryAtPointInTime when at is provided', async () => {
    mockService.queryAtPointInTime.mockResolvedValue([]);

    const result = (await handleRecall({
      text: 'TemporalEntity',
      at: '2026-01-01T00:00:00Z',
    })) as Record<string, unknown>;

    expect(mockService.queryAtPointInTime).toHaveBeenCalledOnce();
    expect(mockService.queryAtPointInTime).toHaveBeenCalledWith(
      new Date('2026-01-01T00:00:00Z').getTime(),
    );
    expect(result.mode).toBe('point_in_time');
  });

  it('returns mode=point_in_time with correct at echo', async () => {
    mockService.queryAtPointInTime.mockResolvedValue([]);

    const result = (await handleRecall({
      text: 'AnyEntity',
      at: '2026-03-15T12:00:00Z',
    })) as Record<string, unknown>;

    expect(result.mode).toBe('point_in_time');
    expect(result.at).toBe('2026-03-15T12:00:00Z');
    expect(result.count).toBe(0);
    expect(Array.isArray(result.facts)).toBe(true);
  });

  it('maps fact fields from TemporalQueryResult shape', async () => {
    mockService.queryAtPointInTime.mockResolvedValue([
      {
        headText: 'Alice',
        headType: 'Person',
        tailText: 'Project X',
        tailType: 'Project',
        relationType: 'OWNS',
        confidence: 0.9,
        fact: 'Alice owns Project X',
        validAt: Date.now(),
      },
    ]);

    const result = (await handleRecall({
      text: 'Alice',
      at: new Date().toISOString(),
    })) as Record<string, unknown>;

    expect(result.count).toBe(1);
    const facts = result.facts as Array<Record<string, unknown>>;
    expect(facts[0].head).toBe('Alice (Person)');
    expect(facts[0].tail).toBe('Project X (Project)');
    expect(facts[0].type).toBe('OWNS');
    expect(facts[0].confidence).toBe(0.9);
  });

  it('does NOT call queryChangesInRange or getEntityTimeline', async () => {
    mockService.queryAtPointInTime.mockResolvedValue([]);

    await handleRecall({ text: 'X', at: '2026-01-01T00:00:00Z' });

    expect(mockService.queryChangesInRange).not.toHaveBeenCalled();
    expect(mockService.getEntityTimeline).not.toHaveBeenCalled();
    expect(mockService.searchByRelevance).not.toHaveBeenCalled();
  });
});

// ─── from/to: range query ─────────────────────────────────────────────────────

describe('recall — from/to (range query)', () => {
  it('routes to queryChangesInRange when both from and to are provided', async () => {
    mockService.queryChangesInRange.mockResolvedValue([]);

    await handleRecall({
      text: 'Entity',
      from: '2026-01-01T00:00:00Z',
      to: '2026-12-31T23:59:59Z',
    });

    expect(mockService.queryChangesInRange).toHaveBeenCalledOnce();
    expect(mockService.queryChangesInRange).toHaveBeenCalledWith(
      new Date('2026-01-01T00:00:00Z').getTime(),
      new Date('2026-12-31T23:59:59Z').getTime(),
    );
  });

  it('returns mode=range with from/to echo and changes array', async () => {
    mockService.queryChangesInRange.mockResolvedValue([]);

    const result = (await handleRecall({
      text: 'Entity',
      from: '2026-01-01T00:00:00Z',
      to: '2026-06-30T00:00:00Z',
    })) as Record<string, unknown>;

    expect(result.mode).toBe('range');
    expect(result.from).toBe('2026-01-01T00:00:00Z');
    expect(result.to).toBe('2026-06-30T00:00:00Z');
    expect(Array.isArray(result.changes)).toBe(true);
  });

  it('maps change fields from TemporalChangeResult shape', async () => {
    mockService.queryChangesInRange.mockResolvedValue([
      {
        change: 'added',
        headText: 'Bob',
        headType: 'Person',
        tailText: 'Decision Y',
        tailType: 'Decision',
        relationType: 'DECIDED',
        confidence: 0.85,
        fact: 'Bob decided Y',
        validAt: Date.now(),
        invalidAt: null,
      },
    ]);

    const result = (await handleRecall({
      text: 'Bob',
      from: '2026-01-01T00:00:00Z',
      to: '2026-12-31T00:00:00Z',
    })) as Record<string, unknown>;

    const changes = result.changes as Array<Record<string, unknown>>;
    expect(changes[0].change).toBe('added');
    expect(changes[0].head).toBe('Bob (Person)');
    expect(changes[0].type).toBe('DECIDED');
  });

  it('does NOT route when only from is provided (missing to)', async () => {
    // With only from (no to), the range branch should not fire.
    // It falls through to the next routing branch.
    mockService.recall.mockResolvedValue({ entity: 'Entity', relationships: [], relationshipCount: 0 });

    await handleRecall({ text: 'Entity', from: '2026-01-01T00:00:00Z' });

    expect(mockService.queryChangesInRange).not.toHaveBeenCalled();
  });
});

// ─── timeline: full chronological history ────────────────────────────────────

describe('recall — timeline', () => {
  it('routes to getEntityTimeline when timeline=true', async () => {
    mockService.getEntityTimeline.mockResolvedValue([]);

    await handleRecall({ text: 'SomeEntity', timeline: true });

    expect(mockService.getEntityTimeline).toHaveBeenCalledOnce();
    expect(mockService.getEntityTimeline).toHaveBeenCalledWith('SomeEntity', undefined);
  });

  it('passes type to getEntityTimeline when provided', async () => {
    mockService.getEntityTimeline.mockResolvedValue([]);

    await handleRecall({ text: 'SomeEntity', type: 'Project', timeline: true });

    expect(mockService.getEntityTimeline).toHaveBeenCalledWith('SomeEntity', 'Project');
  });

  it('returns mode=timeline with entity echo and timeline array', async () => {
    mockService.getEntityTimeline.mockResolvedValue([]);

    const result = (await handleRecall({
      text: 'TimelineEntity',
      timeline: true,
    })) as Record<string, unknown>;

    expect(result.mode).toBe('timeline');
    expect(result.entity).toBe('TimelineEntity');
    expect(result.count).toBe(0);
    expect(Array.isArray(result.timeline)).toBe(true);
  });

  it('maps timeline items including isActive flag', async () => {
    mockService.getEntityTimeline.mockResolvedValue([
      {
        headText: 'Alice',
        headType: 'Person',
        tailText: 'Role A',
        tailType: 'Role',
        relationType: 'HAS_ROLE',
        confidence: 0.9,
        fact: null,
        validAt: Date.now() - 10000,
        invalidAt: null,
        isActive: true,
      },
    ]);

    const result = (await handleRecall({
      text: 'Alice',
      timeline: true,
    })) as Record<string, unknown>;

    const entries = result.timeline as Array<Record<string, unknown>>;
    expect(entries[0].isActive).toBe(true);
    expect(entries[0].head).toBe('Alice (Person)');
  });

  it('does NOT route when timeline=false', async () => {
    mockService.recall.mockResolvedValue({ entity: 'X', relationships: [], relationshipCount: 0 });

    await handleRecall({ text: 'X', timeline: false });

    expect(mockService.getEntityTimeline).not.toHaveBeenCalled();
  });
});

// ─── minRelevance: relevance-weighted search ──────────────────────────────────

describe('recall — minRelevance', () => {
  it('routes to searchByRelevance when minRelevance is provided', async () => {
    mockService.searchByRelevance.mockResolvedValue([]);

    await handleRecall({ text: 'anything', minRelevance: 0.5 });

    expect(mockService.searchByRelevance).toHaveBeenCalledOnce();
    expect(mockService.searchByRelevance).toHaveBeenCalledWith(
      expect.objectContaining({ minRelevance: 0.5 }),
    );
  });

  it('passes limit to searchByRelevance', async () => {
    mockService.searchByRelevance.mockResolvedValue([]);

    await handleRecall({ text: 'anything', minRelevance: 0.3, limit: 25 });

    expect(mockService.searchByRelevance).toHaveBeenCalledWith(
      expect.objectContaining({ minRelevance: 0.3, limit: 25 }),
    );
  });

  it('returns mode=relevance with minRelevance echo and entities array', async () => {
    mockService.searchByRelevance.mockResolvedValue([]);

    const result = (await handleRecall({
      text: 'anything',
      minRelevance: 0.7,
    })) as Record<string, unknown>;

    expect(result.mode).toBe('relevance');
    expect(result.minRelevance).toBe(0.7);
    expect(Array.isArray(result.entities)).toBe(true);
  });

  it('maps entity fields from EntitySearchResult shape', async () => {
    const now = Date.now();
    mockService.searchByRelevance.mockResolvedValue([
      {
        id: 'ent-1',
        text: 'RelevantEntity',
        type: 'Concept',
        confidence: 0.9,
        relevanceScore: 0.88,
        createdAt: now,
        lastAccessedAt: now,
      },
    ]);

    const result = (await handleRecall({
      text: 'anything',
      minRelevance: 0.5,
    })) as Record<string, unknown>;

    const entities = result.entities as Array<Record<string, unknown>>;
    expect(entities[0].text).toBe('RelevantEntity');
    expect(entities[0].relevance).toBe(0.88);
    expect(typeof entities[0].createdAt).toBe('string'); // ISO string
  });

  it('does NOT call queryAtPointInTime when minRelevance is set', async () => {
    mockService.searchByRelevance.mockResolvedValue([]);

    await handleRecall({ text: 'anything', minRelevance: 0.1 });

    expect(mockService.queryAtPointInTime).not.toHaveBeenCalled();
    expect(mockService.queryChangesInRange).not.toHaveBeenCalled();
    expect(mockService.getEntityTimeline).not.toHaveBeenCalled();
  });
});
