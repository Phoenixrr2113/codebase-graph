import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CypherDialect, GraphClient } from '@codegraph/graph';
import { searchImpl } from '../services/search-service';
import * as graphClientMod from '../graphClient';
import * as enrichedSearchMod from '../enrichedSearchV2';

const stubDialect: CypherDialect = {
  driverType: 'mock',
  labelsExpr: () => '',
  firstLabelExpr: () => '',
  typeExpr: () => '',
  labelCheckExpr: () => '',
  labelCaseExpr: () => '',
  supportsOnCreateOnMatch: false,
  normalizeNode: () => ({ labels: [], properties: {} }),
  normalizeEdge: () => ({ type: '', properties: {} }),
};

function makeMockClient(graphName: string): GraphClient {
  return {
    graph: null,
    graphName,
    dialect: stubDialect,
    query: vi.fn().mockResolvedValue({ data: [], metadata: [] }),
    roQuery: vi.fn().mockResolvedValue({ data: [], metadata: [] }),
    ensureIndexes: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe('searchImpl — DI hook', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses caller-provided client and skips getGraphClient()', async () => {
    const callerClient = makeMockClient('caller-graph');
    const getClientSpy = vi.spyOn(graphClientMod, 'getGraphClient');
    const enrichedSpy = vi.spyOn(enrichedSearchMod, 'enrichedSearchV2').mockResolvedValue({
      hits: [],
      latencyMs: 0,
      totalCandidates: 0,
    } as never);

    await searchImpl('hello', { client: callerClient, scope: 'all', limit: 5 });

    expect(getClientSpy).not.toHaveBeenCalled();
    expect(enrichedSpy).toHaveBeenCalledWith('hello', callerClient, expect.any(Object));
  });

  it('falls back to getGraphClient() when no client provided', async () => {
    const fallbackClient = makeMockClient('fallback-graph');
    const getClientSpy = vi.spyOn(graphClientMod, 'getGraphClient').mockResolvedValue(fallbackClient);
    const enrichedSpy = vi.spyOn(enrichedSearchMod, 'enrichedSearchV2').mockResolvedValue({
      hits: [],
      latencyMs: 0,
      totalCandidates: 0,
    } as never);

    await searchImpl('hello', { scope: 'all', limit: 5 });

    expect(getClientSpy).toHaveBeenCalled();
    expect(enrichedSpy).toHaveBeenCalledWith('hello', fallbackClient, expect.any(Object));
  });
});
