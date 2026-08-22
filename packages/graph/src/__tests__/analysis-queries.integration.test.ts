import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { createClient, type GraphClient } from '../client';
import { createAnalysisQueries, type AnalysisQueries } from '../analysis-queries';
import { resolveEmbeddedBinaryPaths } from '../drivers/falkordblite';

const describeIfAvailable = resolveEmbeddedBinaryPaths() ? describe : describe.skip;

describeIfAvailable('analysis queries with FalkorDBLite', () => {
  let client: GraphClient;
  let queries: AnalysisQueries;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp('/tmp/cg-a1-');
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: 'analysis_integration',
    });
    queries = createAnalysisQueries(client);

    await client.query(`
      CREATE (project:Project {id: 'project-repo', rootPath: '/repo', name: 'repo', gitHistoryTotalCommits: 3, gitHistoryWindowSize: 200, gitHistoryTruncated: false, gitHistoryComplete: true})
      CREATE (siblingProject:Project {id: 'project-sibling', rootPath: '/repo2', name: 'repo2'})

      CREATE (targetFile:File {id: 'file-target', filePath: '/repo/target.ts', name: 'target.ts'})
      CREATE (callerFile:File {id: 'file-caller', filePath: '/repo/caller.ts', name: 'caller.ts'})
      CREATE (a:File {id: 'file-a', filePath: '/repo/a.ts', name: 'a.ts'})
      CREATE (b:File {id: 'file-b', filePath: '/repo/b.ts', name: 'b.ts'})
      CREATE (c:File {id: 'file-c', filePath: '/repo/c.ts', name: 'c.ts'})
      CREATE (selfImport:File {id: 'file-self', filePath: '/repo/self.ts', name: 'self.ts'})
      CREATE (highFile:File {id: 'file-high', filePath: '/repo/high.ts', name: 'high.ts'})
      CREATE (lowFile:File {id: 'file-low', filePath: '/repo/low.ts', name: 'low.ts'})
      CREATE (importerFile:File {id: 'file-importer', filePath: '/repo/importer.ts', name: 'importer.ts'})
      CREATE (siblingA:File {id: 'file-sibling-a', filePath: '/repo2/a.ts', name: 'a.ts'})
      CREATE (siblingB:File {id: 'file-sibling-b', filePath: '/repo2/b.ts', name: 'b.ts'})
      CREATE (externalA:File:External {id: 'external-a', filePath: 'external:a', name: 'external-a'})
      CREATE (externalB:File:External {id: 'external-b', filePath: 'external:b', name: 'external-b'})

      CREATE (target:Function {id: 'target-id', name: 'sharedName', filePath: '/repo/target.ts', startLine: 2, complexity: 2})
      CREATE (directCaller:Variable {id: 'direct-caller-id', name: 'directCaller', filePath: '/repo/caller.ts', startLine: 9})
      CREATE (transitiveCaller:Function {id: 'transitive-caller-id', name: 'transitiveCaller', filePath: '/repo/caller.ts', startLine: 15, complexity: 1})
      CREATE (callee:Function {id: 'callee-id', name: 'callee', filePath: '/repo/target.ts', startLine: 20, complexity: 1})
      CREATE (sameName:Function {id: 'other-target-id', name: 'sharedName', filePath: '/repo2/a.ts', startLine: 2, complexity: 10})
      CREATE (wrongCaller:Function {id: 'wrong-caller-id', name: 'wrongCaller', filePath: '/repo2/a.ts', startLine: 5, complexity: 1})
      CREATE (aFunction:Function {id: 'a-function', name: 'aFunction', filePath: '/repo/a.ts', startLine: 1, complexity: 4})
      CREATE (bFunction:Function {id: 'b-function', name: 'bFunction', filePath: '/repo/b.ts', startLine: 1, complexity: 1})
      CREATE (highExport:Function {id: 'high-export', name: 'highExport', filePath: '/repo/high.ts', startLine: 1})
      CREATE (lowExport:Class {id: 'low-export', name: 'LowExport', filePath: '/repo/low.ts', startLine: 1})
      CREATE (siblingExport:Function {id: 'sibling-export', name: 'siblingExport', filePath: '/repo2/b.ts', startLine: 1})

      CREATE (project)-[:HAS_FILE]->(targetFile)
      CREATE (project)-[:HAS_FILE]->(callerFile)
      CREATE (project)-[:HAS_FILE]->(a)
      CREATE (project)-[:HAS_FILE]->(b)
      CREATE (project)-[:HAS_FILE]->(c)
      CREATE (project)-[:HAS_FILE]->(selfImport)
      CREATE (project)-[:HAS_FILE]->(highFile)
      CREATE (project)-[:HAS_FILE]->(lowFile)
      CREATE (project)-[:HAS_FILE]->(importerFile)
      CREATE (siblingProject)-[:HAS_FILE]->(siblingA)
      CREATE (siblingProject)-[:HAS_FILE]->(siblingB)

      CREATE (targetFile)-[:CONTAINS]->(target)
      CREATE (targetFile)-[:CONTAINS]->(callee)
      CREATE (callerFile)-[:CONTAINS]->(directCaller)
      CREATE (callerFile)-[:CONTAINS]->(transitiveCaller)
      CREATE (a)-[:CONTAINS]->(aFunction)
      CREATE (b)-[:CONTAINS]->(bFunction)
      CREATE (highFile)-[:CONTAINS]->(highExport)
      CREATE (lowFile)-[:CONTAINS]->(lowExport)
      CREATE (siblingA)-[:CONTAINS]->(sameName)
      CREATE (siblingA)-[:CONTAINS]->(wrongCaller)
      CREATE (siblingB)-[:CONTAINS]->(siblingExport)

      CREATE (directCaller)-[:CALLS {line: 10, count: 2, via: 'closure'}]->(target)
      CREATE (transitiveCaller)-[:CALLS {line: 16, count: 1, via: 'direct'}]->(directCaller)
      CREATE (target)-[:CALLS {line: 4, count: 1, via: 'direct'}]->(callee)
      CREATE (wrongCaller)-[:CALLS {line: 6, count: 1, via: 'direct'}]->(sameName)
      CREATE (wrongCaller)-[:CALLS {line: 7, count: 1, via: 'direct'}]->(target)
      CREATE (sameName)-[:CALLS {line: 3, count: 1, via: 'direct'}]->(wrongCaller)

      CREATE (a)-[:IMPORTS]->(b)
      CREATE (b)-[:IMPORTS]->(c)
      CREATE (c)-[:IMPORTS]->(a)
      CREATE (selfImport)-[:IMPORTS]->(selfImport)
      CREATE (externalA)-[:IMPORTS]->(externalB)
      CREATE (externalB)-[:IMPORTS]->(externalA)
      CREATE (importerFile)-[:IMPORTS]->(lowFile)
      CREATE (siblingA)-[:IMPORTS]->(siblingB)
      CREATE (siblingB)-[:IMPORTS]->(siblingA)

      CREATE (highFile)-[:EXPORTS]->(highExport)
      CREATE (lowFile)-[:EXPORTS]->(lowExport)
      CREATE (siblingB)-[:EXPORTS]->(siblingExport)

      CREATE (commit1:Commit {hash: 'c1', date: '2025-01-01T00:00:00Z'})
      CREATE (commit2:Commit {hash: 'c2', date: '2025-01-02T00:00:00Z'})
      CREATE (commit3:Commit {hash: 'c3', date: '2025-01-03T00:00:00Z'})
      CREATE (a)-[:MODIFIED_IN {linesAdded: 5, linesRemoved: 1}]->(commit1)
      CREATE (a)-[:MODIFIED_IN {linesAdded: 3, linesRemoved: 2}]->(commit2)
      CREATE (a)-[:MODIFIED_IN {linesAdded: 4, linesRemoved: 0}]->(commit3)
      CREATE (b)-[:MODIFIED_IN {linesAdded: 2, linesRemoved: 1}]->(commit1)
      CREATE (b)-[:MODIFIED_IN {linesAdded: 1, linesRemoved: 1}]->(commit2)
      CREATE (siblingA)-[:MODIFIED_IN {linesAdded: 100, linesRemoved: 100}]->(commit1)
      CREATE (siblingB)-[:MODIFIED_IN {linesAdded: 100, linesRemoved: 100}]->(commit1)
    `, { params: {} });
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  }, 30_000);

  it('finds the bounded blast-radius closure by persisted symbol id', async () => {
    const result = await queries.getBlastRadius({ id: 'target-id', depth: 2, limit: 10 });

    expect(result.status).toBe('ok');
    expect(result.projectRoot).toBe('/repo');
    expect(result.items.map((item) => [item.id, item.depth])).toEqual([
      ['direct-caller-id', 1],
      ['transitive-caller-id', 2],
    ]);
    expect(result.items.some((item) => item.id === 'wrong-caller-id')).toBe(false);
  });

  it('canonicalizes one internal import cycle and excludes External and sibling cycles', async () => {
    const result = await queries.getImportCycles({ rootPath: '/repo', maxDepth: 6, limit: 10 });

    expect(result.cycles).toEqual([
      { filePaths: ['/repo/self.ts'], length: 1 },
      { filePaths: ['/repo/a.ts', '/repo/b.ts', '/repo/c.ts'], length: 3 },
    ]);
  });

  it('returns separate callers and callees with closure metadata', async () => {
    const result = await queries.getCallHierarchy({ id: 'target-id', direction: 'both', limit: 10 });

    expect(result.status).toBe('ok');
    expect(result.callers).toEqual([
      expect.objectContaining({ id: 'direct-caller-id', nodeType: 'Variable', via: 'closure', callLine: 10, count: 2 }),
    ]);
    expect(result.callees).toEqual([
      expect.objectContaining({ id: 'callee-id', via: 'direct', callLine: 4 }),
    ]);
  });

  it('returns unreferenced candidates and lowers confidence for file import evidence', async () => {
    const result = await queries.getUnreferencedExports({ rootPath: '/repo', limit: 10 });
    const byId = new Map(result.items.map((item) => [item.id, item]));

    expect(byId.get('high-export')?.confidence).toBe('higher');
    expect(byId.get('low-export')).toMatchObject({ confidence: 'lower', fileImporterCount: 1 });
    expect(byId.has('sibling-export')).toBe(false);
  });

  it('computes scoped hotspots from MODIFIED_IN counts and current complexity', async () => {
    const result = await queries.getHotspots({ rootPath: '/repo', scoreBy: 'complexity', limit: 10 });

    expect(result.items[0]).toMatchObject({
      filePath: '/repo/a.ts', changeCount: 3, churn: 15, complexity: 4, complexityScore: 15,
    });
    expect(result.items.some((item) => item.filePath.startsWith('/repo2/'))).toBe(false);
    expect(result.historyCoverage).toMatchObject({
      commitCount: 3,
      earliestCommitDate: '2025-01-01T00:00:00Z',
      latestCommitDate: '2025-01-03T00:00:00Z',
      totalCommitCount: 3,
      historyWindowSize: 200,
      historyTruncated: false,
      historyComplete: true,
    });
    expect(result.caveats.some((caveat) => caveat.includes('200'))).toBe(false);
  });

  it('computes bounded change coupling without sibling-root pairs', async () => {
    const result = await queries.getChangeCoupling({ rootPath: '/repo', minSupport: 2, limit: 10 });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      leftFile: '/repo/a.ts', rightFile: '/repo/b.ts', coChanges: 2, aChanges: 3, bChanges: 2,
    });
    expect(result.items[0]!.jaccard).toBeCloseTo(2 / 3, 12);
  });

  it('returns empty lists and zero history coverage for an empty project scope', async () => {
    const cycles = await queries.getImportCycles({ rootPath: '/empty', limit: 10 });
    const hotspots = await queries.getHotspots({ rootPath: '/empty', limit: 10 });
    const coupling = await queries.getChangeCoupling({ rootPath: '/empty', limit: 10 });

    expect(cycles.cycles).toEqual([]);
    expect(hotspots.items).toEqual([]);
    expect(hotspots.historyCoverage.commitCount).toBe(0);
    expect(coupling.items).toEqual([]);
    expect(coupling.historyCoverage.commitCount).toBe(0);
  });
});
