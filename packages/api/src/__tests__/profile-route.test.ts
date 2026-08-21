/**
 * Route-level coverage for GET /api/profile's projectPath boundary safety.
 *
 * getProfile()'s own tests (profile.test.ts) prove the filter and validation
 * logic in isolation. This file proves the Hono route actually wires that
 * validation in: a relative projectPath must come back as a 400 with a
 * plain-text error, and must never reach the graph. A pure-function test of
 * validateProjectPath alone cannot see that wiring bug; only calling the
 * route can (same reasoning as search-route.test.ts).
 *
 * `@codegraph/core` is mocked so this never touches a real graph.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@codegraph/core', () => ({
  codeGraphService: { getGraphStats: vi.fn() },
  getGraphClient: vi.fn(),
}));

import { codeGraphService, getGraphClient } from '@codegraph/core';
import { profileRoutes } from '../routes/profile';

const mockedGetGraphStats = vi.mocked(codeGraphService.getGraphStats);
const mockedGetGraphClient = vi.mocked(getGraphClient);

describe('GET /api/profile: boundary validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 for a relative projectPath and never touches the graph', async () => {
    const res = await profileRoutes.request('/api/profile?projectPath=relative/path');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/absolute/i);
    expect(mockedGetGraphClient).not.toHaveBeenCalled();
  });

  it('returns 200 for an absolute projectPath', async () => {
    mockedGetGraphStats.mockResolvedValue({
      totalNodes: 1,
      totalEdges: 0,
      nodesByType: { File: 1 },
      edgesByType: {},
      largestFiles: [],
      mostConnected: [],
    } as never);
    mockedGetGraphClient.mockResolvedValue({
      roQuery: vi.fn().mockResolvedValue({ data: [], metadata: [] }),
    } as never);

    const res = await profileRoutes.request('/api/profile?projectPath=/abs/path');
    expect(res.status).toBe(200);
  });

  it.each(['0', '-1', '1.5', 'Infinity', '1001'])(
    'returns 400 for invalid limit %s and never touches the graph',
    async (limit) => {
      const res = await profileRoutes.request(`/api/profile?limit=${encodeURIComponent(limit)}`);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('limit must be an integer between 1 and 1000');
      expect(mockedGetGraphClient).not.toHaveBeenCalled();
    },
  );
});
