import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  getBlastRadius: vi.fn(),
  getImportCycles: vi.fn(),
  getCallHierarchy: vi.fn(),
  getUnreferencedExports: vi.fn(),
  getHotspots: vi.fn(),
  getChangeCoupling: vi.fn(),
  getOwnership: vi.fn(),
}));

vi.mock('@codegraph/core', () => ({
  codeGraphService: mocks,
  loadConfig: mocks.loadConfig,
}));

import { analyzePersonaDefinition, handleAnalyze } from '../personas/analyze';

const SYMBOL_ID = `sym:v1:${'a'.repeat(64)}`;

describe('analyze persona', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadConfig.mockResolvedValue({ activeProjects: ['/repo/project'] });
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
        caveats: ['Results describe static relationships.'],
        truncated: false,
        historyCoverage: null,
      });
    }
  });

  it.each([
    ['impact', { id: SYMBOL_ID }, 'getBlastRadius', { id: SYMBOL_ID, depth: 3, limit: 100 }],
    [
      'import_cycles',
      { projectPath: '/repo/project' },
      'getImportCycles',
      { rootPath: '/repo/project', maxDepth: 25, limit: 50 },
    ],
    [
      'call_hierarchy',
      { id: SYMBOL_ID },
      'getCallHierarchy',
      { id: SYMBOL_ID, direction: 'both', limit: 100 },
    ],
    [
      'dead_code',
      { projectPath: '/repo/project' },
      'getUnreferencedExports',
      { rootPath: '/repo/project', limit: 100 },
    ],
    [
      'hotspots',
      { projectPath: '/repo/project' },
      'getHotspots',
      { rootPath: '/repo/project', scoreBy: 'complexity', limit: 50 },
    ],
    [
      'change_coupling',
      { projectPath: '/repo/project' },
      'getChangeCoupling',
      { rootPath: '/repo/project', minSupport: 2, limit: 50 },
    ],
    [
      'ownership',
      { projectPath: '/repo/project' },
      'getOwnership',
      { rootPath: '/repo/project', limit: 50 },
    ],
  ] as const)(
    'maps %s to %s with public defaults',
    async (action, input, methodName, expected) => {
      const result = (await handleAnalyze({ action, ...input })) as Record<string, unknown>;

      expect(mocks[methodName]).toHaveBeenCalledWith(expected);
      expect(result.caveats).toEqual(['Results describe static relationships.']);
      expect(result.truncated).toBe(false);
      expect(result).toHaveProperty('historyCoverage');
      expect(result._meta).toMatchObject({ action, toolUsed: methodName });
    },
  );

  it('forwards explicit impact values', async () => {
    await handleAnalyze({ action: 'impact', id: SYMBOL_ID, depth: 7, limit: 30 });

    expect(mocks.getBlastRadius).toHaveBeenCalledWith({ id: SYMBOL_ID, depth: 7, limit: 30 });
  });

  it('preserves truthful complete-history coverage and caveats', async () => {
    mocks.getOwnership.mockResolvedValue({
      items: [],
      truncated: false,
      unknownIdentityCommitCount: 0,
      historyCoverage: {
        commitCount: 1,
        earliestCommitDate: '2026-03-01T12:00:00Z',
        latestCommitDate: '2026-03-01T12:00:00Z',
        totalCommitCount: 1,
        historySince: null,
        historyMaxCommits: 200,
        historyWindowSize: 200,
        historyTruncated: false,
        historyComplete: true,
      },
      caveats: ['Results cover only the indexed history and the requested filters. Indexed history includes the complete reachable branch history available at the last history sync.'],
    });

    const result = await handleAnalyze({
      action: 'ownership',
      projectPath: '/repo/project',
    }) as Record<string, unknown>;

    expect(result.historyCoverage).toEqual(expect.objectContaining({
      totalCommitCount: 1,
      historyTruncated: false,
      historyComplete: true,
    }));
    expect(result.caveats).toEqual([
      'Results cover only the indexed history and the requested filters. Indexed history includes the complete reachable branch history available at the last history sync.',
    ]);
  });

  it('normalizes and forwards explicit ownership filters', async () => {
    await handleAnalyze({
      action: 'ownership',
      projectPath: '/repo/project/',
      since: '2026-01-01',
      pathPrefix: 'src\\features',
      limit: 12,
    });

    expect(mocks.getOwnership).toHaveBeenCalledWith({
      rootPath: '/repo/project',
      since: '2026-01-01',
      pathPrefix: 'src/features',
      limit: 12,
    });
  });

  it.each([
    '2026-02-30T00:00:00Z',
    '2026-04-31T12:00:00Z',
    '2025-02-29T00:00:00Z',
  ])('rejects impossible ownership since %s before graph access', async (since) => {
    const result = await handleAnalyze({
      action: 'ownership',
      projectPath: '/repo/project',
      since,
    });

    expect(result).toEqual({ error: 'since must be a valid ISO 8601 date or timestamp' });
    expect(mocks.getOwnership).not.toHaveBeenCalled();
  });

  it('accepts a valid ownership leap-day timestamp', async () => {
    await handleAnalyze({
      action: 'ownership',
      projectPath: '/repo/project',
      since: '2024-02-29T00:00:00Z',
    });

    expect(mocks.getOwnership).toHaveBeenCalledWith({
      rootPath: '/repo/project',
      since: '2024-02-29T00:00:00Z',
      limit: 50,
    });
  });

  it.each([
    [{ action: 'impact' }, 'id is required for impact action'],
    [{ action: 'impact', id: 'not-persisted' }, 'id must be a persisted sym:v1 identifier'],
    [{ action: 'impact', id: SYMBOL_ID, depth: 0 }, 'depth must be an integer between 1 and 10'],
    [{ action: 'import_cycles', projectPath: '/repo/project', maxDepth: 1 }, 'maxDepth must be an integer between 2 and 25'],
    [{ action: 'call_hierarchy', id: SYMBOL_ID, direction: 'sideways' }, 'direction must be one of: callers, callees, both'],
    [{ action: 'hotspots', projectPath: '/repo/project', since: 'yesterday' }, 'since must be a valid ISO 8601 date or timestamp'],
    [{ action: 'hotspots', projectPath: '/repo/project', scoreBy: 'magic' }, 'scoreBy must be one of: complexity, degree'],
    [{ action: 'change_coupling', projectPath: '/repo/project', minSupport: 201 }, 'minSupport must be an integer between 1 and 200'],
    [{ action: 'hotspots', projectPath: '/repo/project', limit: 501 }, 'limit must be an integer between 1 and 500'],
    [{ action: 'dead_code', projectPath: '/repo/project', limit: 1001 }, 'limit must be an integer between 1 and 1000'],
    [{ action: 'ownership', projectPath: '/repo/project', pathPrefix: '/absolute' }, 'pathPrefix must be project-relative'],
    [{ action: 'ownership', projectPath: '/repo/project', pathPrefix: 'src/../secret' }, 'pathPrefix must not contain .. traversal segments'],
    [{ action: 'ownership', projectPath: '/repo/project', pathPrefix: 'src', limit: 501 }, 'limit must be an integer between 1 and 500'],
  ])('rejects invalid input before graph access', async (input, error) => {
    const result = await handleAnalyze(input);

    expect(result).toEqual({ error });
    for (const method of [
      mocks.getBlastRadius,
      mocks.getImportCycles,
      mocks.getCallHierarchy,
      mocks.getUnreferencedExports,
      mocks.getHotspots,
      mocks.getChangeCoupling,
      mocks.getOwnership,
    ]) {
      expect(method).not.toHaveBeenCalled();
    }
  });

  it.each(['import_cycles', 'dead_code', 'hotspots', 'change_coupling', 'ownership'])(
    'requires projectPath for %s',
    async (action) => {
      const result = await handleAnalyze({ action });

      expect(result).toEqual({ error: `projectPath is required for ${action} action` });
    },
  );

  it('rejects a relative projectPath', async () => {
    const result = await handleAnalyze({ action: 'dead_code', projectPath: 'relative/project' });

    expect(result).toEqual({ error: 'projectPath must be an absolute path' });
    expect(mocks.getUnreferencedExports).not.toHaveBeenCalled();
  });

  it('rejects a sibling root that only shares the active project prefix', async () => {
    const result = await handleAnalyze({
      action: 'hotspots',
      projectPath: '/repo/project-extra',
    });

    expect(result).toEqual({
      error: 'Path "/repo/project-extra" is outside active project directories',
    });
    expect(mocks.getHotspots).not.toHaveBeenCalled();
  });

  it('normalizes a trailing slash before service access', async () => {
    await handleAnalyze({ action: 'dead_code', projectPath: '/repo/project/' });

    expect(mocks.getUnreferencedExports).toHaveBeenCalledWith({
      rootPath: '/repo/project',
      limit: 100,
    });
  });

  it('returns a stable unknown action error', async () => {
    const result = await handleAnalyze({ action: 'missing' });

    expect(result).toEqual({
      error: 'Unknown analyze action: missing. Use: impact, import_cycles, call_hierarchy, dead_code, hotspots, change_coupling, ownership',
    });
  });

  it('declares ownership pathPrefix in the public schema', () => {
    expect(analyzePersonaDefinition.inputSchema.properties).toHaveProperty('pathPrefix');
    expect(analyzePersonaDefinition.inputSchema.properties.action.enum).toContain('ownership');
  });

  it('declares every example key in the input schema', () => {
    const declaredProperties = new Set(
      Object.keys(analyzePersonaDefinition.inputSchema.properties),
    );
    const exampleBlocks = analyzePersonaDefinition.description.match(/\{[^}]*\}/g) ?? [];
    expect(exampleBlocks.length).toBeGreaterThanOrEqual(6);

    const usedKeys = new Set<string>();
    for (const block of exampleBlocks) {
      const withoutStrings = block.replace(/"[^"]*"/g, '""');
      for (const match of withoutStrings.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) {
        const key = match[1];
        if (key !== undefined) usedKeys.add(key);
      }
    }

    expect([...usedKeys].filter((key) => !declaredProperties.has(key))).toEqual([]);
  });
});
