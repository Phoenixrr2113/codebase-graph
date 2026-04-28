import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getKnowledgeOps, resetKnowledgeOps } from '../knowledgeClient';
import type { GraphClient, CypherDialect } from '@codegraph/graph';

const stubDialect: CypherDialect = {
  driverType: 'stub',
  labelsExpr: (alias) => `labels(${alias})`,
  firstLabelExpr: (alias) => `labels(${alias})[0]`,
  typeExpr: (alias) => `type(${alias})`,
  labelCheckExpr: (alias, label) => `${alias}:${label}`,
  labelCaseExpr: (alias, label) => `${alias}:${label}`,
  supportsOnCreateOnMatch: true,
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

describe('getKnowledgeOps()', () => {
  beforeEach(() => {
    resetKnowledgeOps();
  });

  it('returns a fresh ops instance when client is provided (no caching)', async () => {
    const clientA = makeMockClient('graph-a');
    const clientB = makeMockClient('graph-b');
    const opsA = await getKnowledgeOps(clientA);
    const opsB = await getKnowledgeOps(clientB);
    expect(opsA).not.toBe(opsB);
  });

  it('does NOT call ensureIndexes on caller-provided client (caller-managed lifecycle)', async () => {
    const client = makeMockClient('graph-x');
    await getKnowledgeOps(client);
    expect(client.ensureIndexes).not.toHaveBeenCalled();
  });
});
