import { describe, expect, it, vi } from 'vitest';
import type { GraphClient } from '../client';
import { createAnalysisQueries } from '../analysis-queries';

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

function mockClient(rows: unknown[]): GraphClient {
  return {
    graph: null,
    graphName: 'analysis-test',
    dialect,
    roQuery: vi.fn().mockResolvedValue({ data: rows, metadata: [] }),
    query: vi.fn(),
    ensureIndexes: vi.fn(),
    close: vi.fn(),
  } as unknown as GraphClient;
}

describe('analysis queries', () => {
  it('publishes the analysis factory from the graph package entry point', async () => {
    const graphPackage = await import('../index');
    expect(graphPackage.createAnalysisQueries).toBe(createAnalysisQueries);
  });

  describe('getBlastRadius', () => {
    it('clamps bounds, keeps hostile ids parameterized, and reports normalized inputs', async () => {
      const hostileId = "sym:v1:x' MATCH (n) DETACH DELETE n //";
      const client = mockClient([
        {
          targetId: hostileId,
          targetName: 'target',
          targetNodeType: 'Function',
          targetFilePath: '/repo/src/target.ts',
          targetStartLine: 4,
          projectRoot: '/repo',
          id: 'sym:v1:caller',
          name: 'caller',
          nodeType: 'Function',
          filePath: '/repo/src/caller.ts',
          startLine: 8,
          depth: 1,
        },
      ]);

      const result = await createAnalysisQueries(client).getBlastRadius({
        id: hostileId,
        depth: 0,
        limit: 5_000,
      });

      const [cypher, options] = vi.mocked(client.roQuery).mock.calls[0]!;
      expect(cypher).toContain('*1..1');
      expect(cypher).not.toContain(hostileId);
      expect(options?.params).toEqual({ id: hostileId, rowLimit: 1_001 });
      expect(result.input).toEqual({ id: hostileId, depth: 1, limit: 1_000 });
      expect(result.projectRoot).toBe('/repo');
      expect(result.truncated).toBe(false);
      expect(result.countsByDepth).toEqual({ 1: 1 });
      expect(result.countsByNodeType).toEqual({ Function: 1 });
    });

    it('returns a typed not-found result instead of an empty success', async () => {
      const result = await createAnalysisQueries(mockClient([])).getBlastRadius({ id: 'missing' });

      expect(result.status).toBe('not_found');
      expect(result.items).toEqual([]);
      expect(result.caveats.length).toBeGreaterThan(0);
    });
  });

  describe('getImportCycles', () => {
    it('canonicalizes rotations, scopes sibling-safe paths, and truncates after deduplication', async () => {
      const client = mockClient([
        { filePaths: ['/repo/b.ts', '/repo/c.ts', '/repo/a.ts', '/repo/b.ts'], length: 3 },
        { filePaths: ['/repo/a.ts', '/repo/b.ts', '/repo/c.ts', '/repo/a.ts'], length: 3 },
        { filePaths: ['/repo/z.ts', '/repo/y.ts', '/repo/z.ts'], length: 2 },
      ]);

      const result = await createAnalysisQueries(client).getImportCycles({
        rootPath: '/repo///',
        maxDepth: 1,
        limit: 1,
      });

      const [cypher, options] = vi.mocked(client.roQuery).mock.calls[0]!;
      expect(cypher).toContain('*1..2');
      expect(cypher).toContain("NOT 'External' IN labels(n)");
      expect(cypher).toContain('n.filePath = $rootPath OR n.filePath STARTS WITH $rootPathPrefix');
      expect(options?.params).toEqual({
        rootPath: '/repo',
        rootPathPrefix: '/repo/',
        candidateRowLimit: 101,
      });
      expect(result.input).toEqual({ rootPath: '/repo', maxDepth: 2, limit: 1 });
      expect(result.projectRoot).toBe('/repo');
      expect(result.cycles).toEqual([
        { filePaths: ['/repo/y.ts', '/repo/z.ts'], length: 2 },
      ]);
      expect(result.truncated).toBe(true);
      expect(result.candidateLimitReached).toBe(false);
    });

    it('reports candidate saturation separately from public result truncation', async () => {
      const repeated = {
        filePaths: ['/repo/a.ts', '/repo/b.ts', '/repo/a.ts'],
        length: 2,
      };
      const client = mockClient(Array.from({ length: 101 }, () => repeated));

      const result = await createAnalysisQueries(client).getImportCycles({
        rootPath: '/repo',
        limit: 1,
      });

      expect(result.cycles).toHaveLength(1);
      expect(result.truncated).toBe(false);
      expect(result.candidateLimitReached).toBe(true);
      expect(result.candidateLimit).toBe(100);
    });
  });

  describe('getCallHierarchy', () => {
    it('runs separate bounded direction queries and preserves closure metadata', async () => {
      const client = mockClient([]);
      vi.mocked(client.roQuery)
        .mockResolvedValueOnce({
          data: [{
            centerId: 'target-id', centerName: 'target', centerNodeType: 'Function',
            centerFilePath: '/repo/target.ts', centerStartLine: 2, projectRoot: '/repo',
            id: 'caller-id', name: 'caller', nodeType: 'Variable', filePath: '/repo/caller.ts',
            startLine: 9, callLine: 10, count: 2, via: 'closure',
          }],
          metadata: [],
        })
        .mockResolvedValueOnce({
          data: [{
            centerId: 'target-id', centerName: 'target', centerNodeType: 'Function',
            centerFilePath: '/repo/target.ts', centerStartLine: 2, projectRoot: '/repo',
            id: 'callee-id', name: 'callee', nodeType: 'Function', filePath: '/repo/callee.ts',
            startLine: 15, callLine: 4, count: 1, via: 'direct',
          }],
          metadata: [],
        });

      const result = await createAnalysisQueries(client).getCallHierarchy({
        id: 'target-id',
        direction: 'both',
        limit: 0,
      });

      expect(client.roQuery).toHaveBeenCalledTimes(2);
      const [callersCypher, callersOptions] = vi.mocked(client.roQuery).mock.calls[0]!;
      const [calleesCypher, calleesOptions] = vi.mocked(client.roQuery).mock.calls[1]!;
      expect(callersCypher).toContain('(neighbor)-[r:CALLS]->(center)');
      expect(calleesCypher).toContain('(center)-[r:CALLS]->(neighbor)');
      expect(callersOptions?.params).toEqual({ id: 'target-id', rowLimit: 2 });
      expect(calleesOptions?.params).toEqual({ id: 'target-id', rowLimit: 2 });
      expect(result.input).toEqual({ id: 'target-id', direction: 'both', limit: 1 });
      expect(result.callers[0]).toMatchObject({ nodeType: 'Variable', via: 'closure', count: 2 });
      expect(result.callees[0]).toMatchObject({ id: 'callee-id', via: 'direct' });
      expect(result.callersTruncated).toBe(false);
      expect(result.calleesTruncated).toBe(false);
    });
  });

  describe('getUnreferencedExports', () => {
    it('uses boundary-safe parameterized scope and preserves confidence evidence', async () => {
      const rootPath = "/repo/o'hare/";
      const client = mockClient([
        {
          id: 'unused-id', name: 'unused', nodeType: 'Function',
          filePath: "/repo/o'hare/src/a.ts", startLine: 3,
          fileImporterCount: 1, confidence: 'lower',
        },
        {
          id: 'other-id', name: 'other', nodeType: 'Class',
          filePath: "/repo/o'hare/src/b.ts", startLine: 7,
          fileImporterCount: 0, confidence: 'higher',
        },
      ]);

      const result = await createAnalysisQueries(client).getUnreferencedExports({
        rootPath,
        limit: 1,
      });

      const [cypher, options] = vi.mocked(client.roQuery).mock.calls[0]!;
      expect(cypher).not.toContain("o'hare");
      expect(cypher).toContain('f.filePath = $rootPath OR f.filePath STARTS WITH $rootPathPrefix');
      expect(cypher).toContain('IMPORTS_SYMBOL|CALLS|USES_TYPE|EXTENDS|IMPLEMENTS|RENDERS');
      expect(options?.params).toEqual({
        rootPath: "/repo/o'hare",
        rootPathPrefix: "/repo/o'hare/",
        rowLimit: 2,
      });
      expect(result.items).toEqual([
        expect.objectContaining({ id: 'unused-id', fileImporterCount: 1, confidence: 'lower' }),
      ]);
      expect(result.truncated).toBe(true);
      expect(result.projectRoot).toBe("/repo/o'hare");
      expect(result.caveats.join(' ')).toContain('candidates');
    });
  });

  describe('getHotspots', () => {
    it('returns transparent scores, normalized history inputs, and scoped coverage', async () => {
      const client = mockClient([]);
      vi.mocked(client.roQuery)
        .mockResolvedValueOnce({
          data: [
            {
              filePath: '/repo/a.ts', changeCount: 3, churn: 20, complexity: 4,
              importDegree: 2, complexityScore: 15, degreeScore: 9,
            },
            {
              filePath: '/repo/b.ts', changeCount: 2, churn: 10, complexity: 1,
              importDegree: 3, complexityScore: 4, degreeScore: 8,
            },
          ],
          metadata: [],
        })
        .mockResolvedValueOnce({
          data: [{
            commitCount: 3,
            earliestCommitDate: '2025-01-02T00:00:00Z',
            latestCommitDate: '2025-02-01T00:00:00Z',
            totalCommitCount: 3,
            historyWindowSize: 200,
            historyTruncated: false,
            historyComplete: true,
          }],
          metadata: [],
        });

      const result = await createAnalysisQueries(client).getHotspots({
        rootPath: '/repo/',
        since: '2025-01-01T00:00:00-05:00',
        scoreBy: 'degree',
        limit: 0,
      });

      expect(client.roQuery).toHaveBeenCalledTimes(2);
      const [resultCypher, resultOptions] = vi.mocked(client.roQuery).mock.calls[0]!;
      const [coverageCypher, coverageOptions] = vi.mocked(client.roQuery).mock.calls[1]!;
      expect(resultCypher).toContain('ORDER BY degreeScore DESC');
      expect(resultCypher).toContain('LIMIT $rowLimit');
      expect(coverageCypher).toContain('count(DISTINCT c) AS commitCount');
      expect(resultOptions?.params).toEqual({
        rootPath: '/repo', rootPathPrefix: '/repo/',
        since: '2025-01-01T05:00:00.000Z', rowLimit: 2,
      });
      expect(coverageOptions?.params).toEqual({
        rootPath: '/repo', rootPathPrefix: '/repo/', since: '2025-01-01T05:00:00.000Z',
      });
      expect(result.input).toEqual({
        rootPath: '/repo', since: '2025-01-01T05:00:00.000Z', scoreBy: 'degree', limit: 1,
      });
      expect(result.items[0]).toMatchObject({ filePath: '/repo/a.ts', complexityScore: 15, degreeScore: 9, score: 9 });
      expect(result.truncated).toBe(true);
      expect(result.historyCoverage).toEqual({
        commitCount: 3,
        earliestCommitDate: '2025-01-02T00:00:00Z',
        latestCommitDate: '2025-02-01T00:00:00Z',
        totalCommitCount: 3,
        historyWindowSize: 200,
        historyTruncated: false,
        historyComplete: true,
      });
      expect(result.caveats.some((caveat) => caveat.includes('200'))).toBe(false);
    });
  });

  describe('getChangeCoupling', () => {
    it('bounds pair results and includes indexed-history coverage', async () => {
      const client = mockClient([]);
      vi.mocked(client.roQuery)
        .mockResolvedValueOnce({
          data: [
            { filePath: '/repo/a.ts' },
            { filePath: '/repo/b.ts' },
          ],
          metadata: [],
        })
        .mockResolvedValueOnce({
          data: [
            { leftFile: '/repo/a.ts', rightFile: '/repo/b.ts', coChanges: 3, aChanges: 4, bChanges: 5, jaccard: 0.5 },
            { leftFile: '/repo/a.ts', rightFile: '/repo/c.ts', coChanges: 2, aChanges: 4, bChanges: 4, jaccard: 1 / 3 },
          ],
          metadata: [],
        })
        .mockResolvedValueOnce({
          data: [{
            commitCount: 200,
            earliestCommitDate: '2025-01-01T00:00:00Z',
            latestCommitDate: '2025-07-19T00:00:00Z',
            totalCommitCount: 240,
            historyWindowSize: 200,
            historyTruncated: true,
            historyComplete: false,
          }],
          metadata: [],
        });

      const result = await createAnalysisQueries(client).getChangeCoupling({
        rootPath: '/repo',
        minSupport: 500,
        limit: 0,
      });

      expect(client.roQuery).toHaveBeenCalledTimes(3);
      const [candidateCypher, candidateOptions] = vi.mocked(client.roQuery).mock.calls[0]!;
      const [pairCypher, pairOptions] = vi.mocked(client.roQuery).mock.calls[1]!;
      expect(candidateCypher).toContain('LIMIT $candidateRowLimit');
      expect(candidateOptions?.params).toEqual({
        rootPath: '/repo', rootPathPrefix: '/repo/', since: null, candidateRowLimit: 501,
      });
      expect(pairCypher).toContain('a.filePath < b.filePath');
      expect(pairCypher).toContain('a.filePath IN $candidateFiles');
      expect(pairCypher).toContain('b.filePath IN $candidateFiles');
      expect(pairCypher).toContain('coChanges >= $minSupport');
      expect(pairCypher).toContain('LIMIT $rowLimit');
      expect(pairOptions?.params).toEqual({
        rootPath: '/repo', rootPathPrefix: '/repo/', since: null,
        candidateFiles: ['/repo/a.ts', '/repo/b.ts'], minSupport: 200, rowLimit: 2,
      });
      expect(result.input).toEqual({ rootPath: '/repo', since: null, minSupport: 200, limit: 1 });
      expect(result.items).toEqual([
        { leftFile: '/repo/a.ts', rightFile: '/repo/b.ts', coChanges: 3, aChanges: 4, bChanges: 5, jaccard: 0.5 },
      ]);
      expect(result.truncated).toBe(true);
      expect(result.candidateFileLimit).toBe(500);
      expect(result.candidateFileLimitReached).toBe(false);
      expect(result.historyCoverage).toEqual({
        commitCount: 200,
        earliestCommitDate: '2025-01-01T00:00:00Z',
        latestCommitDate: '2025-07-19T00:00:00Z',
        totalCommitCount: 240,
        historyWindowSize: 200,
        historyTruncated: true,
        historyComplete: false,
      });
      expect(result.caveats.join(' ')).toContain('correlation');
      expect(result.caveats.join(' ')).toContain('200');
    });
  });
});
