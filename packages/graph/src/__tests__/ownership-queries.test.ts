import { describe, expect, it, vi } from 'vitest';
import type { GraphClient } from '../client';
import { AnalysisQueryInputError } from '../analysis-queries';
import { createOwnershipQuery } from '../ownership-queries';

const dialect = {
  driverType: 'falkordb',
  labelsExpr: (alias: string): string => `labels(${alias})`,
  firstLabelExpr: (alias: string): string => `labels(${alias})[0]`,
  typeExpr: (alias: string): string => `type(${alias})`,
  labelCheckExpr: (alias: string, label: string): string => `${alias}:${label}`,
  labelCaseExpr: (alias: string, label: string): string => `${alias}:${label}`,
  supportsOnCreateOnMatch: true,
  normalizeNode: (raw: unknown) => ({ labels: [], properties: raw as Record<string, unknown> }),
  normalizeEdge: (raw: unknown) => ({ type: '', properties: raw as Record<string, unknown> }),
};

function mockClient(): GraphClient {
  return {
    graph: null,
    graphName: 'ownership-test',
    dialect,
    roQuery: vi.fn(),
    query: vi.fn(),
    ensureIndexes: vi.fn(),
    close: vi.fn(),
  } as unknown as GraphClient;
}

describe('ownership query', () => {
  it('normalizes scope and bounds the file candidate query with deterministic ordering', async () => {
    const client = mockClient();
    vi.mocked(client.roQuery)
      .mockResolvedValueOnce({
        data: [
          { filePath: '/repo/src/a.ts', commitCount: 4 },
          { filePath: '/repo/src/b.ts', commitCount: 2 },
        ],
        metadata: [],
      })
      .mockResolvedValueOnce({ data: [], metadata: [] })
      .mockResolvedValueOnce({ data: [], metadata: [] })
      .mockResolvedValueOnce({
        data: [{
          commitCount: 4,
          earliestCommitDate: '2025-01-01T00:00:00Z',
          latestCommitDate: '2025-01-04T00:00:00Z',
          totalCommitCount: 9,
          historySince: '2024-01-01T00:00:00.000Z',
          historyMaxCommits: 200,
          historyWindowSize: 200,
          historyTruncated: true,
          historyComplete: false,
          unknownIdentityCommitCount: 0,
        }],
        metadata: [],
      });

    const result = await createOwnershipQuery(client)({
      rootPath: '/repo/',
      since: '2025-01-01T00:00:00-05:00',
      pathPrefix: 'src\\',
      limit: 1,
    });

    const [fileCypher, fileOptions] = vi.mocked(client.roQuery).mock.calls[0]!;
    expect(fileCypher).toContain('count(DISTINCT c) AS commitCount');
    expect(fileCypher).toContain('ORDER BY commitCount DESC, filePath ASC');
    expect(fileCypher).toContain('LIMIT $rowLimit');
    expect(fileOptions?.params).toEqual({
      rootPath: '/repo',
      rootPathPrefix: '/repo/',
      since: '2025-01-01T05:00:00.000Z',
      pathPrefix: '/repo/src',
      pathPrefixWithSeparator: '/repo/src/',
      rowLimit: 2,
    });
    expect(result.input).toEqual({
      rootPath: '/repo',
      since: '2025-01-01T05:00:00.000Z',
      pathPrefix: '/repo/src',
      limit: 1,
    });
    expect(result.items.map((item) => item.filePath)).toEqual(['/repo/src/a.ts']);
    expect(result.truncated).toBe(true);
  });

  it.each([0, 501, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid limit %s before graph access',
    async (limit) => {
      const client = mockClient();

      await expect(createOwnershipQuery(client)({
        rootPath: '/repo',
        limit,
      })).rejects.toBeInstanceOf(AnalysisQueryInputError);
      expect(client.roQuery).not.toHaveBeenCalled();
    },
  );

  it.each([
    '2026-02-30T00:00:00Z',
    '2026-04-31T12:00:00Z',
    '2025-02-29T00:00:00Z',
    '2026-1-1',
  ])('rejects invalid since %s before graph access', async (since) => {
    const client = mockClient();

    await expect(createOwnershipQuery(client)({
      rootPath: '/repo',
      since,
    })).rejects.toBeInstanceOf(AnalysisQueryInputError);
    expect(client.roQuery).not.toHaveBeenCalled();
  });

  it('accepts a valid leap-day timestamp', async () => {
    const client = mockClient();
    vi.mocked(client.roQuery)
      .mockResolvedValueOnce({ data: [], metadata: [] })
      .mockResolvedValueOnce({ data: [], metadata: [] });

    const result = await createOwnershipQuery(client)({
      rootPath: '/repo',
      since: '2024-02-29T00:00:00Z',
    });

    expect(result.input.since).toBe('2024-02-29T00:00:00.000Z');
  });

  it.each([
    '/absolute/path',
    '../outside',
    'src/../outside',
    'C:\\outside',
    '\\\\server\\share',
  ])('rejects invalid project-relative pathPrefix %s before graph access', async (pathPrefix) => {
    const client = mockClient();

    await expect(createOwnershipQuery(client)({
      rootPath: '/repo',
      pathPrefix,
    })).rejects.toBeInstanceOf(AnalysisQueryInputError);
    expect(client.roQuery).not.toHaveBeenCalled();
  });

  it('ranks exact author pairs, rounds shares, truncates contributors, and counts unknown identities', async () => {
    const client = mockClient();
    const contributorRows = [
      { authorName: 'Alex A', authorEmail: 'alex@example.com', commitCount: 3 },
      { authorName: 'Alex Alias', authorEmail: 'alex@example.com', commitCount: 2 },
      { authorName: 'Bea', authorEmail: 'bea@example.com', commitCount: 1 },
      { authorName: 'C1', authorEmail: 'c1@example.com', commitCount: 1 },
      { authorName: 'C2', authorEmail: 'c2@example.com', commitCount: 1 },
      { authorName: 'C3', authorEmail: 'c3@example.com', commitCount: 1 },
      { authorName: 'C4', authorEmail: 'c4@example.com', commitCount: 1 },
      { authorName: 'C5', authorEmail: 'c5@example.com', commitCount: 1 },
      { authorName: 'C6', authorEmail: 'c6@example.com', commitCount: 1 },
      { authorName: 'C7', authorEmail: 'c7@example.com', commitCount: 1 },
      { authorName: 'C8', authorEmail: 'c8@example.com', commitCount: 1 },
    ];
    vi.mocked(client.roQuery)
      .mockResolvedValueOnce({
        data: [{ filePath: '/repo/a.ts', commitCount: 7 }],
        metadata: [],
      })
      .mockResolvedValueOnce({ data: contributorRows, metadata: [] })
      .mockResolvedValueOnce({
        data: [{
          commitCount: 7,
          earliestCommitDate: '2025-01-01T00:00:00Z',
          latestCommitDate: '2025-01-07T00:00:00Z',
          totalCommitCount: 7,
          historySince: null,
          historyMaxCommits: null,
          historyWindowSize: null,
          historyTruncated: false,
          historyComplete: true,
          unknownIdentityCommitCount: 1,
        }],
        metadata: [],
      });

    const result = await createOwnershipQuery(client)({ rootPath: '/repo', limit: 50 });

    const [contributorCypher, contributorOptions] = vi.mocked(client.roQuery).mock.calls[1]!;
    expect(contributorCypher).toContain('c.email AS authorEmail');
    expect(contributorCypher).toContain('c.author AS authorName');
    expect(contributorCypher).toContain('ORDER BY commitCount DESC, authorEmail ASC, authorName ASC');
    expect(contributorOptions?.params).toMatchObject({ filePath: '/repo/a.ts', rowLimit: 11 });
    expect(result.items[0]?.contributors).toEqual([
      { authorName: 'Alex A', authorEmail: 'alex@example.com', commitCount: 3, sharePercentage: 42.86 },
      { authorName: 'Alex Alias', authorEmail: 'alex@example.com', commitCount: 2, sharePercentage: 28.57 },
      { authorName: 'Bea', authorEmail: 'bea@example.com', commitCount: 1, sharePercentage: 14.29 },
      ...contributorRows.slice(3, 10).map((row) => ({ ...row, sharePercentage: 14.29 })),
    ]);
    expect(result.items[0]?.contributorsTruncated).toBe(true);
    expect(result.unknownIdentityCommitCount).toBe(1);
    expect(result.caveats).toContain(
      'Some indexed commits have no usable author identity. Reindex history to backfill them.',
    );
  });

  it('maps complete coverage and omits the unknown-identity caveat when every identity is usable', async () => {
    const client = mockClient();
    vi.mocked(client.roQuery)
      .mockResolvedValueOnce({ data: [], metadata: [] })
      .mockResolvedValueOnce({
        data: [{
          commitCount: 0,
          earliestCommitDate: null,
          latestCommitDate: null,
          totalCommitCount: 0,
          historySince: null,
          historyMaxCommits: 500,
          historyWindowSize: 500,
          historyTruncated: false,
          historyComplete: true,
          unknownIdentityCommitCount: 0,
        }],
        metadata: [],
      });

    const result = await createOwnershipQuery(client)({ rootPath: '/repo' });

    expect(result.historyCoverage).toEqual({
      commitCount: 0,
      earliestCommitDate: null,
      latestCommitDate: null,
      totalCommitCount: 0,
      historySince: null,
      historyMaxCommits: 500,
      historyWindowSize: 500,
      historyTruncated: false,
      historyComplete: true,
    });
    expect(result.caveats).toEqual([
      'Ownership is inferred from authorship in indexed git history, not from CODEOWNERS, review activity, expertise, or current team assignment.',
      'Results cover only the indexed history and the requested filters. Indexed history includes the complete reachable branch history available at the last history sync.',
      'Bot and automation commits are included and can dominate rankings.',
      "Renames and moves can split or undercount a file's history because history edges are attached to indexed File paths.",
      'Author aliases that remain after git mailmap are ranked separately.',
    ]);
  });
});
