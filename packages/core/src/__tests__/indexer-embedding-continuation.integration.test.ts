import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient, resolveEmbeddedBinaryPaths, type GraphClient } from '@codegraph/graph';
import { generateEmbeddings } from '@codegraph/plugin-nlp';
import { getEmbeddingPassState, scheduleEmbeddingPass } from '../embed-pass';
import { indexProject } from '../indexer';

vi.mock('@codegraph/plugin-nlp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@codegraph/plugin-nlp')>();
  return {
    ...actual,
    isEmbeddingAvailable: () => true,
    generateEmbeddings: vi.fn(async (texts: string[]) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { embeddings: texts.map(() => Array.from({ length: 768 }, () => 0.1)) };
    }),
  };
});

const describeIfAvailable = resolveEmbeddedBinaryPaths() ? describe : describe.skip;

describeIfAvailable('post-index embedding continuation', () => {
  let client: GraphClient;
  let dataDir: string;
  let projectDir: string;
  let allNodeTypesProjectDir: string;
  let previousEmbeddingProvider: string | undefined;

  beforeAll(async () => {
    previousEmbeddingProvider = process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
    process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = 'local';
    dataDir = await mkdtemp('/tmp/cge-');
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: 'embedding_continuation',
    } as never);

    projectDir = mkdtempSync('/tmp/cgp-');
    writeFileSync(
      join(projectDir, 'fixture.ts'),
      [
        'export const answer = 42;',
        '',
        'export function readAnswer(): number {',
        '  return answer;',
        '}',
        '',
      ].join('\n'),
    );
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
    if (allNodeTypesProjectDir) rmSync(allNodeTypesProjectDir, { recursive: true, force: true });
    if (previousEmbeddingProvider === undefined) {
      delete process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
    } else {
      process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = previousEmbeddingProvider;
    }
  });

  it('schedules the remaining project nodes and deduplicates concurrent manual generation', async () => {
    vi.mocked(generateEmbeddings).mockClear();

    const indexed = await indexProject(projectDir, {
      client,
      includePatterns: ['*.ts'],
      deferEmbeddings: true,
      gitSync: false,
      force: true,
    });

    expect(indexed.success, indexed.errorMessages.join('\n')).toBe(true);
    expect(getEmbeddingPassState(indexed.projectId)).toMatchObject({
      running: true,
      scope: { type: 'project', projectId: indexed.projectId, rootPath: projectDir },
    });

    await scheduleEmbeddingPass({
      client,
      projectId: indexed.projectId,
      rootPath: projectDir,
      force: false,
    });

    const coverage = await client.roQuery<{ total: number; withEmbedding: number }>(
      `MATCH (n)
       WHERE n.projectId = $projectId AND
             (n:File OR n:Function OR n:Class OR n:Interface OR n:Variable OR n:Type OR n:Component)
       RETURN count(n) AS total,
              sum(CASE WHEN n.embedding IS NOT NULL THEN 1 ELSE 0 END) AS withEmbedding`,
      { params: { projectId: indexed.projectId } },
    );

    expect(coverage.data).toEqual([{ total: 3, withEmbedding: 3 }]);
    expect(
      vi.mocked(generateEmbeddings).mock.calls.reduce(
        (total, [texts]) => total + (texts as string[]).length,
        0,
      ),
    ).toBe(3);
    expect(getEmbeddingPassState(indexed.projectId)).toEqual({
      running: false,
      scope: null,
      startedAt: null,
    });
  }, 60_000);

  it('reaches full continuation coverage for File, Function, Variable, and Class nodes', async () => {
    vi.mocked(generateEmbeddings).mockClear();
    allNodeTypesProjectDir = mkdtempSync('/tmp/cgp-all-types-');
    writeFileSync(
      join(allNodeTypesProjectDir, 'fixture.ts'),
      [
        'export const answer = 42;',
        '',
        'export function readAnswer(): number {',
        '  return answer;',
        '}',
        '',
        'export class AnswerBox {}',
        '',
      ].join('\n'),
    );

    const indexed = await indexProject(allNodeTypesProjectDir, {
      client,
      includePatterns: ['*.ts'],
      deferEmbeddings: true,
      gitSync: false,
      force: true,
    });

    expect(indexed.success, indexed.errorMessages.join('\n')).toBe(true);
    await scheduleEmbeddingPass({
      client,
      projectId: indexed.projectId,
      rootPath: allNodeTypesProjectDir,
      force: false,
    });

    const coverage = await client.roQuery<{
      nodeType: string;
      total: number;
      withEmbedding: number;
    }>(
      `MATCH (n)
       WHERE n.projectId = $projectId AND
             (n:File OR n:Function OR n:Variable OR n:Class)
       RETURN labels(n)[0] AS nodeType,
              count(n) AS total,
              sum(CASE WHEN n.embedding IS NOT NULL THEN 1 ELSE 0 END) AS withEmbedding
       ORDER BY nodeType`,
      { params: { projectId: indexed.projectId } },
    );

    expect(coverage.data).toEqual([
      { nodeType: 'Class', total: 1, withEmbedding: 1 },
      { nodeType: 'File', total: 1, withEmbedding: 1 },
      { nodeType: 'Function', total: 1, withEmbedding: 1 },
      { nodeType: 'Variable', total: 1, withEmbedding: 1 },
    ]);
  }, 60_000);
});
