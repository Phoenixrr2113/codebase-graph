import { beforeEach, describe, expect, it, vi } from 'vitest';

const { scheduleEmbeddingPass, getEmbeddingPassState, getSetupStatus, migrateEmbeddingProfile } = vi.hoisted(() => ({
  scheduleEmbeddingPass: vi.fn(),
  getEmbeddingPassState: vi.fn(),
  getSetupStatus: vi.fn(),
  migrateEmbeddingProfile: vi.fn(),
}));

vi.mock('@codegraph/core', () => ({
  codeGraphService: {
    resolveProjectRootPath: vi.fn(),
  },
  getGraphClient: vi.fn(),
  getSetupStatus: Object.assign(getSetupStatus, { migrateEmbeddingProfile }),
  indexProject: Object.assign(vi.fn(), {
    scheduleEmbeddingPass,
    getEmbeddingPassState,
  }),
}));

import { codeGraphService, getGraphClient } from '@codegraph/core';
import { statsRoutes } from '../routes/stats';

const mockedResolveProjectRootPath = vi.mocked(codeGraphService.resolveProjectRootPath);
const mockedGetGraphClient = vi.mocked(getGraphClient);

const idlePass = {
  running: false,
  scope: null,
  startedAt: null,
};

const embeddingSetup = {
  profile: { provider: 'local', model: 'nomic-ai/nomic-embed-text-v1.5', dimension: 768 },
  keyPresent: false,
  localModelCached: true,
  modelLoad: {
    state: 'ready',
    model: 'nomic-ai/nomic-embed-text-v1.5',
    cached: true,
  },
  migration: null,
};

const setupStatus = {
  storage: {
    driver: 'falkordblite',
    dataPath: '/private/tmp/codegraph-api-test',
    ownerState: 'owned',
    embeddedSupported: true,
    externalGuidance: null,
    error: null,
  },
  embedding: embeddingSetup,
  projects: { configured: false, count: 0 },
  index: { state: 'not-configured', progress: null, embeddingPass: idlePass },
};

const externalGuidance =
  'Embedded FalkorDBLite is unavailable on this platform. Set CODEGRAPH_DRIVER=falkordb and FALKORDB_URL, or configure FALKORDB_HOST and FALKORDB_PORT.';

const blockedSetupStatus = {
  ...setupStatus,
  storage: {
    driver: 'falkordb' as const,
    dataPath: null,
    ownerState: 'blocked' as const,
    embeddedSupported: false,
    externalGuidance,
    error: 'connect ECONNREFUSED 127.0.0.1:16379',
  },
};

function graphClientWith(rows: Array<{ label: string; total: number; withEmbedding: number }>) {
  return {
    roQuery: vi.fn().mockResolvedValue({ data: rows, metadata: [] }),
  };
}

describe('embedding routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEmbeddingPassState.mockReturnValue(idlePass);
    getSetupStatus.mockResolvedValue(setupStatus);
    scheduleEmbeddingPass.mockResolvedValue({
      embedded: 2,
      skipped: 1,
      errors: 0,
      durationMs: 250,
      byType: { File: 2 },
    });
    migrateEmbeddingProfile.mockResolvedValue({
      embedded: 2,
      skipped: 0,
      errors: 0,
      durationMs: 300,
      byType: { Function: 2 },
      profile: embeddingSetup.profile,
    });
  });

  it('reports global coverage with an explicit global scope', async () => {
    const client = graphClientWith([{ label: 'File', total: 4, withEmbedding: 3 }]);
    mockedGetGraphClient.mockResolvedValue(client as never);

    const response = await statsRoutes.request('/api/embeddings/status');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      scope: { type: 'global' },
      embeddingPass: idlePass,
      embedding: embeddingSetup,
      labels: [{ label: 'File', total: 4, withEmbedding: 3, coverage: 75 }],
    });
    expect(client.roQuery).toHaveBeenCalledWith(
      expect.not.stringContaining('$projectPath'),
      { params: {} },
    );
    expect(getEmbeddingPassState).toHaveBeenCalledWith(undefined);
  });

  it('reports zero coverage for an empty graph', async () => {
    const client = graphClientWith([]);
    mockedGetGraphClient.mockResolvedValue(client as never);

    const response = await statsRoutes.request('/api/embeddings/status');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      scope: { type: 'global' },
      embeddingPass: idlePass,
      embedding: embeddingSetup,
      labels: [],
    });
  });

  it('returns setup-compatible blocked storage instead of 500 when coverage storage is unavailable', async () => {
    mockedGetGraphClient.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:16379'));
    getSetupStatus.mockResolvedValue(blockedSetupStatus);

    const response = await statsRoutes.request('/api/embeddings/status');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      scope: { type: 'global' },
      embeddingPass: idlePass,
      embedding: embeddingSetup,
      labels: [],
      storage: blockedSetupStatus.storage,
    });
  });

  it('resolves projectId and scopes coverage with an exact-or-slash-prefix boundary', async () => {
    mockedResolveProjectRootPath.mockResolvedValue('/repos/app/');
    const client = graphClientWith([{ label: 'Function', total: 2, withEmbedding: 1 }]);
    mockedGetGraphClient.mockResolvedValue(client as never);

    const response = await statsRoutes.request('/api/embeddings/status?projectId=project-1');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      scope: { type: 'project', projectId: 'project-1', rootPath: '/repos/app' },
      embeddingPass: idlePass,
      embedding: embeddingSetup,
      labels: [{ label: 'Function', total: 2, withEmbedding: 1, coverage: 50 }],
    });
    const [cypher, options] = client.roQuery.mock.calls[0]!;
    expect(cypher).toContain('n.filePath = $projectPath OR n.filePath STARTS WITH $projectPathPrefix');
    expect(options).toEqual({
      params: { projectPath: '/repos/app', projectPathPrefix: '/repos/app/' },
    });
    expect(getEmbeddingPassState).toHaveBeenCalledWith('project-1');
  });

  it('returns 404 for an unknown status projectId before querying coverage', async () => {
    mockedResolveProjectRootPath.mockResolvedValue(undefined);

    const response = await statsRoutes.request('/api/embeddings/status?projectId=missing');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Project not found.' });
    expect(mockedGetGraphClient).not.toHaveBeenCalled();
  });

  it('publishes the setup status contract', async () => {
    const response = await statsRoutes.request('/api/setup/status');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(setupStatus);
  });

  it('adds the frozen external guidance when configured storage is unreachable', async () => {
    getSetupStatus.mockResolvedValue({
      ...blockedSetupStatus,
      storage: {
        ...blockedSetupStatus.storage,
        embeddedSupported: true,
        externalGuidance: null,
      },
    });

    const response = await statsRoutes.request('/api/setup/status');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ...blockedSetupStatus,
      storage: {
        ...blockedSetupStatus.storage,
        embeddedSupported: true,
        externalGuidance,
      },
    });
  });

  it('generates only for the resolved project scope', async () => {
    mockedResolveProjectRootPath.mockResolvedValue('/repos/app/');
    const client = graphClientWith([]);
    mockedGetGraphClient.mockResolvedValue(client as never);

    const response = await statsRoutes.request('/api/embeddings/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'project-1' }),
    });

    expect(response.status).toBe(200);
    expect(scheduleEmbeddingPass).toHaveBeenCalledWith({
      client,
      force: false,
      projectId: 'project-1',
      rootPath: '/repos/app',
    });
    expect(await response.json()).toEqual({
      scope: { type: 'project', projectId: 'project-1', rootPath: '/repos/app' },
      embedded: 2,
      skipped: 1,
      errors: 0,
      durationMs: 250,
      byType: { File: 2 },
      message: 'Embedded 2 nodes in 0.3s (1 skipped, 0 errors)',
    });
  });

  it('rejects a non-string projectId before graph access', async () => {
    const response = await statsRoutes.request('/api/embeddings/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 42 }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'projectId must be a non-empty string.' });
    expect(mockedGetGraphClient).not.toHaveBeenCalled();
    expect(scheduleEmbeddingPass).not.toHaveBeenCalled();
  });

  it('runs the dedicated embedding profile migration endpoint', async () => {
    const client = graphClientWith([]);
    mockedGetGraphClient.mockResolvedValue(client as never);

    const response = await statsRoutes.request('/api/embeddings/migrate', {
      method: 'POST',
    });

    expect(response.status).toBe(200);
    expect(migrateEmbeddingProfile).toHaveBeenCalledWith({ client });
    expect(await response.json()).toEqual({
      embedded: 2,
      skipped: 0,
      errors: 0,
      durationMs: 300,
      byType: { Function: 2 },
      profile: embeddingSetup.profile,
      message: 'Migrated embedding profile and embedded 2 nodes in 0.3s',
    });
  });

  it('keeps the prior force-generate action as a migration compatibility path', async () => {
    const client = graphClientWith([]);
    mockedGetGraphClient.mockResolvedValue(client as never);
    getSetupStatus.mockResolvedValueOnce({
      ...setupStatus,
      embedding: {
        ...embeddingSetup,
        migration: {
          required: true,
          code: 'EMBEDDING_PROFILE_MISMATCH',
          storedProfile: { provider: 'none', model: null, dimension: 0 },
          requestedProfile: embeddingSetup.profile,
          remedy: 'Run an explicit re-embed migration or a full reindex before using the requested embedding profile.',
          allowedActions: ['re-embed', 'full-reindex'],
        },
      },
    });

    const response = await statsRoutes.request('/api/embeddings/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });

    expect(response.status).toBe(200);
    expect(migrateEmbeddingProfile).toHaveBeenCalledWith({ client });
    expect(scheduleEmbeddingPass).not.toHaveBeenCalled();
  });
});
