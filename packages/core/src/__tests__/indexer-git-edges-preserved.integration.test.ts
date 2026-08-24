/**
 * Regression test: an incremental reindex of a CHANGED file destroyed every
 * git-history edge (MODIFIED_IN, INTRODUCED_IN, DELETED_IN, HAS_FILE) that
 * had already been synced onto that file's File node.
 *
 * indexProject()'s incremental path called ops.removeFileAndCleanup(file)
 * before re-upserting a changed file. Its REMOVE_FILE_NODE Cypher is
 * `MATCH (f:File {filePath}) OPTIONAL MATCH (f)-[c:CONTAINS]->() DELETE c, f`
 * -- deleting the File node cascades away every edge attached to it, not
 * just CONTAINS. HAS_FILE gets recreated by the very next chunk-loop step,
 * but syncGitHistory() only walks commits after its saved checkpoint
 * (Metadata node `lastCommitSynced:<repoPath>`), so MODIFIED_IN edges from
 * commits that were already synced before this reindex are gone forever.
 *
 * This test drives the real indexProject() against a real temporary git
 * repo and a real (embedded, no server) FalkorDBLite graph, because the bug
 * is about actual Cypher DELETE-vs-MERGE semantics -- a mocked ops layer
 * cannot distinguish "File node destroyed and rebuilt" from "File node
 * updated in place", only a real graph engine can.
 *
 * Sequence: index the repo at commit A (git sync captures commit A's
 * MODIFIED_IN edge), edit the file, commit B, incremental reindex (git sync
 * captures commit B's edge). Both edges must still be present afterward.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createClient, resolveEmbeddedBinaryPaths, type GraphClient } from '@codegraph/graph';
import { indexProject } from '../indexer';

// The embedded driver ships binaries for darwin-arm64 and linux-x64 only.
const describeIfAvailable = resolveEmbeddedBinaryPaths() ? describe : describe.skip;

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): void {
  execFileSync('git', args, { cwd, env: { ...process.env, ...env }, stdio: 'pipe' });
}

function commitFile(repoRoot: string, filePath: string, value: number, date: string): void {
  writeFileSync(filePath, `export const value = ${value};\n`);
  git(repoRoot, ['add', '-A']);
  git(repoRoot, ['commit', '-q', '-m', `commit ${value}`], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  });
}

async function modifiedInCount(client: GraphClient, filePath: string): Promise<number> {
  const result = await client.roQuery<{ edgeCount: number }>(
    `MATCH (f:File {filePath: $filePath})-[:MODIFIED_IN]->(:Commit)
     RETURN count(*) AS edgeCount`,
    { params: { filePath } },
  );
  return result.data?.[0]?.edgeCount ?? 0;
}

describeIfAvailable('indexProject: incremental reindex preserves prior git-history edges', () => {
  let client: GraphClient;
  let dataDir: string;
  let repoRoot: string;
  let filePath: string;
  let previousEmbeddingProvider: string | undefined;

  beforeAll(async () => {
    // ensureIndexes() needs to know the embedding dimension even when this
    // test passes embeddings: false to indexProject() itself; 'none' skips
    // vector indexes entirely so no provider/API key is needed here.
    previousEmbeddingProvider = process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
    process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = 'none';

    dataDir = await mkdtemp('/tmp/cgb1-db-');
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: 'git_edges_regression',
    } as never);

    repoRoot = mkdtempSync('/tmp/cgb1-repo-');
    git(repoRoot, ['init', '-q']);
    git(repoRoot, ['config', 'user.email', 'test@example.com']);
    git(repoRoot, ['config', 'user.name', 'Test']);

    filePath = resolve(repoRoot, 'foo.ts');
    writeFileSync(filePath, 'export function foo(): number {\n  return 1;\n}\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '-q', '-m', 'commit A']);
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (repoRoot) rmSync(repoRoot, { recursive: true, force: true });
    if (previousEmbeddingProvider === undefined) {
      delete process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
    } else {
      process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = previousEmbeddingProvider;
    }
  });

  it('keeps commit A and commit B MODIFIED_IN edges after an incremental reindex edits the file', async () => {
    // First index: brand-new project, full/CREATE path. Git sync captures
    // commit A's MODIFIED_IN edge.
    const first = await indexProject(repoRoot, {
      client,
      includePatterns: ['*.ts'],
      embeddings: false,
      force: true,
    });
    expect(first.success).toBe(true);

    const projectMetadata = await client.roQuery<{
      historySince: string;
      historyMaxCommits: number;
      historyWindowSize: number;
    }>(
      `MATCH (p:Project {rootPath: $rootPath})
       RETURN p.gitHistorySince AS historySince,
              p.gitHistoryMaxCommits AS historyMaxCommits,
              p.gitHistoryWindowSize AS historyWindowSize`,
      { params: { rootPath: repoRoot } },
    );
    expect(projectMetadata.data?.[0]).toMatchObject({
      historyMaxCommits: 10_000,
      historyWindowSize: 10_000,
    });
    expect(projectMetadata.data?.[0]?.historySince).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Edit the file and commit again.
    writeFileSync(filePath, 'export function foo(): number {\n  return 2;\n}\n');
    git(repoRoot, ['add', '-A']);
    git(repoRoot, ['commit', '-q', '-m', 'commit B']);

    // Incremental reindex: foo.ts's hash changed, so it goes through the
    // changed-file cleanup-and-reupsert path. Git sync only walks commit B
    // (commit A is already past the saved checkpoint).
    const second = await indexProject(repoRoot, {
      client,
      includePatterns: ['*.ts'],
      embeddings: false,
      force: false,
    });
    expect(second.success).toBe(true);

    const result = await client.roQuery<{ hash: string }>(
      `MATCH (f:File {filePath: $filePath})-[:MODIFIED_IN]->(c:Commit) RETURN c.hash AS hash`,
      { params: { filePath } },
    );

    const hashes = (result.data ?? []).map((row) => row.hash);
    expect(hashes).toHaveLength(2);
  });

  it('replays the persisted history window after a forced full reindex recreates File nodes', async () => {
    const forced = await indexProject(repoRoot, {
      client,
      includePatterns: ['*.ts'],
      embeddings: false,
      force: true,
    });
    expect(forced.success).toBe(true);

    const result = await client.roQuery<{ hash: string }>(
      `MATCH (f:File {filePath: $filePath})-[:MODIFIED_IN]->(c:Commit) RETURN c.hash AS hash`,
      { params: { filePath } },
    );

    expect((result.data ?? []).map((row) => row.hash)).toHaveLength(2);
  });

  it('rebuilds every previously indexed edge after incremental history grows beyond the backfill ceiling', async () => {
    const replayRepo = mkdtempSync('/tmp/cgb1-replay-');
    const replayFile = resolve(replayRepo, 'history.ts');
    try {
      git(replayRepo, ['init', '-q']);
      git(replayRepo, ['config', 'user.email', 'test@example.com']);
      git(replayRepo, ['config', 'user.name', 'Test']);
      for (let value = 1; value <= 4; value += 1) {
        commitFile(replayRepo, replayFile, value, `2025-01-${String(value).padStart(2, '0')}T00:00:00Z`);
      }

      const initial = await indexProject(replayRepo, {
        client,
        includePatterns: ['*.ts'],
        embeddings: false,
        force: true,
        historySince: '2025-01-01T00:00:00Z',
        historyMaxCommits: 2,
      });
      expect(initial.success).toBe(true);
      expect(await modifiedInCount(client, replayFile)).toBe(2);

      const widened = await indexProject(replayRepo, {
        client,
        includePatterns: ['*.ts'],
        embeddings: false,
        historyMaxCommits: 10,
      });
      expect(widened.success).toBe(true);
      expect(await modifiedInCount(client, replayFile)).toBe(4);

      for (let value = 5; value <= 18; value += 1) {
        commitFile(replayRepo, replayFile, value, `2025-02-${String(value - 4).padStart(2, '0')}T00:00:00Z`);
      }
      const firstIncremental = await indexProject(replayRepo, {
        client,
        includePatterns: ['*.ts'],
        embeddings: false,
        historyMaxCommits: 1,
      });
      expect(firstIncremental.stats.commitsProcessed).toBe(14);

      for (let value = 19; value <= 23; value += 1) {
        commitFile(replayRepo, replayFile, value, `2025-03-0${value - 18}T00:00:00Z`);
      }
      const secondIncremental = await indexProject(replayRepo, {
        client,
        includePatterns: ['*.ts'],
        embeddings: false,
        historyMaxCommits: 1,
      });
      expect(secondIncremental.stats.commitsProcessed).toBe(5);
      expect(await modifiedInCount(client, replayFile)).toBe(23);

      const forced = await indexProject(replayRepo, {
        client,
        includePatterns: ['*.ts'],
        embeddings: false,
        force: true,
      });
      expect(forced.success).toBe(true);
      expect(await modifiedInCount(client, replayFile)).toBe(23);

      commitFile(replayRepo, replayFile, 24, '2025-03-06T00:00:00Z');
      const finalIncremental = await indexProject(replayRepo, {
        client,
        includePatterns: ['*.ts'],
        embeddings: false,
        historyMaxCommits: 1,
      });
      expect(finalIncremental.stats.commitsProcessed).toBe(1);
      expect(await modifiedInCount(client, replayFile)).toBe(24);
    } finally {
      rmSync(replayRepo, { recursive: true, force: true });
    }
  }, 120_000);

  it('persists complete zero-commit coverage and syncs normally after the first commit', async () => {
    const unbornRepo = mkdtempSync('/tmp/cgb1-unborn-');
    const unbornFile = resolve(unbornRepo, 'unborn.ts');
    try {
      git(unbornRepo, ['init', '-q']);
      git(unbornRepo, ['config', 'user.email', 'test@example.com']);
      git(unbornRepo, ['config', 'user.name', 'Test']);
      writeFileSync(unbornFile, 'export const value = 0;\n');

      const initial = await indexProject(unbornRepo, {
        client,
        includePatterns: ['*.ts'],
        embeddings: false,
        force: true,
        historySince: '2025-01-01T00:00:00Z',
        historyMaxCommits: 2,
      });
      expect(initial.success).toBe(true);

      const initialCoverage = await client.roQuery<{
        total: number;
        truncated: boolean;
        complete: boolean;
        since: string;
        max: number;
      }>(
        `MATCH (p:Project {rootPath: $rootPath})
         RETURN p.gitHistoryTotalCommits AS total,
                p.gitHistoryTruncated AS truncated,
                p.gitHistoryComplete AS complete,
                p.gitHistorySince AS since,
                p.gitHistoryMaxCommits AS max`,
        { params: { rootPath: unbornRepo } },
      );
      expect(initialCoverage.data?.[0]).toEqual({
        total: 0,
        truncated: false,
        complete: true,
        since: '2025-01-01T00:00:00Z',
        max: 2,
      });

      git(unbornRepo, ['add', '-A']);
      git(unbornRepo, ['commit', '-q', '-m', 'first commit'], {
        GIT_AUTHOR_DATE: '2025-01-02T00:00:00Z',
        GIT_COMMITTER_DATE: '2025-01-02T00:00:00Z',
      });
      const afterFirstCommit = await indexProject(unbornRepo, {
        client,
        includePatterns: ['*.ts'],
        embeddings: false,
      });
      expect(afterFirstCommit.success).toBe(true);
      expect(afterFirstCommit.stats.commitsProcessed).toBe(1);
      expect(await modifiedInCount(client, unbornFile)).toBe(1);
    } finally {
      rmSync(unbornRepo, { recursive: true, force: true });
    }
  }, 30_000);

  it.each([
    '2026-02-30T00:00:00Z',
    '2026-04-31T12:00:00Z',
    '2025-02-29T00:00:00Z',
  ])('rejects impossible history timestamp %s at indexProject', async (historySince) => {
    const result = await indexProject(repoRoot, {
      client,
      includePatterns: ['*.ts'],
      embeddings: false,
      historySince,
    });

    expect(result.success).toBe(false);
    expect(result.errorMessages).toEqual(['historySince must be a valid ISO 8601 date or timestamp']);
  });

  it('accepts a valid leap-day history timestamp at indexProject', async () => {
    const result = await indexProject(repoRoot, {
      client,
      includePatterns: ['*.ts'],
      embeddings: false,
      historySince: '2024-02-29T00:00:00Z',
    });

    expect(result.success).toBe(true);
  });
});
