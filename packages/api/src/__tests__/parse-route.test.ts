import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  indexProject: vi.fn(),
}));

vi.mock('@codegraph/core', () => ({
  indexProject: mocks.indexProject,
}));

import { parseRoutes } from '../routes/parse';

async function post(body: Record<string, unknown>): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await parseRoutes.request('/api/parse/project', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

describe('POST /api/parse/project history window', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.indexProject.mockResolvedValue({
      success: true,
      projectId: 'project',
      projectName: 'repo',
      stats: { files: 1, entities: 1, edges: 0, errors: 0, durationMs: 1 },
      errorMessages: [],
    });
  });

  it('rejects a missing path before indexing', async () => {
    expect(await post({})).toEqual({ status: 400, body: { error: 'path field is required' } });
    expect(mocks.indexProject).not.toHaveBeenCalled();
  });

  it.each([
    '2026-02-30',
    '2026-02-30T00:00:00Z',
    '2026-04-31T12:00:00Z',
    '2025-02-29T00:00:00Z',
    '2026-01-01T00:00:00',
    'not-a-date',
  ])(
    'rejects invalid historySince %s before indexing',
    async (historySince) => {
      const result = await post({ path: '/repo', historySince });
      expect(result).toEqual({
        status: 400,
        body: { error: 'historySince must be a valid ISO 8601 date or timestamp' },
      });
      expect(mocks.indexProject).not.toHaveBeenCalled();
    },
  );

  it.each([0, -1, 1.5, 100_001, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid historyMaxCommits %s before indexing',
    async (historyMaxCommits) => {
      const result = await post({ path: '/repo', historyMaxCommits });
      expect(result).toEqual({
        status: 400,
        body: { error: 'historyMaxCommits must be a safe integer between 1 and 100000' },
      });
      expect(mocks.indexProject).not.toHaveBeenCalled();
    },
  );

  it('forwards the exact optional history window', async () => {
    const result = await post({
      path: '/repo',
      historySince: '2025-01-01T00:00:00Z',
      historyMaxCommits: 2500,
    });

    expect(result.status).toBe(200);
    expect(mocks.indexProject).toHaveBeenCalledWith('/repo', {
      historySince: '2025-01-01T00:00:00Z',
      historyMaxCommits: 2500,
    });
  });

  it('accepts a valid leap-day history timestamp', async () => {
    const result = await post({ path: '/repo', historySince: '2024-02-29T00:00:00Z' });

    expect(result.status).toBe(200);
    expect(mocks.indexProject).toHaveBeenCalledWith('/repo', {
      historySince: '2024-02-29T00:00:00Z',
    });
  });
});
