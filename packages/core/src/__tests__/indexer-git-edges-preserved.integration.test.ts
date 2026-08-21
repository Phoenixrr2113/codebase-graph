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
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createClient, resolveEmbeddedBinaryPaths, type GraphClient } from '@codegraph/graph';
import { indexProject } from '../indexer';

// The embedded driver ships binaries for darwin-arm64 and linux-x64 only.
const describeIfAvailable = resolveEmbeddedBinaryPaths() ? describe : describe.skip;

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
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

    dataDir = await mkdtemp(join(tmpdir(), 'cg-git-edges-'));
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: 'git_edges_regression',
    } as never);

    repoRoot = mkdtempSync(join(tmpdir(), 'codegraph-git-edges-repo-'));
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
});
