/**
 * Regression test for the repo-root join bug in syncGitHistory().
 *
 * git reports changed-file paths (via `git diff` / `--name-status`) relative
 * to the REPOSITORY root, not relative to whatever cwd the command was
 * invoked from. syncGitHistory() used to build `${repoPath}/${file.file}`,
 * where repoPath is the INDEXED root passed in by the caller. When the
 * indexed directory is a subdirectory of the actual git repo (a package in a
 * monorepo), that join produces a path that duplicates the subdirectory
 * segment and never matches any real File node, so MODIFIED_IN edges
 * silently fail to attach.
 *
 * This test drives a real temporary git repo (git init in a tmp dir) so the
 * paths git reports are genuine repo-root-relative paths, and mocks only the
 * graph ops layer, so it needs no live FalkorDB.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
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
let indexedRoot: string;

beforeAll(() => {
  // realpathSync matters here: on macOS, os.tmpdir() returns a path under a
  // symlink (/var/folders -> /private/var/folders), and `git rev-parse
  // --show-toplevel` resolves to the real path. Canonicalizing up front keeps
  // our expected paths in the test in sync with what the fix computes.
  repoRoot = realpathSync(mkdtempSync(join(tmpdir(), 'codegraph-gitsync-')));
  git(repoRoot, ['init', '-q']);
  git(repoRoot, ['config', 'user.email', 'test@example.com']);
  git(repoRoot, ['config', 'user.name', 'Test']);

  // First commit has no parent, so `git diff <hash>^ <hash>` cannot be
  // computed for it (expected, non-fatal) -- keep it minimal.
  writeFileSync(join(repoRoot, '.gitkeep'), '');
  git(repoRoot, ['add', '-A']);
  git(repoRoot, ['commit', '-q', '-m', 'initial']);

  // Second commit adds a file under a subdirectory (the "indexed root", as
  // if this were one package in a monorepo) AND a file at the repo root
  // (outside the indexed root, so it must be skipped, not mislinked).
  indexedRoot = join(repoRoot, 'packages', 'sub');
  mkdirSync(indexedRoot, { recursive: true });
  writeFileSync(join(indexedRoot, 'foo.ts'), 'export const x = 1;\n');
  writeFileSync(join(repoRoot, 'README.md'), '# root file\n');
  git(repoRoot, ['add', '-A']);
  git(repoRoot, ['commit', '-q', '-m', 'add files']);
});

afterAll(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

beforeEach(() => {
  opsMocks.upsertCommit.mockClear();
  opsMocks.createModifiedInEdge.mockClear();
  opsMocks.createIntroducedInEdgesForFile.mockClear();
  opsMocks.createDeletedInEdgesForFile.mockClear();
});

describe('syncGitHistory: joins git paths against the repo root, not the indexed subdirectory', () => {
  it('links MODIFIED_IN edges using the real absolute path of files under the indexed root', async () => {
    const result = await syncGitHistory(indexedRoot, fakeClient, { maxCommits: 10, includeStats: true });

    expect(result.errors).toEqual([]);
    expect(result.commitsProcessed).toBe(2);

    const modifiedPaths = opsMocks.createModifiedInEdge.mock.calls.map((call) => call[0] as string);

    // foo.ts lives under the indexed root; the correct absolute path is
    // indexedRoot/foo.ts, matching how the indexer resolves File nodes.
    // The old code instead built `${indexedRoot}/packages/sub/foo.ts`
    // (doubling the subdirectory), which never matches any File node.
    expect(modifiedPaths).toContain(resolve(indexedRoot, 'foo.ts'));
    expect(modifiedPaths).not.toContain(resolve(indexedRoot, 'packages', 'sub', 'foo.ts'));
  });

  it('skips files outside the indexed root instead of mislinking them', async () => {
    await syncGitHistory(indexedRoot, fakeClient, { maxCommits: 10, includeStats: true });

    const modifiedPaths = opsMocks.createModifiedInEdge.mock.calls.map((call) => call[0] as string);

    // README.md sits at the repo root, outside packages/sub. It must not be
    // turned into any absolute path and passed to createModifiedInEdge.
    expect(modifiedPaths.some((p) => p.includes('README.md'))).toBe(false);
  });
});
