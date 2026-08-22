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
    mockedFullGraph.mockResolvedValue({ nodes: [], edges: [] });
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
    expect(mockedFullGraph).toHaveBeenCalledWith(1000, undefined);
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
      storage: blockedSetupStatus.storage,
    });
  });
});

describe('GET /api/graph/file-relationships', () => {
  const relationshipResult = {
    filePath: '/x/main.ts',
    containedSymbols: [{ id: 'Function:/x/main.ts:run:5', label: 'Function', displayName: 'run', filePath: '/x/main.ts', data: {} }],
    imports: [{ id: 'File:/x/dep.ts', label: 'File', displayName: 'dep.ts', filePath: '/x/dep.ts', data: {} }],
    importers: [{ id: 'File:/x/importer.ts', label: 'File', displayName: 'importer.ts', filePath: '/x/importer.ts', data: {} }],
    knowledgeEntities: [{ id: 'Entity:Decision:Main entry point', label: 'Entity', displayName: 'Main entry point', data: { text: 'Main entry point', type: 'Decision' } }],
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

  it.each(['NaN', 'Infinity', '0', '-1', '1.5', '501'])(
    'rejects limit=%s before touching the graph',
    async (limit) => {
      const result = await errorFor(`/api/graph/file-relationships?path=/x/main.ts&limit=${limit}`);

      expect(result.status).toBe(400);
      expect(result.error).toBe('limit must be a positive integer between 1 and 500');
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
