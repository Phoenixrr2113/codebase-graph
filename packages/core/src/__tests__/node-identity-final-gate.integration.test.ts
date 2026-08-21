import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createClient, resolveEmbeddedBinaryPaths, type GraphClient } from '@codegraph/graph';
import { indexProject } from '../indexer';

const describeIfAvailable = resolveEmbeddedBinaryPaths() ? describe : describe.skip;

describeIfAvailable('node identity final integration gate', () => {
  let client: GraphClient;
  let dataDir: string;
  let projectDir: string;
  let fileAPath: string;
  let fileBPath: string;
  let previousEmbeddingProvider: string | undefined;

  beforeAll(async () => {
    previousEmbeddingProvider = process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
    process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = 'none';

    dataDir = await mkdtemp(join(tmpdir(), 'cg-node-identity-final-'));
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: 'node_identity_final_gate',
    } as never);

    projectDir = mkdtempSync(join(tmpdir(), 'cg-node-identity-project-'));
    fileAPath = resolve(projectDir, 'fileA.ts');
    fileBPath = resolve(projectDir, 'fileB.ts');
    writeFileSync(fileAPath, 'export function target(): number {\n  return 42;\n}\n');
    writeFileSync(
      fileBPath,
      [
        "import { target } from './fileA';",
        '',
        'export function caller(): number {',
        '  return target();',
        '}',
        '',
      ].join('\n'),
    );
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    if (previousEmbeddingProvider === undefined) {
      delete process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
    } else {
      process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = previousEmbeddingProvider;
    }
  });

  it('preserves target identity and inbound edges across line shift, then removes the prior generation on force reindex', async () => {
    const initial = await indexProject(projectDir, {
      client,
      includePatterns: ['*.ts'],
      embeddings: false,
      gitSync: false,
      force: true,
    });
    expect(initial.success).toBe(true);

    const before = await client.roQuery<{ id: string; startLine: number }>(
      `MATCH (target:Function {name: 'target', filePath: $fileAPath})
       RETURN target.id AS id, target.startLine AS startLine`,
      { params: { fileAPath } },
    );
    expect(before.data).toEqual([{ id: expect.stringMatching(/^sym:v1:/), startLine: 1 }]);
    const targetId = before.data[0]!.id;

    const inboundBefore = await client.roQuery<{ calls: number; imports: number }>(
      `MATCH (target:Function {id: $targetId})
       OPTIONAL MATCH (:Function {filePath: $fileBPath})-[call:CALLS]->(target)
       OPTIONAL MATCH (:File {filePath: $fileBPath})-[imported:IMPORTS_SYMBOL]->(target)
       RETURN count(DISTINCT call) AS calls, count(DISTINCT imported) AS imports`,
      { params: { targetId, fileBPath } },
    );
    expect(inboundBefore.data).toEqual([{ calls: 1, imports: 1 }]);

    writeFileSync(
      fileAPath,
      [
        '// inserted one',
        '// inserted two',
        '',
        'export function target(): number {',
        '  return 42;',
        '}',
        '',
      ].join('\n'),
    );

    const querySpy = vi.spyOn(client, 'query');
    const incremental = await indexProject(projectDir, {
      client,
      includePatterns: ['*.ts'],
      embeddings: false,
      gitSync: false,
      force: false,
    });
    expect(incremental.success).toBe(true);

    const sweepCall = querySpy.mock.calls.find(([cypher, options]) =>
      cypher.includes('$currentIds') &&
      Array.isArray(options?.params?.['currentIds']) &&
      options.params['currentIds'].includes(targetId),
    );
    expect(sweepCall).toBeDefined();
    querySpy.mockRestore();

    const after = await client.roQuery<{ id: string; startLine: number }>(
      `MATCH (target:Function {name: 'target', filePath: $fileAPath})
       RETURN target.id AS id, target.startLine AS startLine`,
      { params: { fileAPath } },
    );
    expect(after.data).toEqual([{ id: targetId, startLine: 4 }]);

    const inboundAfter = await client.roQuery<{ calls: number; imports: number }>(
      `MATCH (target:Function {id: $targetId})
       OPTIONAL MATCH (:Function {filePath: $fileBPath})-[call:CALLS]->(target)
       OPTIONAL MATCH (:File {filePath: $fileBPath})-[imported:IMPORTS_SYMBOL]->(target)
       RETURN count(DISTINCT call) AS calls, count(DISTINCT imported) AS imports`,
      { params: { targetId, fileBPath } },
    );
    expect(inboundAfter.data).toEqual([{ calls: 1, imports: 1 }]);

    const idIndexes = await client.roQuery<{ label: string; properties: string[] }>(
      `CALL db.indexes()
       YIELD label, properties
       WHERE label IN ['Function', 'Class', 'Interface', 'Variable', 'Type', 'Component', 'Method']
         AND 'id' IN properties
       RETURN label, properties`,
    );
    expect(new Set(idIndexes.data.map((row) => row.label))).toEqual(
      new Set(['Function', 'Class', 'Interface', 'Variable', 'Type', 'Component']),
    );

    const oldGeneration = 'node-identity-final-gate-prior';
    const staleId = 'sym:v1:stale-final-gate';
    await client.query(
      `MATCH (n {projectId: $projectId})
       SET n.indexGeneration = $oldGeneration
       WITH count(n) AS stamped
       CREATE (:Function {
         id: $staleId,
         name: 'removedTarget',
         filePath: $fileAPath,
         startLine: 999,
         projectId: $projectId,
         indexGeneration: $oldGeneration
       })
       RETURN stamped`,
      { params: { projectId: initial.projectId, oldGeneration, staleId, fileAPath } },
    );

    const forced = await indexProject(projectDir, {
      client,
      includePatterns: ['*.ts'],
      embeddings: false,
      gitSync: false,
      force: true,
    });
    expect(forced.success).toBe(true);
    expect(forced.projectId).toBe(initial.projectId);

    const detached = await client.roQuery<{ detachedSymbols: number }>(
      `MATCH (n)
       WHERE n.projectId = $projectId
         AND (n:Function OR n:Class OR n:Interface OR n:Variable OR n:Type OR n:Component)
       OPTIONAL MATCH (f:File)-[:CONTAINS]->(n)
       WITH n, f
       WHERE f IS NULL
       RETURN count(n) AS detachedSymbols`,
      { params: { projectId: initial.projectId } },
    );
    const duplicates = await client.roQuery<{ label: string; id: string; copies: number }>(
      `MATCH (n)
       WHERE n.projectId = $projectId
         AND (n:Function OR n:Class OR n:Interface OR n:Variable OR n:Type OR n:Component)
       WITH labels(n)[0] AS label, n.id AS id, count(*) AS copies
       WHERE copies > 1
       RETURN label, id, copies`,
      { params: { projectId: initial.projectId } },
    );
    const priorGeneration = await client.roQuery<{ survivors: number }>(
      `MATCH (n {projectId: $projectId, indexGeneration: $oldGeneration})
       RETURN count(n) AS survivors`,
      { params: { projectId: initial.projectId, oldGeneration } },
    );
    const staleSymbols = await client.roQuery<{ survivors: number }>(
      `MATCH (n {projectId: $projectId, id: $staleId})
       RETURN count(n) AS survivors`,
      { params: { projectId: initial.projectId, staleId } },
    );

    expect(detached.data).toEqual([{ detachedSymbols: 0 }]);
    expect(duplicates.data).toEqual([]);
    expect(priorGeneration.data).toEqual([{ survivors: 0 }]);
    expect(staleSymbols.data).toEqual([{ survivors: 0 }]);
  }, 120_000);
});
