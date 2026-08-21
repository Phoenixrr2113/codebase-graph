/**
 * codebase persona (packages/mcp-server/src/personas/codebase.ts) `profile`
 * action tests.
 *
 * Guards against the phantom-property bug: the `profile` action's Cypher
 * queried `f.path` and `f.language` on File nodes, neither of which exists.
 * File nodes only carry `filePath` and `extension` (see
 * packages/graph/src/schema.ts `fileToNodeProps` and
 * packages/graph/src/operations.ts `UPSERT_FILE`), so those filters and
 * projections silently returned nothing instead of erroring.
 *
 * `@codegraph/core` is mocked so this never touches a real graph.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@codegraph/core', () => ({
  codeGraphService: { getGraphStats: vi.fn() },
  getGraphClient: vi.fn(),
  readSourceFile: vi.fn(),
}));

import { codeGraphService, getGraphClient } from '@codegraph/core';
import { handleIndex } from '../personas/codebase';

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

const mockGetGraphStats = vi.mocked(codeGraphService.getGraphStats);
const mockGetGraphClient = vi.mocked(getGraphClient);

function makeRoQuery() {
  return vi.fn().mockImplementation(async (cypher: string) => {
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
  });
}

describe('codebase persona: profile action', () => {
  let roQuery: ReturnType<typeof makeRoQuery>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGraphStats.mockResolvedValue({
      totalNodes: 2310,
      totalEdges: 5500,
      nodesByType: { File: 142 },
      edgesByType: {},
      largestFiles: [],
      mostConnected: [],
    } as never);
    roQuery = makeRoQuery();
    mockGetGraphClient.mockResolvedValue({ roQuery } as never);
  });

  it('returns stats, static, and dynamic sections', async () => {
    const result = (await handleIndex({ action: 'profile', projectPath: '/test' })) as {
      stats: { nodes: number; edges: number; files: number };
      static: { languages: Array<{ name: string; fileCount: number }> };
      dynamic: { recentFiles: Array<{ filePath: string; lastModified: string }> };
    };
    expect(result.stats.nodes).toBe(2310);
    expect(result.static).toBeDefined();
    expect(result.dynamic).toBeDefined();
  });

  it('maps the extension-grouped languages query to display names', async () => {
    const result = (await handleIndex({ action: 'profile', projectPath: '/test' })) as {
      static: { languages: Array<{ name: string; fileCount: number }> };
    };
    expect(result.static.languages[0]?.name).toBe('TypeScript');
    expect(result.static.languages[0]?.fileCount).toBe(98);
  });

  it('populates recentFiles with the real filePath property and string lastModified', async () => {
    const result = (await handleIndex({ action: 'profile', projectPath: '/test' })) as {
      dynamic: { recentFiles: Array<{ filePath: string; lastModified: string }> };
    };
    expect(result.dynamic.recentFiles[0]?.filePath).toBe('/src/x.ts');
    expect(result.dynamic.recentFiles[0]?.lastModified).toBe('2026-08-01T00:00:00.000Z');
  });

  it('never references phantom File properties (f.path, f.language) in generated Cypher', async () => {
    await handleIndex({ action: 'profile', projectPath: '/test' });
    for (const [cypher] of roQuery.mock.calls as [string, unknown][]) {
      for (const phantom of PHANTOM_FILE_PROPERTIES) {
        expect(cypher).not.toContain(phantom);
      }
    }
  });

  it('every f.<prop> reference in File-scoped queries is a real File node property', async () => {
    await handleIndex({ action: 'profile', projectPath: '/test' });
    for (const [cypher] of roQuery.mock.calls as [string, unknown][]) {
      if (!cypher.includes('(f:File)')) continue;
      const refs = cypher.match(/\bf\.(\w+)/g) ?? [];
      for (const ref of refs) {
        const prop = ref.slice(2);
        expect(REAL_FILE_PROPERTIES).toContain(prop);
      }
    }
  });
});

describe('codebase persona: profile action projectPath boundary safety', () => {
  let roQuery: ReturnType<typeof makeRoQuery>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetGraphStats.mockResolvedValue({
      totalNodes: 2310,
      totalEdges: 5500,
      nodesByType: { File: 142 },
      edgesByType: {},
      largestFiles: [],
      mostConnected: [],
    } as never);
    roQuery = makeRoQuery();
    mockGetGraphClient.mockResolvedValue({ roQuery } as never);
  });

  it('rejects a relative projectPath instead of returning a silently empty profile', async () => {
    const result = (await handleIndex({ action: 'profile', projectPath: 'relative/path' })) as {
      error?: string;
    };
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/absolute/i);
  });

  it('never touches the graph when projectPath is relative', async () => {
    await handleIndex({ action: 'profile', projectPath: 'relative/path' });
    expect(mockGetGraphClient).not.toHaveBeenCalled();
    expect(mockGetGraphStats).not.toHaveBeenCalled();
  });

  it('accepts an absolute projectPath', async () => {
    const result = (await handleIndex({ action: 'profile', projectPath: '/tmp/x/project' })) as {
      error?: string;
      stats?: unknown;
    };
    expect(result.error).toBeUndefined();
    expect(result.stats).toBeDefined();
  });

  it('normalizes a trailing slash before building the filter params', async () => {
    await handleIndex({ action: 'profile', projectPath: '/tmp/x/project/' });
    const fileCall = roQuery.mock.calls.find(([cypher]) => (cypher as string).includes('(f:File)'));
    expect(fileCall).toBeDefined();
    const [, options] = fileCall as [string, { params: Record<string, unknown> }];
    expect(options.params['projectPath']).toBe('/tmp/x/project');
    expect(options.params['projectPathPrefix']).toBe('/tmp/x/project/');
  });

  it('the generated filter cannot match a sibling directory sharing the same prefix', async () => {
    await handleIndex({ action: 'profile', projectPath: '/tmp/x/project' });
    const fileCall = roQuery.mock.calls.find(([cypher]) => (cypher as string).includes('(f:File)'));
    expect(fileCall).toBeDefined();
    const [, options] = fileCall as [string, { params: Record<string, unknown> }];
    const params = options.params;

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
