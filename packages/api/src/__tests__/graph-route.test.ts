import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@codegraph/core', () => ({
  codeGraphService: {
    getFullGraph: vi.fn(),
    getFileSubgraph: vi.fn(),
    getSymbolReferences: vi.fn(),
    getDependencyTree: vi.fn(),
  },
  getGraphClient: vi.fn(),
  getSetupStatus: Object.assign(vi.fn(), {
    migrateEmbeddingProfile: vi.fn(),
  }),
  indexProject: Object.assign(vi.fn(), {
    getEmbeddingPassState: vi.fn(),
    scheduleEmbeddingPass: vi.fn(),
  }),
  knowledgeService: {},
}));

vi.mock('@codegraph/graph', () => ({
  createQueries: vi.fn(),
}));

import { codeGraphService, getGraphClient, getSetupStatus } from '@codegraph/core';
import { createQueries } from '@codegraph/graph';
import { graphRoutes } from '../routes/graph';
import { statsRoutes } from '../routes/stats';

const mockedFullGraph = vi.mocked(codeGraphService.getFullGraph);
const mockedReferences = vi.mocked(codeGraphService.getSymbolReferences);
const mockedDependencies = vi.mocked(codeGraphService.getDependencyTree);
const mockedGetGraphClient = vi.mocked(getGraphClient);
const mockedGetSetupStatus = vi.mocked(getSetupStatus);
const mockedCreateQueries = vi.mocked(createQueries);

const externalGuidance =
  'Embedded FalkorDBLite is unavailable on this platform. Set CODEGRAPH_DRIVER=falkordb and FALKORDB_URL, or configure FALKORDB_HOST and FALKORDB_PORT.';

const blockedSetupStatus = {
  storage: {
    driver: 'falkordb' as const,
    dataPath: null,
    ownerState: 'blocked' as const,
    embeddedSupported: false,
    externalGuidance,
    error: 'connect ECONNREFUSED 127.0.0.1:16379',
  },
  embedding: {
    profile: { provider: 'none' as const, model: null, dimension: 0 },
    keyPresent: false,
    localModelCached: false,
    modelLoad: null,
    migration: null,
  },
  projects: { configured: false, count: 0 },
  index: {
    state: 'not-configured' as const,
    progress: null,
    embeddingPass: { running: false, scope: null, startedAt: null },
  },
};

async function errorFor(path: string): Promise<{ status: number; error: string }> {
  const response = await graphRoutes.request(path);
  const body = (await response.json()) as { error: string };
  return { status: response.status, error: body.error };
}

describe('graph route numeric boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFullGraph.mockResolvedValue({
      nodes: [],
      edges: [],
      totalNodes: 0,
      totalEdges: 0,
      windowOrder: 'degree-desc,id-asc',
      degreeScope: 'global',
      offset: 0,
      limit: 100,
      returned: 0,
      hasMore: false,
      nextOffset: null,
      truncated: false,
    });
    mockedReferences.mockResolvedValue({ references: [], referencingFiles: [], truncated: false });
    mockedDependencies.mockResolvedValue({ nodes: [], edges: [] });
  });

  it.each(['NaN', 'Infinity', '0', '-1', '1.5', '1001'])(
    'rejects full graph limit=%s before touching the graph',
    async (limit) => {
      const result = await errorFor(`/api/graph/full?limit=${limit}`);

      expect(result.status).toBe(400);
      expect(result.error).toBe('limit must be a positive integer between 1 and 1000');
      expect(mockedFullGraph).not.toHaveBeenCalled();
    },
  );

  it('forwards the persisted symbol id as the references lookup identity', async () => {
    const id = 'sym:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const response = await graphRoutes.request(`/api/graph/references?id=${encodeURIComponent(id)}`);

    expect(response.status).toBe(200);
    expect(mockedReferences).toHaveBeenCalledWith({ id, limit: undefined });
  });

  it('accepts the full graph upper limit', async () => {
    const response = await graphRoutes.request('/api/graph/full?limit=1000');

    expect(response.status).toBe(200);
    expect(mockedFullGraph).toHaveBeenCalledWith(1000, undefined, 0);
  });

  it.each(['NaN', 'Infinity', '-1', '1.5'])(
    'rejects full graph offset=%s before touching the graph',
    async (offset) => {
      const result = await errorFor(`/api/graph/full?offset=${offset}`);

      expect(result).toEqual({ status: 400, error: 'offset must be a non-negative integer' });
      expect(mockedFullGraph).not.toHaveBeenCalled();
    },
  );

  it('forwards offset zero and positive offsets', async () => {
    await graphRoutes.request('/api/graph/full?limit=25&offset=3000');

    expect(mockedFullGraph).toHaveBeenCalledWith(25, undefined, 3000);
  });

  it('preserves full graph totals, ordering metadata, and truncation caveat', async () => {
    mockedFullGraph.mockResolvedValue({
      nodes: [],
      edges: [],
      totalNodes: 25,
      totalEdges: 40,
      windowOrder: 'degree-desc,id-asc',
      degreeScope: 'global',
      offset: 0,
      limit: 10,
      returned: 0,
      hasMore: true,
      nextOffset: 10,
      truncated: true,
    });

    const response = await graphRoutes.request('/api/graph/full?limit=10');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      nodes: [],
      edges: [],
      totalNodes: 25,
      totalEdges: 40,
      windowOrder: 'degree-desc,id-asc',
      degreeScope: 'global',
      offset: 0,
      limit: 10,
      returned: 0,
      hasMore: true,
      nextOffset: 10,
      truncated: true,
    });
  });

  it('projects full graph edges to the fields consumed by the dashboard', async () => {
    mockedFullGraph.mockResolvedValue({
      nodes: [],
      edges: [{
        id: '["CALLS","source","target"]',
        source: 'source',
        target: 'target',
        label: 'CALLS',
        data: {
          type: 'CALLS',
          from: 'source',
          to: 'target',
          bodySnippet: 'large relationship payload',
        },
      } as never],
      totalNodes: 2,
      totalEdges: 1,
      windowOrder: 'degree-desc,id-asc',
      degreeScope: 'global',
      offset: 0,
      limit: 10,
      returned: 0,
      hasMore: false,
      nextOffset: null,
      truncated: false,
    });

    const response = await graphRoutes.request('/api/graph/full?limit=10');

    expect(response.status).toBe(200);
    expect((await response.json()).edges).toEqual([{
      source: 'source',
      target: 'target',
      label: 'CALLS',
    }]);
  });

  it('resolves projectId to a boundary-safe graph scope', async () => {
    const roQuery = vi.fn().mockResolvedValue({ data: [{ rootPath: '/workspace/app' }], metadata: [] });
    mockedGetGraphClient.mockResolvedValue({ roQuery } as never);

    const response = await graphRoutes.request('/api/graph/full?projectId=project-app');

    expect(response.status).toBe(200);
    expect(mockedFullGraph).toHaveBeenCalledWith(100, '/workspace/app', 0);
  });

  it('does not fall back to the global graph for an unknown projectId', async () => {
    const roQuery = vi.fn().mockResolvedValue({ data: [], metadata: [] });
    mockedGetGraphClient.mockResolvedValue({ roQuery } as never);

    const response = await graphRoutes.request('/api/graph/full?projectId=missing');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Project not found' });
    expect(mockedFullGraph).not.toHaveBeenCalled();
  });

  it.each(['NaN', 'Infinity', '0', '-1', '1.5', '11'])(
    'rejects dependency depth=%s before touching the graph',
    async (depth) => {
      const result = await errorFor(`/api/graph/dependencies?path=/x/main.ts&depth=${depth}`);

      expect(result.status).toBe(400);
      expect(result.error).toBe('depth must be a positive integer between 1 and 10');
      expect(mockedDependencies).not.toHaveBeenCalled();
    },
  );

  it.each(['NaN', 'Infinity', '0', '-1', '1.5', '1001'])(
    'rejects reference limit=%s before touching the graph',
    async (limit) => {
      const result = await errorFor(`/api/graph/references?name=run&limit=${limit}`);

      expect(result.status).toBe(400);
      expect(result.error).toBe('limit must be a positive integer between 1 and 1000');
      expect(mockedReferences).not.toHaveBeenCalled();
    },
  );

  it('rejects the removed name-based references lookup', async () => {
    const result = await errorFor('/api/graph/references?name=run');

    expect(result).toEqual({ status: 400, error: 'id parameter is required' });
    expect(mockedReferences).not.toHaveBeenCalled();
  });
});

describe('GET /api/projects empty graph', () => {
  it('returns an empty project list', async () => {
    const roQuery = vi.fn().mockResolvedValue({ data: [], metadata: [] });
    mockedGetGraphClient.mockResolvedValue({ roQuery } as never);

    const response = await statsRoutes.request('/api/projects');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ projects: [] });
  });

  it('returns setup-compatible blocked storage instead of 500 when storage is unavailable', async () => {
    mockedGetGraphClient.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:16379'));
    mockedGetSetupStatus.mockResolvedValue(blockedSetupStatus);

    const response = await statsRoutes.request('/api/projects');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      projects: [],
      storage: blockedSetupStatus.storage,
    });
  });
});

describe('GET /api/graph/full unavailable storage', () => {
  it('returns an empty graph with setup-compatible blocked storage instead of 500', async () => {
    mockedFullGraph.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:16379'));
    mockedGetSetupStatus.mockResolvedValue(blockedSetupStatus);

    const response = await graphRoutes.request('/api/graph/full?limit=100');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      nodes: [],
      edges: [],
      totalNodes: 0,
      totalEdges: 0,
      windowOrder: 'degree-desc,id-asc',
      degreeScope: 'global',
      offset: 0,
      limit: 100,
      returned: 0,
      hasMore: false,
      nextOffset: null,
      truncated: false,
      storage: blockedSetupStatus.storage,
    });
  });
});

describe('GET /api/graph/files', () => {
  const getFileGraph = vi.fn();
  const fileGraphResult = {
    nodes: [{
      id: 'File:/x/main.ts',
      displayName: 'main.ts',
      filePath: '/x/main.ts',
      symbolCount: 3,
      label: 'File' as const,
    }],
    edges: [],
    totalNodes: 4,
    totalEdges: 5,
    windowOrder: 'degree-desc,id-asc' as const,
    offset: 0,
    limit: 50,
    returned: 1,
    hasMore: true,
    nextOffset: 1,
    truncated: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetGraphClient.mockResolvedValue({
      roQuery: vi.fn().mockResolvedValue({ data: [{ rootPath: '/x' }], metadata: [] }),
    } as never);
    getFileGraph.mockResolvedValue(fileGraphResult);
    mockedCreateQueries.mockReturnValue({ getFileGraph } as never);
  });

  it.each(['NaN', 'Infinity', '0', '-1', '1.5', '1001'])(
    'rejects limit=%s before touching the graph',
    async (limit) => {
      const result = await errorFor(`/api/graph/files?limit=${limit}`);

      expect(result.status).toBe(400);
      expect(result.error).toBe('limit must be a positive integer between 1 and 1000');
      expect(mockedGetGraphClient).not.toHaveBeenCalled();
    },
  );

  it('returns the frozen file graph shape scoped through project root resolution', async () => {
    const response = await graphRoutes.request('/api/graph/files?projectId=project-x&limit=50');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(fileGraphResult);
    expect(getFileGraph).toHaveBeenCalledWith(50, '/x', 0);
  });

  it.each(['NaN', 'Infinity', '-1', '1.5'])(
    'rejects offset=%s before touching the graph',
    async (offset) => {
      const result = await errorFor(`/api/graph/files?offset=${offset}`);

      expect(result).toEqual({ status: 400, error: 'offset must be a non-negative integer' });
      expect(mockedGetGraphClient).not.toHaveBeenCalled();
    },
  );

  it('forwards a positive file graph offset', async () => {
    await graphRoutes.request('/api/graph/files?limit=50&offset=3000');

    expect(getFileGraph).toHaveBeenCalledWith(50, undefined, 3000);
  });

  it('does not return the global file graph for an unknown projectId', async () => {
    mockedGetGraphClient.mockResolvedValueOnce({
      roQuery: vi.fn().mockResolvedValue({ data: [], metadata: [] }),
    } as never);

    const response = await graphRoutes.request('/api/graph/files?projectId=missing');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Project not found' });
    expect(getFileGraph).not.toHaveBeenCalled();
  });
});

describe('POST /api/graph/induced-edges', () => {
  const getInducedEdges = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetGraphClient.mockResolvedValue({
      roQuery: vi.fn().mockResolvedValue({ data: [{ rootPath: '/x' }], metadata: [] }),
    } as never);
    getInducedEdges.mockResolvedValue([{
      source: 'File:/x/a.ts',
      target: 'File:/x/b.ts',
      label: 'IMPORTS',
      id: 'hidden',
      data: { embedding: [0.1] },
    }]);
    mockedCreateQueries.mockReturnValue({ getInducedEdges } as never);
  });

  it.each([
    undefined,
    null,
    {},
    { ids: 'File:/x/a.ts' },
    { ids: [1] },
  ])('rejects malformed body %j before touching the graph', async (body) => {
    const response = await graphRoutes.request('/api/graph/induced-edges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? '{' : JSON.stringify(body),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'body must be an object with an ids string array' });
    expect(getInducedEdges).not.toHaveBeenCalled();
  });

  it('rejects more than 2000 ids before touching the graph', async () => {
    const response = await graphRoutes.request('/api/graph/induced-edges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from({ length: 2001 }, (_, index) => `node:${index}`) }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'ids must contain at most 2000 items' });
    expect(getInducedEdges).not.toHaveBeenCalled();
  });

  it('accepts exactly 2000 ids', async () => {
    const ids = Array.from({ length: 2000 }, (_, index) => `node:${index}`);
    const response = await graphRoutes.request('/api/graph/induced-edges', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });

    expect(response.status).toBe(200);
    expect(getInducedEdges).toHaveBeenCalledWith(ids, undefined);
  });

  it('returns only the public window edge shape and forwards project scope', async () => {
    const ids = ['File:/x/a.ts', 'File:/x/b.ts', 'File:/x/missing.ts'];
    const response = await graphRoutes.request('/api/graph/induced-edges?projectId=project-x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      edges: [{ source: 'File:/x/a.ts', target: 'File:/x/b.ts', label: 'IMPORTS' }],
    });
    expect(getInducedEdges).toHaveBeenCalledWith(ids, '/x');
  });

  it('does not fall back to global scope for an unknown project', async () => {
    mockedGetGraphClient.mockResolvedValueOnce({
      roQuery: vi.fn().mockResolvedValue({ data: [], metadata: [] }),
    } as never);

    const response = await graphRoutes.request('/api/graph/induced-edges?projectId=missing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [] }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Project not found' });
    expect(getInducedEdges).not.toHaveBeenCalled();
  });
});

describe('GET /api/graph/neighbors', () => {
  const getNodeNeighbors = vi.fn();
  const neighborResult = {
    centerId: 'File:/x/main.ts',
    nodes: [{ id: 'File:/x/main.ts', label: 'File', displayName: 'main.ts', filePath: '/x/main.ts', data: {} }],
    edges: [],
    incomingTruncated: false,
    outgoingTruncated: true,
    limit: 25,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetGraphClient.mockResolvedValue({} as never);
    getNodeNeighbors.mockResolvedValue(neighborResult);
    mockedCreateQueries.mockReturnValue({ getNodeNeighbors } as never);
  });

  it('requires a persisted id', async () => {
    const result = await errorFor('/api/graph/neighbors');

    expect(result).toEqual({ status: 400, error: 'id parameter is required' });
    expect(mockedGetGraphClient).not.toHaveBeenCalled();
  });

  it.each(['NaN', 'Infinity', '0', '-1', '1.5', '1001'])(
    'rejects limit=%s before touching the graph',
    async (limit) => {
      const result = await errorFor(`/api/graph/neighbors?id=File%3A%2Fx%2Fmain.ts&limit=${limit}`);

      expect(result.status).toBe(400);
      expect(result.error).toBe('limit must be a positive integer between 1 and 1000');
      expect(mockedGetGraphClient).not.toHaveBeenCalled();
    },
  );

  it('returns the frozen neighbor shape for a persisted File id', async () => {
    const response = await graphRoutes.request('/api/graph/neighbors?id=File%3A%2Fx%2Fmain.ts&limit=25');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(neighborResult);
    expect(getNodeNeighbors).toHaveBeenCalledWith('File:/x/main.ts', 25);
  });

  it('returns 404 when the persisted id does not exist', async () => {
    getNodeNeighbors.mockResolvedValueOnce(undefined);

    const response = await graphRoutes.request('/api/graph/neighbors?id=File%3A%2Fx%2Fmissing.ts');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Graph node not found' });
  });
});

describe('GET /api/graph/file-relationships', () => {
  const relationshipResult = {
    filePath: '/x/main.ts',
    containedSymbols: [{ id: 'Function:/x/main.ts:run:5', label: 'Function', displayName: 'run', filePath: '/x/main.ts', data: {} }],
    imports: [{ id: 'File:/x/dep.ts', label: 'File', displayName: 'dep.ts', filePath: '/x/dep.ts', data: {} }],
    importers: [{ id: 'File:/x/importer.ts', label: 'File', displayName: 'importer.ts', filePath: '/x/importer.ts', data: {} }],
    knowledgeEntities: [{ id: 'Entity:Decision:Main entry point', label: 'Entity', displayName: 'Main entry point', data: { text: 'Main entry point', type: 'Decision' } }],
    totals: { containedSymbols: 600, imports: 1, importers: 1, knowledgeEntities: 1 },
    truncated: { containedSymbols: true, imports: false, importers: false, knowledgeEntities: false },
    limit: 500,
  };
  const getFileRelationships = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetGraphClient.mockResolvedValue({} as never);
    getFileRelationships.mockResolvedValue(relationshipResult);
    mockedCreateQueries.mockReturnValue({ getFileRelationships } as never);
  });

  it('requires path', async () => {
    const result = await errorFor('/api/graph/file-relationships');

    expect(result).toEqual({ status: 400, error: 'path parameter is required' });
    expect(mockedGetGraphClient).not.toHaveBeenCalled();
  });

  it.each(['NaN', 'Infinity', '0', '-1', '1.5', '1001'])(
    'rejects limit=%s before touching the graph',
    async (limit) => {
      const result = await errorFor(`/api/graph/file-relationships?path=/x/main.ts&limit=${limit}`);

      expect(result.status).toBe(400);
      expect(result.error).toBe('limit must be a positive integer between 1 and 1000');
      expect(mockedGetGraphClient).not.toHaveBeenCalled();
    },
  );

  it('returns the frozen categorized response shape', async () => {
    const response = await graphRoutes.request('/api/graph/file-relationships?path=/x/main.ts&limit=50');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(relationshipResult);
    expect(getFileRelationships).toHaveBeenCalledWith('/x/main.ts', 50);
  });
});
