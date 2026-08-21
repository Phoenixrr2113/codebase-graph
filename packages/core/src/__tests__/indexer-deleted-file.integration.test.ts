import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createClient, resolveEmbeddedBinaryPaths, type GraphClient } from '@codegraph/graph';
import { indexProject } from '../indexer';

const describeIfAvailable = resolveEmbeddedBinaryPaths() ? describe : describe.skip;

describeIfAvailable('incremental indexing of deleted files', () => {
  let client: GraphClient;
  let dataDir: string;
  let projectDir: string;
  let callerPath: string;
  let doomedPath: string;
  let previousEmbeddingProvider: string | undefined;

  beforeAll(async () => {
    previousEmbeddingProvider = process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
    process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = 'none';
    dataDir = await mkdtemp(join(tmpdir(), 'cg-deleted-file-db-'));
    projectDir = await mkdtemp(join(tmpdir(), 'cg-deleted-file-project-'));
    callerPath = resolve(projectDir, 'caller.ts');
    doomedPath = resolve(projectDir, 'doomed.ts');

    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: 'deleted_file_incremental',
    } as never);

    await writeFile(doomedPath, 'export function doomed(): number {\n  return 42;\n}\n');
    await writeFile(
      callerPath,
      [
        "import { doomed } from './doomed';",
        '',
        'export function caller(): number {',
        '  return doomed();',
        '}',
        '',
      ].join('\n'),
    );
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (projectDir) await rm(projectDir, { recursive: true, force: true });
    if (previousEmbeddingProvider === undefined) {
      delete process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
    } else {
      process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = previousEmbeddingProvider;
    }
  });

  it('removes a vanished File, its symbol id, and both inbound edge kinds in the same pass', async () => {
    const initial = await indexProject(projectDir, {
      client,
      includePatterns: ['*.ts'],
      embeddings: false,
      gitSync: false,
      force: true,
    });
    expect(initial).toMatchObject({ success: true, errorMessages: [] });

    const targetBefore = await client.roQuery<{ id: string }>(
      `MATCH (target:Function {name: 'doomed', filePath: $doomedPath})
       RETURN target.id AS id`,
      { params: { doomedPath } },
    );
    expect(targetBefore.data).toEqual([{ id: expect.stringMatching(/^sym:v1:[a-f0-9]{64}$/) }]);
    const doomedId = targetBefore.data[0]!.id;

    const inboundBefore = await client.roQuery<{ calls: number; imports: number }>(
      `MATCH (target:Function {id: $doomedId})
       OPTIONAL MATCH (:Function {filePath: $callerPath})-[call:CALLS]->(target)
       OPTIONAL MATCH (:File {filePath: $callerPath})-[imported:IMPORTS_SYMBOL]->(target)
       RETURN count(DISTINCT call) AS calls, count(DISTINCT imported) AS imports`,
      { params: { callerPath, doomedId } },
    );
    expect(inboundBefore.data).toEqual([{ calls: 1, imports: 1 }]);

    await unlink(doomedPath);

    const incremental = await indexProject(projectDir, {
      client,
      includePatterns: ['*.ts'],
      embeddings: false,
      gitSync: false,
      force: false,
    });
    expect(incremental.success).toBe(true);

    const survivors = await client.roQuery<{ files: number; symbols: number; inbound: number }>(
      `OPTIONAL MATCH (file:File {filePath: $doomedPath})
       WITH count(file) AS files
       OPTIONAL MATCH (symbol {id: $doomedId})
       WITH files, count(symbol) AS symbols
       OPTIONAL MATCH ()-[edge:CALLS|IMPORTS_SYMBOL]->(target {id: $doomedId})
       RETURN files, symbols, count(edge) AS inbound`,
      { params: { doomedId, doomedPath } },
    );
    expect(survivors.data).toEqual([{ files: 0, symbols: 0, inbound: 0 }]);

    await unlink(callerPath);
    const emptyIncremental = await indexProject(projectDir, {
      client,
      includePatterns: ['*.ts'],
      embeddings: false,
      gitSync: false,
      force: false,
    });
    expect(emptyIncremental).toMatchObject({ success: true, errorMessages: [] });

    const remainingSourceNodes = await client.roQuery<{ count: number }>(
      `MATCH (node)
       WHERE node.filePath STARTS WITH $projectDir
       RETURN count(node) AS count`,
      { params: { projectDir } },
    );
    expect(remainingSourceNodes.data).toEqual([{ count: 0 }]);
  }, 120_000);
});
