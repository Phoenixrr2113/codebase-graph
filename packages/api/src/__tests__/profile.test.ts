import { describe, it, expect, vi } from 'vitest';
import { getProfile, type ProfileService } from '../routes/profile';

describe('codebase profile', () => {
  function makeMockService(overrides?: Partial<ProfileService>): ProfileService {
    return {
      getStats: vi.fn().mockResolvedValue({ nodes: 2310, edges: 5500, files: 142 }),
      query: vi.fn().mockImplementation(async (cypher: string) => {
        if (cypher.includes('importCount')) {
          return { data: [{ name: 'Logger', importCount: 25 }] };
        }
        if (cypher.includes('callCount')) {
          return { data: [{ name: 'parseProject', callCount: 12 }] };
        }
        if (cypher.includes('f.language')) {
          return { data: [{ name: 'TypeScript', fileCount: 98 }] };
        }
        if (cypher.includes('lastModified')) {
          return { data: [{ filePath: '/src/x.ts', lastModified: Date.now() }] };
        }
        if (cypher.includes('Entity')) {
          return { data: [{ text: 'JWT auth', type: 'Decision', createdAt: Date.now() }] };
        }
        return { data: [] };
      }),
      ...overrides,
    };
  }

  it('returns static + dynamic + stats sections', async () => {
    const profile = await getProfile(makeMockService(), { projectPath: '/test' });

    expect(profile.stats).toBeDefined();
    expect(profile.stats.nodes).toBe(2310);
    expect(profile.stats.edges).toBe(5500);

    expect(profile.static).toBeDefined();
    expect(profile.static.topImports).toBeDefined();
    expect(profile.static.topCallers).toBeDefined();
    expect(profile.static.languages).toBeDefined();

    expect(profile.dynamic).toBeDefined();
    expect(profile.dynamic.recentFiles).toBeDefined();
    expect(profile.dynamic.recentEntities).toBeDefined();
  });

  it('populates topImports from query results', async () => {
    const profile = await getProfile(makeMockService(), { projectPath: '/test' });
    expect(profile.static.topImports[0]?.name).toBe('Logger');
    expect(profile.static.topImports[0]?.importCount).toBe(25);
  });

  it('populates recentFiles from query results', async () => {
    const profile = await getProfile(makeMockService(), { projectPath: '/test' });
    expect(profile.dynamic.recentFiles[0]?.filePath).toBe('/src/x.ts');
  });

  it('is fast — completes in under 200ms when service is mocked', async () => {
    const start = Date.now();
    await getProfile(makeMockService(), { projectPath: '/test' });
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('handles partial query failures gracefully', async () => {
    const service = makeMockService({
      query: vi.fn().mockRejectedValue(new Error('DB unavailable')),
    });
    const profile = await getProfile(service, {});
    // All arrays should fall back to empty on query failure
    expect(profile.static.topImports).toEqual([]);
    expect(profile.static.topCallers).toEqual([]);
    expect(profile.dynamic.recentFiles).toEqual([]);
  });

  it('works without a projectPath (full graph scope)', async () => {
    const profile = await getProfile(makeMockService(), {});
    expect(profile.stats).toBeDefined();
  });

  it('respects limit option', async () => {
    const service = makeMockService();
    await getProfile(service, { limit: 5 });
    const calls = (service.query as ReturnType<typeof vi.fn>).mock.calls;
    // All Cypher queries should include $limit
    for (const [cypher] of calls as [string, unknown][]) {
      expect(cypher).toContain('$limit');
    }
  });
});
