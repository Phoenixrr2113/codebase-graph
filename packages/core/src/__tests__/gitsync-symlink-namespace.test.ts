/**
 * Regression test: syncGitHistory() dropped every file on macOS because of a
 * symlink mismatch between two "the same directory" paths.
 *
 * `git rev-parse --show-toplevel` returns a symlink-RESOLVED path. On macOS,
 * os.tmpdir() lives under /var/folders, which is a symlink to
 * /private/var/folders, so a repo created under os.tmpdir() reports its
 * toplevel as /private/var/folders/... . The indexed root the caller passes
 * in (indexer.ts never calls realpath) stays /var/folders/... . Joining
 * git's repo-root-relative paths onto the resolved repoRoot and then taking
 * `relative(indexedRoot, resolvedPath)` therefore starts with '..' for
 * every file, even files genuinely inside the indexed root, so the
 * boundary-skip check silently dropped all of them.
 *
 * File nodes are stored using whatever (possibly unresolved) root path the
 * caller supplied to the indexer (see createFileEntityFromContent() /
 * resolve(rootPath, f) in indexer.ts) - so the fix must resolve symlinks
 * only to make the boundary comparison correct, and must map the edge's
 * filePath back into the caller's ORIGINAL namespace so it still matches
 * File.filePath byte-for-byte.
 *
 * Deliberately does NOT call realpathSync on the fixture paths (unlike
 * gitsync-root-commit.test.ts), because that's what a real caller does.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

// Deliberately unresolved - mirrors what a real caller (indexer.ts) passes.
let repoRoot: string;
let indexedRoot: string;

beforeAll(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'codegraph-gitsync-symlink-'));
  git(repoRoot, ['init', '-q']);
  git(repoRoot, ['config', 'user.email', 'test@example.com']);
  git(repoRoot, ['config', 'user.name', 'Test']);

  // First commit has no parent (root commit); keep it minimal.
  writeFileSync(join(repoRoot, '.gitkeep'), '');
  git(repoRoot, ['add', '-A']);
  git(repoRoot, ['commit', '-q', '-m', 'initial']);

  // Second, ordinary commit adds a file under a subdirectory that stands in
  // for "the indexed root" (one package in a monorepo checkout).
  indexedRoot = join(repoRoot, 'packages', 'sub');
  mkdirSync(indexedRoot, { recursive: true });
  writeFileSync(join(indexedRoot, 'foo.ts'), 'export const x = 1;\n');
  git(repoRoot, ['add', '-A']);
  git(repoRoot, ['commit', '-q', '-m', 'add foo.ts']);
});

afterAll(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('syncGitHistory: preserves the caller original path namespace', () => {
  it('creates MODIFIED_IN edges even when the indexed root sits under a symlink, using a filePath that matches File.filePath', async () => {
    const result = await syncGitHistory(indexedRoot, fakeClient, { maxCommits: 10, includeStats: true });

    expect(result.commitsProcessed).toBe(2);

    // This is exactly the string indexer.ts's createFileEntityFromContent()
    // would store on the File node: resolve(indexedRoot, 'foo.ts'), using
    // the caller's ORIGINAL (possibly symlinked) indexedRoot, never a
    // realpath-resolved one.
    const expectedFilePath = resolve(indexedRoot, 'foo.ts');

    const modifiedPaths = opsMocks.createModifiedInEdge.mock.calls.map((call) => call[0] as string);
    expect(modifiedPaths).toContain(expectedFilePath);

    const introducedPaths = opsMocks.createIntroducedInEdgesForFile.mock.calls.map((call) => call[0] as string);
    expect(introducedPaths).toContain(expectedFilePath);
  });
});
