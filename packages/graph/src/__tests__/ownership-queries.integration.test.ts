import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { createClient, type GraphClient } from '../client';
import { resolveEmbeddedBinaryPaths } from '../drivers/falkordblite';
import { createOwnershipQuery } from '../ownership-queries';

const describeIfAvailable = resolveEmbeddedBinaryPaths() ? describe : describe.skip;

describeIfAvailable('ownership query with FalkorDBLite', () => {
  let client: GraphClient;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp('/tmp/cg-ownership-');
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: 'ownership_integration',
    });

    await client.query(`
      CREATE (project:Project {
        id: 'project-repo', rootPath: '/repo', name: 'repo',
        gitHistoryTotalCommits: 5, gitHistorySince: '2024-01-01T00:00:00.000Z',
        gitHistoryMaxCommits: 200, gitHistoryWindowSize: 200,
        gitHistoryTruncated: false, gitHistoryComplete: true
      })
      CREATE (a:File {id: 'file-a', filePath: '/repo/src/a.ts', name: 'a.ts'})
      CREATE (b:File {id: 'file-b', filePath: '/repo/src/b.ts', name: 'b.ts'})
      CREATE (outside:File {id: 'file-outside', filePath: '/repo/test/outside.ts', name: 'outside.ts'})
      CREATE (project)-[:HAS_FILE]->(a)
      CREATE (project)-[:HAS_FILE]->(b)
      CREATE (project)-[:HAS_FILE]->(outside)

      CREATE (c1:Commit {hash: 'c1', date: '2025-01-01T00:00:00Z', author: 'Alex', email: 'alex@example.com'})
      CREATE (c2:Commit {hash: 'c2', date: '2025-01-02T00:00:00Z', author: 'Alex', email: 'alex@example.com'})
      CREATE (c3:Commit {hash: 'c3', date: '2025-01-03T00:00:00Z', author: 'Alex Alias', email: 'alex@example.com'})
      CREATE (c4:Commit {hash: 'c4', date: '2025-01-04T00:00:00Z', author: 'Bea', email: 'bea@example.com'})
      CREATE (c5:Commit {hash: 'c5', date: '2025-01-05T00:00:00Z'})
      CREATE (a)-[:MODIFIED_IN]->(c1)
      CREATE (a)-[:MODIFIED_IN]->(c2)
      CREATE (a)-[:MODIFIED_IN]->(c3)
      CREATE (a)-[:MODIFIED_IN]->(c4)
      CREATE (b)-[:MODIFIED_IN]->(c1)
      CREATE (b)-[:MODIFIED_IN]->(c5)
      CREATE (outside)-[:MODIFIED_IN]->(c5)
    `, { params: {} });
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  }, 30_000);

  it('groups exact author identities and computes percentages within a path prefix', async () => {
    const result = await createOwnershipQuery(client)({
      rootPath: '/repo',
      pathPrefix: 'src',
      limit: 10,
    });

    expect(result.items.map((item) => [item.filePath, item.commitCount])).toEqual([
      ['/repo/src/a.ts', 4],
      ['/repo/src/b.ts', 2],
    ]);
    expect(result.items[0]?.contributors).toEqual([
      { authorName: 'Alex', authorEmail: 'alex@example.com', commitCount: 2, sharePercentage: 50 },
      { authorName: 'Alex Alias', authorEmail: 'alex@example.com', commitCount: 1, sharePercentage: 25 },
      { authorName: 'Bea', authorEmail: 'bea@example.com', commitCount: 1, sharePercentage: 25 },
    ]);
    expect(result.items[1]?.contributors).toEqual([
      { authorName: 'Alex', authorEmail: 'alex@example.com', commitCount: 1, sharePercentage: 50 },
    ]);
    expect(result.unknownIdentityCommitCount).toBe(1);
    expect(result.historyCoverage).toMatchObject({
      commitCount: 5,
      earliestCommitDate: '2025-01-01T00:00:00Z',
      latestCommitDate: '2025-01-05T00:00:00Z',
      totalCommitCount: 5,
      historySince: '2024-01-01T00:00:00.000Z',
      historyMaxCommits: 200,
      historyWindowSize: 200,
      historyTruncated: false,
      historyComplete: true,
    });
  });
});
