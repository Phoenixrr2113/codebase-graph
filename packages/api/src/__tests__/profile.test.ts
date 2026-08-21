import { describe, it, expect, vi } from 'vitest';
import { getProfile, validateProjectPath, type ProfileService } from '../routes/profile';

/**
 * The true File node property set, as upserted by packages/graph/src/schema.ts
 * (fileToNodeProps) and packages/graph/src/operations.ts (UPSERT_FILE,
 * BATCH_UPSERT_FILES, BATCH_CREATE_FILES). File nodes have `filePath` and
 * `extension`, never `path` or `language`, which do not exist on the node.
 */
const REAL_FILE_PROPERTIES = [
  'filePath',
  'name',
  'extension',
  'loc',
  'lastModified',
  'hash',
  'sourcePipeline',
  'sourceTask',
  'processedAt',
];
const PHANTOM_FILE_PROPERTIES = ['f.path', 'f.language'];

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
        if (cypher.includes('f.extension')) {
          return { data: [{ extension: 'ts', fileCount: 98 }] };
        }
        if (cypher.includes('lastModified')) {
          return { data: [{ filePath: '/src/x.ts', lastModified: '2026-08-01T00:00:00.000Z' }] };
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
    expect(profile.dynamic.recentFiles[0]?.lastModified).toBe('2026-08-01T00:00:00.000Z');
  });

  it('maps the extension-grouped languages query to display names', async () => {
    const profile = await getProfile(makeMockService(), { projectPath: '/test' });
    expect(profile.static.languages[0]?.name).toBe('TypeScript');
    expect(profile.static.languages[0]?.fileCount).toBe(98);
  });

  it('never references phantom File properties (f.path, f.language) in generated Cypher', async () => {
    const service = makeMockService();
    await getProfile(service, { projectPath: '/test' });
    const calls = (service.query as ReturnType<typeof vi.fn>).mock.calls;
    for (const [cypher] of calls as [string, unknown][]) {
      for (const phantom of PHANTOM_FILE_PROPERTIES) {
        expect(cypher).not.toContain(phantom);
      }
    }
  });

  it('every f.<prop> reference in File-scoped queries is a real File node property', async () => {
    const service = makeMockService();
    await getProfile(service, { projectPath: '/test' });
    const calls = (service.query as ReturnType<typeof vi.fn>).mock.calls;
    for (const [cypher] of calls as [string, unknown][]) {
      if (!cypher.includes('(f:File)')) continue;
      const refs = cypher.match(/\bf\.(\w+)/g) ?? [];
      for (const ref of refs) {
        const prop = ref.slice(2);
        expect(REAL_FILE_PROPERTIES).toContain(prop);
      }
    }
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

describe('validateProjectPath', () => {
  it('accepts an absolute path', () => {
    expect(validateProjectPath('/abs/path')).toEqual({ valid: true });
  });

  it('accepts undefined (no filter requested)', () => {
    expect(validateProjectPath(undefined)).toEqual({ valid: true });
  });

  it('rejects a relative path', () => {
    const result = validateProjectPath('relative/path');
    expect(result.valid).toBe(false);
  });
});

describe('projectPath boundary safety', () => {
  function makeMockService(overrides?: Partial<ProfileService>): ProfileService {
    return {
      getStats: vi.fn().mockResolvedValue({ nodes: 2310, edges: 5500, files: 142 }),
      query: vi.fn().mockResolvedValue({ data: [] }),
      ...overrides,
    };
  }

  it('rejects a relative projectPath instead of silently returning an empty profile', async () => {
    await expect(
      getProfile(makeMockService(), { projectPath: 'relative/path' }),
    ).rejects.toThrow(/absolute/i);
  });

  it('never calls the service when projectPath is relative', async () => {
    const service = makeMockService();
    await expect(getProfile(service, { projectPath: 'relative/path' })).rejects.toThrow();
    expect(service.getStats).not.toHaveBeenCalled();
    expect(service.query).not.toHaveBeenCalled();
  });

  it('normalizes a trailing slash before building the filter params', async () => {
    const service = makeMockService();
    await getProfile(service, { projectPath: '/tmp/x/project/' });
    const calls = (service.query as ReturnType<typeof vi.fn>).mock.calls;
    const fileCall = calls.find(([cypher]) => (cypher as string).includes('(f:File)'));
    expect(fileCall).toBeDefined();
    const [, params] = fileCall as [string, Record<string, unknown>];
    expect(params['projectPath']).toBe('/tmp/x/project');
    expect(params['projectPathPrefix']).toBe('/tmp/x/project/');
  });

  it('the generated filter cannot match a sibling directory sharing the same prefix', async () => {
    const service = makeMockService();
    await getProfile(service, { projectPath: '/tmp/x/project' });
    const calls = (service.query as ReturnType<typeof vi.fn>).mock.calls;
    const fileCall = calls.find(([cypher]) => (cypher as string).includes('(f:File)'));
    expect(fileCall).toBeDefined();
    const [, params] = fileCall as [string, Record<string, unknown>];

    // Reproduces FalkorDB's `= $projectPath OR STARTS WITH $projectPathPrefix`
    // semantics against the exact params the code built, so this fails if the
    // implementation ever regresses to a plain STARTS WITH.
    const matchesFilter = (filePath: string): boolean =>
      filePath === params['projectPath'] || filePath.startsWith(params['projectPathPrefix'] as string);

    // The leak this guards against: a plain `STARTS WITH "/tmp/x/project"`
    // also matches the unrelated sibling directory "/tmp/x/project-extra".
    expect(matchesFilter('/tmp/x/project-extra/leaked.ts')).toBe(false);
    // A real file inside the project must still match.
    expect(matchesFilter('/tmp/x/project/src/index.ts')).toBe(true);
    // The project root itself must match too.
    expect(matchesFilter('/tmp/x/project')).toBe(true);
  });
});
