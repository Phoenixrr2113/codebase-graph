import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@codegraph/core', () => ({
  codeGraphService: { getProjects: vi.fn() },
}));

import { codeGraphService } from '@codegraph/core';
import { sourceRoutes } from '../routes/source';

const mockedGetProjects = vi.mocked(codeGraphService.getProjects);

describe('GET /api/source: numeric boundary validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['startLine', '0', 'startLine must be an integer between 1 and 1000000'],
    ['startLine', '1.5', 'startLine must be an integer between 1 and 1000000'],
    ['endLine', '-1', 'endLine must be an integer between 0 and 1000000'],
    ['endLine', 'Infinity', 'endLine must be an integer between 0 and 1000000'],
    ['context', '-1', 'context must be an integer between 0 and 1000'],
    ['context', '1001', 'context must be an integer between 0 and 1000'],
  ])('returns 400 for invalid %s=%s before graph access', async (name, value, message) => {
    const query = new URLSearchParams({
      path: '/work/project/src/a.ts',
      [name]: value,
    });

    const res = await sourceRoutes.request(`/api/source?${query.toString()}`);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(message);
    expect(mockedGetProjects).not.toHaveBeenCalled();
  });

  it('returns 400 when endLine precedes startLine', async () => {
    const query = new URLSearchParams({
      path: '/work/project/src/a.ts',
      startLine: '20',
      endLine: '10',
    });

    const res = await sourceRoutes.request(`/api/source?${query.toString()}`);

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('endLine must be 0 or greater than or equal to startLine');
    expect(mockedGetProjects).not.toHaveBeenCalled();
  });
});
