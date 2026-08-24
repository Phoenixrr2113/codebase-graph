/**
 * Regression test: syncGitHistory() silently produced zero MODIFIED_IN /
 * INTRODUCED_IN edges for a repository's root (first, parent-less) commit.
 *
 * The per-commit diff used `git.diffSummary(['<hash>^', hash])` and
 * `git.raw(['diff', '--name-status', '<hash>^', hash])`. A root commit has
 * no parent, so `<hash>^` is not a valid revision and git exits 128. Both
 * calls were wrapped in `.catch(() => null)` / `.catch(() => '')`, so the
 * failure was swallowed: the Commit node was still created and
 * commitsProcessed still incremented, but no file edges were written for
 * that commit's files.
 *
 * This test drives a real temporary git repo whose very first commit adds
 * files, and mocks only the graph ops layer, so it needs no live FalkorDB.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { GraphClient } from '@codegraph/graph';

// ---------------------------------------------------------------------------
// Mocks. vi.mock is hoisted; mutable state the factory closes over must be
// created via vi.hoisted().
// ---------------------------------------------------------------------------

const opsMocks = vi.hoisted(() => ({
  upsertCommit: vi.fn().mockResolvedValue(undefined),
  createModifiedInEdge: vi.fn().mockResolvedValue(undefined),
  createIntroducedInEdgesForFile: vi.fn().mockResolvedValue(0),
  createDeletedInEdgesForFile: vi.fn().mockResolvedValue(0),
}));

vi.mock('@codegraph/graph', () => ({
  createOperations: vi.fn().mockReturnValue(opsMocks),
}));

// Import after mocks are declared.
import { syncGitHistory } from '../gitSync';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

const fakeClient = {
  graph: null,
  graphName: 'test',
  dialect: {},
  // getMetadata/setMetadata in gitSync.ts talk to the raw client directly.
  query: vi.fn().mockResolvedValue({ data: [], metadata: [] }),
  roQuery: vi.fn().mockResolvedValue({ data: [], metadata: [] }),
  ensureIndexes: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
} as unknown as GraphClient;

let repoRoot: string;

beforeAll(() => {
  // realpathSync matters on macOS: os.tmpdir() returns a path under a
  // symlink (/var/folders -> /private/var/folders).
  repoRoot = realpathSync(mkdtempSync(join(tmpdir(), 'codegraph-gitsync-root-')));
  git(repoRoot, ['init', '-q']);
  git(repoRoot, ['config', 'user.email', 'test@example.com']);
  git(repoRoot, ['config', 'user.name', 'Test']);

  // The FIRST commit in this repo adds files directly (no prior commit to
  // diff against), which is exactly the case that used to be swallowed.
  writeFileSync(join(repoRoot, 'foo.ts'), 'export const x = 1;\n');
  git(repoRoot, ['add', '-A']);
  git(repoRoot, ['commit', '-q', '-m', 'root commit']);
});

afterAll(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('syncGitHistory: root commit diffing', () => {
  it('produces MODIFIED_IN and INTRODUCED_IN edges for files added in the very first commit', async () => {
    const result = await syncGitHistory(repoRoot, fakeClient, { historyMaxCommits: 10, includeStats: true });

    expect(result.commitsProcessed).toBe(1);

    const modifiedPaths = opsMocks.createModifiedInEdge.mock.calls.map((call) => call[0] as string);
    expect(modifiedPaths).toContain(resolve(repoRoot, 'foo.ts'));

    const introducedPaths = opsMocks.createIntroducedInEdgesForFile.mock.calls.map((call) => call[0] as string);
    expect(introducedPaths).toContain(resolve(repoRoot, 'foo.ts'));
  });
});
