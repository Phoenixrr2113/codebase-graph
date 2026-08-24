import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveProjectRootPath: vi.fn(),
  getBlastRadius: vi.fn(),
  getImportCycles: vi.fn(),
  getCallHierarchy: vi.fn(),
  getUnreferencedExports: vi.fn(),
  getHotspots: vi.fn(),
  getChangeCoupling: vi.fn(),
  getOwnership: vi.fn(),
}));

vi.mock('@codegraph/core', () => {
  class AnalysisQueryInputError extends Error {
    readonly code = 'INVALID_ANALYSIS_INPUT';
  }

  return {
    AnalysisQueryInputError,
    codeGraphService: mocks,
  };
});

import { AnalysisQueryInputError } from '@codegraph/core';
import { analysisRoutes } from '../routes/analysis';

const SYMBOL_ID = `sym:v1:${'a'.repeat(64)}`;

async function request(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await analysisRoutes.request(path);
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

describe('analysis routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveProjectRootPath.mockResolvedValue('/repo/project');
    for (const method of [
      mocks.getBlastRadius,
      mocks.getImportCycles,
      mocks.getCallHierarchy,
      mocks.getUnreferencedExports,
      mocks.getHotspots,
      mocks.getChangeCoupling,
      mocks.getOwnership,
    ]) {
      method.mockResolvedValue({
        caveats: ['Static analysis is incomplete.'],
        truncated: false,
        historyCoverage: null,
      });
    }
  });

  it('maps blast radius to the persisted symbol service contract', async () => {
    const result = await request(
      `/api/analysis/blast-radius?id=${encodeURIComponent(SYMBOL_ID)}&depth=4&limit=25`,
    );

    expect(result.status).toBe(200);
    expect(mocks.getBlastRadius).toHaveBeenCalledWith({ id: SYMBOL_ID, depth: 4, limit: 25 });
    expect(result.body).toMatchObject({
      caveats: ['Static analysis is incomplete.'],
      truncated: false,
      historyCoverage: null,
    });
  });

  it('preserves a typed symbol not-found result with HTTP 404', async () => {
    mocks.getBlastRadius.mockResolvedValue({
      status: 'not_found',
      input: { id: SYMBOL_ID, depth: 3, limit: 100 },
      projectRoot: null,
      target: null,
      items: [],
      maxDepth: 3,
      countsByDepth: {},
      countsByNodeType: {},
      truncated: false,
      caveats: ['Static analysis is incomplete.'],
    });

    const result = await request(
      `/api/analysis/blast-radius?id=${encodeURIComponent(SYMBOL_ID)}`,
    );

    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({
      status: 'not_found',
      truncated: false,
      caveats: ['Static analysis is incomplete.'],
    });
  });

  it.each([
    ['/api/analysis/blast-radius', 'id parameter is required'],
    ['/api/analysis/blast-radius?id=not-persisted', 'id must be a persisted sym:v1 identifier'],
  ])('rejects an invalid blast radius identity before service access', async (path, error) => {
    const result = await request(path);

    expect(result).toEqual({ status: 400, body: { error } });
    expect(mocks.getBlastRadius).not.toHaveBeenCalled();
  });

  it.each(['0', '-1', '1.5', '11', 'NaN', 'Infinity'])(
    'rejects blast radius depth=%s with 400',
    async (depth) => {
      const result = await request(
        `/api/analysis/blast-radius?id=${encodeURIComponent(SYMBOL_ID)}&depth=${depth}`,
      );

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('depth must be an integer between 1 and 10');
      expect(mocks.getBlastRadius).not.toHaveBeenCalled();
    },
  );

  it.each(['0', '-1', '1.5', '1001', 'NaN', 'Infinity'])(
    'rejects result limit=%s with 400',
    async (limit) => {
      const result = await request(
        `/api/analysis/call-hierarchy?id=${encodeURIComponent(SYMBOL_ID)}&limit=${limit}`,
      );

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('limit must be an integer between 1 and 1000');
      expect(mocks.getCallHierarchy).not.toHaveBeenCalled();
    },
  );

  it('rejects an invalid call hierarchy direction with 400', async () => {
    const result = await request(
      `/api/analysis/call-hierarchy?id=${encodeURIComponent(SYMBOL_ID)}&direction=sideways`,
    );

    expect(result).toEqual({
      status: 400,
      body: { error: 'direction must be one of: callers, callees, both' },
    });
    expect(mocks.getCallHierarchy).not.toHaveBeenCalled();
  });

  it('maps call hierarchy to the symbol service contract', async () => {
    const result = await request(
      `/api/analysis/call-hierarchy?id=${encodeURIComponent(SYMBOL_ID)}&direction=callers&limit=40`,
    );

    expect(result.status).toBe(200);
    expect(mocks.getCallHierarchy).toHaveBeenCalledWith({
      id: SYMBOL_ID,
      direction: 'callers',
      limit: 40,
    });
  });

  it.each([
    '/api/analysis/import-cycles',
    '/api/analysis/dead-code',
    '/api/analysis/hotspots',
    '/api/analysis/change-coupling',
    '/api/analysis/ownership',
  ])('requires projectId for project-wide route %s', async (path) => {
    const result = await request(path);

    expect(result).toEqual({
      status: 400,
      body: { error: 'projectId parameter is required' },
    });
    expect(mocks.resolveProjectRootPath).not.toHaveBeenCalled();
  });

  it('returns 404 when the project cannot be resolved', async () => {
    mocks.resolveProjectRootPath.mockResolvedValue(undefined);

    const result = await request('/api/analysis/import-cycles?projectId=missing');

    expect(result).toEqual({ status: 404, body: { error: 'Project not found' } });
    expect(mocks.getImportCycles).not.toHaveBeenCalled();
  });

  it('returns 404 for ownership when the project cannot be resolved', async () => {
    mocks.resolveProjectRootPath.mockResolvedValue(undefined);

    const result = await request('/api/analysis/ownership?projectId=missing');

    expect(result).toEqual({ status: 404, body: { error: 'Project not found' } });
    expect(mocks.getOwnership).not.toHaveBeenCalled();
  });

  it.each(['1', '26', '1.5', 'NaN', 'Infinity'])(
    'rejects import cycle maxDepth=%s with 400',
    async (maxDepth) => {
      const result = await request(
        `/api/analysis/import-cycles?projectId=project&maxDepth=${maxDepth}`,
      );

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('maxDepth must be an integer between 2 and 25');
      expect(mocks.resolveProjectRootPath).not.toHaveBeenCalled();
      expect(mocks.getImportCycles).not.toHaveBeenCalled();
    },
  );

  it('normalizes the resolved root and does not widen it to a sibling prefix', async () => {
    mocks.resolveProjectRootPath.mockResolvedValue('/repo/project/');

    const result = await request(
      '/api/analysis/import-cycles?projectId=project&maxDepth=8&limit=30',
    );

    expect(result.status).toBe(200);
    expect(mocks.getImportCycles).toHaveBeenCalledWith({
      rootPath: '/repo/project',
      maxDepth: 8,
      limit: 30,
    });
    expect(mocks.getImportCycles).not.toHaveBeenCalledWith(
      expect.objectContaining({ rootPath: '/repo/project-extra' }),
    );
  });

  it('rejects repository analysis limits above the group 1 bound', async () => {
    const result = await request('/api/analysis/import-cycles?projectId=project&limit=501');

    expect(result).toEqual({
      status: 400,
      body: { error: 'limit must be an integer between 1 and 500' },
    });
    expect(mocks.resolveProjectRootPath).not.toHaveBeenCalled();
  });

  it('maps dead code to unreferenced exports without renaming the response', async () => {
    const result = await request('/api/analysis/dead-code?projectId=project&limit=50');

    expect(result.status).toBe(200);
    expect(mocks.getUnreferencedExports).toHaveBeenCalledWith({
      rootPath: '/repo/project',
      limit: 50,
    });
  });

  it.each(['yesterday', '2026-13-40', '2026-08-21T25:00:00Z'])(
    'rejects invalid since=%s with 400',
    async (since) => {
      const result = await request(
        `/api/analysis/hotspots?projectId=project&since=${encodeURIComponent(since)}`,
      );

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('since must be a valid ISO 8601 date or timestamp');
      expect(mocks.resolveProjectRootPath).not.toHaveBeenCalled();
      expect(mocks.getHotspots).not.toHaveBeenCalled();
    },
  );

  it.each([
    '2026-02-30T00:00:00Z',
    '2026-04-31T12:00:00Z',
    '2025-02-29T00:00:00Z',
  ])('rejects impossible ownership since=%s with 400', async (since) => {
    const result = await request(
      `/api/analysis/ownership?projectId=project&since=${encodeURIComponent(since)}`,
    );

    expect(result).toEqual({
      status: 400,
      body: { error: 'since must be a valid ISO 8601 date or timestamp' },
    });
    expect(mocks.resolveProjectRootPath).not.toHaveBeenCalled();
    expect(mocks.getOwnership).not.toHaveBeenCalled();
  });

  it('accepts a valid ownership leap-day timestamp', async () => {
    const result = await request(
      '/api/analysis/ownership?projectId=project&since=2024-02-29T00%3A00%3A00Z',
    );

    expect(result.status).toBe(200);
    expect(mocks.getOwnership).toHaveBeenCalledWith({
      rootPath: '/repo/project',
      since: '2024-02-29T00:00:00Z',
    });
  });

  it('rejects an invalid hotspot scoreBy with 400', async () => {
    const result = await request('/api/analysis/hotspots?projectId=project&scoreBy=magic');

    expect(result).toEqual({
      status: 400,
      body: { error: 'scoreBy must be one of: complexity, degree' },
    });
    expect(mocks.getHotspots).not.toHaveBeenCalled();
  });

  it('maps hotspot history inputs and surfaces coverage metadata', async () => {
    mocks.getHotspots.mockResolvedValue({
      rootPath: '/repo/project',
      since: '2026-01-01',
      scoreBy: 'degree',
      items: [],
      caveats: ['Within indexed history only.'],
      truncated: false,
      historyCoverage: {
        commitCount: 8,
        earliestCommitDate: '2026-01-01T00:00:00.000Z',
        latestCommitDate: '2026-08-01T00:00:00.000Z',
        totalCommitCount: 8,
        historyWindowSize: 200,
        historyTruncated: false,
        historyComplete: true,
      },
    });

    const result = await request(
      '/api/analysis/hotspots?projectId=project&since=2026-01-01&scoreBy=degree&limit=12',
    );

    expect(result.status).toBe(200);
    expect(mocks.getHotspots).toHaveBeenCalledWith({
      rootPath: '/repo/project',
      since: '2026-01-01',
      scoreBy: 'degree',
      limit: 12,
    });
    expect(result.body.historyCoverage).toMatchObject({
      commitCount: 8,
      totalCommitCount: 8,
      historyWindowSize: 200,
      historyTruncated: false,
      historyComplete: true,
    });
    expect(result.body.caveats).toEqual(['Within indexed history only.']);
  });

  it.each(['0', '1.5', '201', 'NaN', 'Infinity'])(
    'rejects change coupling minSupport=%s with 400',
    async (minSupport) => {
      const result = await request(
        `/api/analysis/change-coupling?projectId=project&minSupport=${minSupport}`,
      );

      expect(result.status).toBe(400);
      expect(result.body.error).toBe('minSupport must be an integer between 1 and 200');
      expect(mocks.resolveProjectRootPath).not.toHaveBeenCalled();
      expect(mocks.getChangeCoupling).not.toHaveBeenCalled();
    },
  );

  it('maps change coupling to the project-wide service contract', async () => {
    const result = await request(
      '/api/analysis/change-coupling?projectId=project&since=2026-01-01&minSupport=3&limit=15',
    );

    expect(result.status).toBe(200);
    expect(mocks.getChangeCoupling).toHaveBeenCalledWith({
      rootPath: '/repo/project',
      since: '2026-01-01',
      minSupport: 3,
      limit: 15,
    });
  });

  it('maps ownership filters and passes through coverage and caveats', async () => {
    mocks.getOwnership.mockResolvedValue({
      input: {
        rootPath: '/repo/project',
        since: '2026-01-01T00:00:00.000Z',
        pathPrefix: '/repo/project/src/features',
        limit: 12,
      },
      projectRoot: '/repo/project',
      items: [],
      truncated: false,
      unknownIdentityCommitCount: 0,
      historyCoverage: {
        commitCount: 8,
        earliestCommitDate: '2026-01-01T00:00:00.000Z',
        latestCommitDate: '2026-08-01T00:00:00.000Z',
        totalCommitCount: 8,
        historySince: null,
        historyMaxCommits: 200,
        historyWindowSize: 200,
        historyTruncated: false,
        historyComplete: true,
      },
      caveats: ['Ownership is inferred from authorship.'],
    });

    const result = await request(
      '/api/analysis/ownership?projectId=project&since=2026-01-01&pathPrefix=src%5Cfeatures&limit=12',
    );

    expect(result.status).toBe(200);
    expect(mocks.getOwnership).toHaveBeenCalledWith({
      rootPath: '/repo/project',
      since: '2026-01-01',
      pathPrefix: 'src/features',
      limit: 12,
    });
    expect(result.body.historyCoverage).toMatchObject({
      historyMaxCommits: 200,
      historyWindowSize: 200,
      historyComplete: true,
    });
    expect(result.body.caveats).toEqual(['Ownership is inferred from authorship.']);
  });

  it.each(['yesterday', '2026-13-40', '2026-08-21T25:00:00Z'])(
    'rejects ownership since=%s before service access',
    async (since) => {
      const result = await request(
        `/api/analysis/ownership?projectId=project&since=${encodeURIComponent(since)}`,
      );

      expect(result).toEqual({
        status: 400,
        body: { error: 'since must be a valid ISO 8601 date or timestamp' },
      });
      expect(mocks.resolveProjectRootPath).not.toHaveBeenCalled();
      expect(mocks.getOwnership).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['/absolute', 'pathPrefix must be project-relative'],
    ['src/../secret', 'pathPrefix must not contain .. traversal segments'],
    ['C:\\secret', 'pathPrefix must be project-relative'],
  ])('rejects ownership pathPrefix %s with 400', async (pathPrefix, error) => {
    const result = await request(
      `/api/analysis/ownership?projectId=project&pathPrefix=${encodeURIComponent(pathPrefix)}`,
    );

    expect(result).toEqual({ status: 400, body: { error } });
    expect(mocks.getOwnership).not.toHaveBeenCalled();
  });

  it.each(['0', '1.5', '501', 'NaN', 'Infinity'])(
    'rejects ownership limit=%s with 400',
    async (limit) => {
      const result = await request(`/api/analysis/ownership?projectId=project&limit=${limit}`);

      expect(result).toEqual({
        status: 400,
        body: { error: 'limit must be an integer between 1 and 500' },
      });
      expect(mocks.resolveProjectRootPath).not.toHaveBeenCalled();
      expect(mocks.getOwnership).not.toHaveBeenCalled();
    },
  );

  it('sanitizes ownership service errors at the REST boundary', async () => {
    mocks.getOwnership.mockRejectedValue(
      new Error('MATCH (secret) token=abc123 failed at /private/repo'),
    );

    const result = await request('/api/analysis/ownership?projectId=project');

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'Failed to analyze ownership.' });
    expect(JSON.stringify(result.body)).not.toContain('MATCH');
    expect(JSON.stringify(result.body)).not.toContain('abc123');
  });

  it('sanitizes service errors at the REST boundary', async () => {
    mocks.getBlastRadius.mockRejectedValue(
      new Error('MATCH (secret) token=abc123 failed at /private/repo'),
    );

    const result = await request(
      `/api/analysis/blast-radius?id=${encodeURIComponent(SYMBOL_ID)}`,
    );

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: 'Failed to analyze blast radius.' });
    expect(JSON.stringify(result.body)).not.toContain('MATCH');
    expect(JSON.stringify(result.body)).not.toContain('abc123');
  });

  it('preserves typed analysis input errors as 400 responses', async () => {
    mocks.getHotspots.mockRejectedValue(
      new AnalysisQueryInputError('since must be a valid ISO 8601 date'),
    );

    const result = await request('/api/analysis/hotspots?projectId=project');

    expect(result).toEqual({
      status: 400,
      body: { error: 'since must be a valid ISO 8601 date' },
    });
  });
});
