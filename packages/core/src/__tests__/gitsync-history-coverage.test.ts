import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GraphClient } from '@codegraph/graph';

const opsMocks = vi.hoisted(() => ({
  upsertCommit: vi.fn().mockResolvedValue(undefined),
  createModifiedInEdge: vi.fn().mockResolvedValue(undefined),
  createIntroducedInEdgesForFile: vi.fn().mockResolvedValue(0),
  createDeletedInEdgesForFile: vi.fn().mockResolvedValue(0),
}));

vi.mock('@codegraph/graph', () => ({
  createOperations: vi.fn().mockReturnValue(opsMocks),
}));

import { syncGitHistory } from '../gitSync';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function commit(repoRoot: string, value: number): void {
  writeFileSync(join(repoRoot, 'value.ts'), `export const value = ${value};\n`);
  git(repoRoot, ['add', '-A']);
  git(repoRoot, ['-c', 'user.name=Coverage Test', '-c', 'user.email=coverage@example.com', 'commit', '-q', '-m', `commit ${value}`]);
}

function makeRepo(commitCount: number): string {
  const repoRoot = mkdtempSync(join(tmpdir(), 'codegraph-gitsync-coverage-'));
  git(repoRoot, ['init', '-q']);
  for (let index = 1; index <= commitCount; index += 1) commit(repoRoot, index);
  return repoRoot;
}

function makeClient(): GraphClient {
  return {
    graph: null,
    graphName: 'test',
    dialect: {},
    query: vi.fn().mockResolvedValue({ data: [], metadata: [] }),
    roQuery: vi.fn().mockResolvedValue({ data: [], metadata: [] }),
    ensureIndexes: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as GraphClient;
}

const repositories: string[] = [];

afterEach(() => {
  for (const repository of repositories.splice(0)) {
    rmSync(repository, { recursive: true, force: true });
  }
});

describe('syncGitHistory history coverage', () => {
  it('reports complete history when the repository fits within the configured window', async () => {
    const repoRoot = makeRepo(1);
    repositories.push(repoRoot);

    const result = await syncGitHistory(repoRoot, makeClient(), { maxCommits: 2 });

    expect(result).toMatchObject({
      commitsProcessed: 1,
      totalCommits: 1,
      historyWindowSize: 2,
      historyTruncated: false,
      historyComplete: true,
    });
  });

  it('reports truncation when the repository exceeds the configured window', async () => {
    const repoRoot = makeRepo(3);
    repositories.push(repoRoot);

    const result = await syncGitHistory(repoRoot, makeClient(), { maxCommits: 2 });

    expect(result).toMatchObject({
      commitsProcessed: 2,
      totalCommits: 3,
      historyWindowSize: 2,
      historyTruncated: true,
      historyComplete: false,
    });
  });
});
