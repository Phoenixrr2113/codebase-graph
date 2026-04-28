import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CypherDialect, GraphClient } from '@codegraph/graph';
import { clearEmbeddedLabelCache, getEmbeddedLabels } from '../enrichedSearchV2';

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

function makeMockClient(graphName: string, labels: string[]): GraphClient {
  const queryResult = { data: labels.map(l => ({ label: l })), metadata: [] };
  return {
    graph: null,
    graphName,
    dialect: stubDialect,
    query: vi.fn().mockResolvedValue(queryResult),
    roQuery: vi.fn().mockResolvedValue(queryResult),
    ensureIndexes: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe('_embeddedLabelsCache — per-graph keying', () => {
  beforeEach(() => {
    clearEmbeddedLabelCache();
  });

  it('caches separately per graphName', async () => {
    const clientA = makeMockClient('graph-a', ['Function', 'Class']);
    const clientB = makeMockClient('graph-b', ['Interface']);

    const labelsA = await getEmbeddedLabels(clientA);
    const labelsB = await getEmbeddedLabels(clientB);

    expect(labelsA).toEqual(['Function', 'Class']);
    expect(labelsB).toEqual(['Interface']);
  });

  it('returns cached labels on repeat call for same graphName (no second roQuery)', async () => {
    const client = makeMockClient('graph-x', ['Function']);
    await getEmbeddedLabels(client);
    await getEmbeddedLabels(client);
    expect(client.roQuery).toHaveBeenCalledTimes(1);
  });

  it('clearEmbeddedLabelCache(graphId) clears one entry; others remain', async () => {
    const clientA = makeMockClient('graph-a', ['Function']);
    const clientB = makeMockClient('graph-b', ['Class']);
    await getEmbeddedLabels(clientA);
    await getEmbeddedLabels(clientB);

    clearEmbeddedLabelCache('graph-a');

    await getEmbeddedLabels(clientA); // re-query expected
    await getEmbeddedLabels(clientB); // cached — no re-query

    expect(clientA.roQuery).toHaveBeenCalledTimes(2);
    expect(clientB.roQuery).toHaveBeenCalledTimes(1);
  });

  it('clearEmbeddedLabelCache() with no arg clears all entries', async () => {
    const client = makeMockClient('graph-x', ['Function']);
    await getEmbeddedLabels(client);

    clearEmbeddedLabelCache();

    await getEmbeddedLabels(client);
    expect(client.roQuery).toHaveBeenCalledTimes(2);
  });
});
