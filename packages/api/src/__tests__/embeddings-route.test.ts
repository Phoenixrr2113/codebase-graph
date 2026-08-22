import { beforeEach, describe, expect, it, vi } from 'vitest';

const { scheduleEmbeddingPass, getEmbeddingPassState } = vi.hoisted(() => ({
  scheduleEmbeddingPass: vi.fn(),
  getEmbeddingPassState: vi.fn(),
}));

vi.mock('@codegraph/core', () => ({
  codeGraphService: {
    resolveProjectRootPath: vi.fn(),
  },
  getGraphClient: vi.fn(),
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

function graphClientWith(rows: Array<{ label: string; total: number; withEmbedding: number }>) {
  return {
    roQuery: vi.fn().mockResolvedValue({ data: rows, metadata: [] }),
  };
}

describe('embedding routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEmbeddingPassState.mockReturnValue(idlePass);
    scheduleEmbeddingPass.mockResolvedValue({
      embedded: 2,
      skipped: 1,
      errors: 0,
      durationMs: 250,
      byType: { File: 2 },
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
      labels: [{ label: 'File', total: 4, withEmbedding: 3, coverage: 75 }],
    });
    expect(client.roQuery).toHaveBeenCalledWith(
      expect.not.stringContaining('$projectPath'),
      { params: {} },
    );
    expect(getEmbeddingPassState).toHaveBeenCalledWith(undefined);
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
});
