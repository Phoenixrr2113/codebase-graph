import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { createClient, type GraphClient } from '../client';
import { createQueries, type GraphQueries } from '../queries';
import { resolveEmbeddedBinaryPaths } from '../drivers/falkordblite';

const describeIfAvailable = resolveEmbeddedBinaryPaths() ? describe : describe.skip;

describeIfAvailable('File subgraph Commit identity', () => {
  let client: GraphClient;
  let queries: GraphQueries;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp('/tmp/cg-fc-');
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: 'file_subgraph_commit_identity',
    });
    queries = createQueries(client);
  }, 30_000);

  afterAll(async () => {
    await client?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  }, 15_000);

  it('uses the persisted Commit hash for a contained symbol history relationship', async () => {
    const filePath = '/repo/history.ts';
    const symbolId = 'sym:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const commitHash = '4915f38093c05dbafb5f780e18a5979b0d779c2e';
    await client.query(`
      CREATE (file:File {filePath: $filePath, name: 'history.ts'})
      CREATE (symbol:Interface {id: $symbolId, name: 'HistoryCoverage', filePath: $filePath, startLine: 1})
      CREATE (commit:Commit {
        hash: $commitHash,
        message: 'Add history coverage',
        author: 'Randy Wilson',
        email: 'author@example.com',
        date: '2026-08-23T20:20:56-04:00'
      })
      CREATE (file)-[:CONTAINS]->(symbol)
      CREATE (symbol)-[:INTRODUCED_IN]->(commit)
    `, { params: { filePath, symbolId, commitHash } });

    const result = await queries.getFileSubgraph(filePath);

    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: `Commit:${commitHash}`,
        label: 'Commit',
        displayName: commitHash,
      }),
    ]));
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: symbolId,
        target: `Commit:${commitHash}`,
        label: 'INTRODUCED_IN',
      }),
    ]));
  });

  it('surfaces a hashless Commit without discarding the identifiable file subgraph', async () => {
    const filePath = '/repo/malformed-history.ts';
    const symbolId = 'sym:v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    await client.query(`
      CREATE (file:File {filePath: $filePath, name: 'malformed-history.ts'})
      CREATE (symbol:Interface {id: $symbolId, name: 'MalformedHistory', filePath: $filePath, startLine: 1})
      CREATE (commit:Commit {message: 'Missing hash'})
      CREATE (file)-[:CONTAINS]->(symbol)
      CREATE (symbol)-[:INTRODUCED_IN]->(commit)
    `, { params: { filePath, symbolId } });

    const result = await queries.getFileSubgraph(filePath) as Awaited<
      ReturnType<GraphQueries['getFileSubgraph']>
    > & {
      identityErrors?: Array<{ labels: string[]; edgeType: string; message: string }>;
    };

    expect(result.nodes.map((node) => node.id)).toEqual([
      `File:${filePath}`,
      symbolId,
    ]);
    expect(new Set(result.edges.map((edge) => edge.label))).toEqual(new Set(['CONTAINS']));
    expect(result.identityErrors).toEqual([{
      labels: ['Commit'],
      edgeType: 'INTRODUCED_IN',
      message: 'Graph node is missing a persisted id',
    }]);
  });

  it('preserves a related TypeRef persisted id and runtime label', async () => {
    const filePath = '/repo/type-ref.ts';
    const symbolId = 'sym:v1:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
    const typeRefId = 'prim::typescript::string';
    await client.query(`
      CREATE (file:File {filePath: $filePath, name: 'type-ref.ts'})
      CREATE (symbol:Function {id: $symbolId, name: 'usesString', filePath: $filePath, startLine: 1})
      CREATE (typeRef:TypeRef {id: $typeRefId, name: 'string', language: 'typescript', isPrimitive: true})
      CREATE (file)-[:CONTAINS]->(symbol)
      CREATE (symbol)-[:USES_TYPE]->(typeRef)
    `, { params: { filePath, symbolId, typeRefId } });

    const result = await queries.getFileSubgraph(filePath);

    expect(result.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: typeRefId,
        label: 'TypeRef',
        displayName: 'string',
      }),
    ]));
    expect(result.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: symbolId,
        target: typeRefId,
        label: 'USES_TYPE',
      }),
    ]));
  });
});
