import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createClient, resolveEmbeddedBinaryPaths, type GraphClient } from '@codegraph/graph';
import { indexProject } from '../indexer';

const describeIfAvailable = resolveEmbeddedBinaryPaths() ? describe : describe.skip;

describeIfAvailable('indexProject overload call target resolution', () => {
  let client: GraphClient;
  let dataDir: string;
  let projectDir: string;
  let overPath: string;
  let callerPath: string;
  let previousEmbeddingProvider: string | undefined;

  beforeAll(async () => {
    previousEmbeddingProvider = process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
    process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = 'none';

    dataDir = await mkdtemp(join(tmpdir(), 'cgot-'));
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: 'overload_call_target',
    } as never);

    projectDir = mkdtempSync(join(tmpdir(), 'cg-overload-call-project-'));
    overPath = resolve(projectDir, 'over.ts');
    callerPath = resolve(projectDir, 'caller.ts');
    writeFileSync(overPath, [
      'export class Over {',
      '  work(value: string): string;',
      '  work(value: number): number;',
      '  work(value: string | number): string | number { return value; }',
      '}',
      'export class Sibling {',
      '  work(value: string): string;',
      '  work(value: number): number;',
      '  work(value: string | number): string | number { return value; }',
      '}',
      '',
    ].join('\n'));
    writeFileSync(callerPath, [
      "import { Over } from './over';",
      'export function callOver(over: Over): string {',
      "  return over.work('value');",
      '}',
      '',
    ].join('\n'));
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

  it('persists exactly one cross-file receiver CALLS edge to the implementation', async () => {
    const result = await indexProject(projectDir, {
      client,
      includePatterns: ['*.ts'],
      embeddings: false,
      gitSync: false,
      force: true,
    });
    expect(result.success).toBe(true);
    expect(result.errorMessages).toEqual([]);

    const targets = await client.roQuery<{
      id: string;
      scopeKey: string;
      startLine: number;
    }>(
      `MATCH (:Function {name: 'callOver', filePath: $callerPath})-[:CALLS]->(target:Function {name: 'work'})
       RETURN target.id AS id, target.scopeKey AS scopeKey, target.startLine AS startLine
       ORDER BY target.startLine`,
      { params: { callerPath } },
    );

    expect(targets.data).toEqual([{
      id: expect.stringMatching(/^sym:v1:[a-f0-9]{64}$/),
      scopeKey: 'Class:Over',
      startLine: 4,
    }]);

    const overloadNodes = await client.roQuery<{ scopeKey: string; startLine: number }>(
      `MATCH (method:Function {name: 'work', filePath: $overPath})
       RETURN method.scopeKey AS scopeKey, method.startLine AS startLine
       ORDER BY method.scopeKey, method.startLine`,
      { params: { overPath } },
    );
    expect(overloadNodes.data).toHaveLength(6);
  }, 60_000);
});
