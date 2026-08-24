import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOperations, type GraphClient } from '@codegraph/graph';

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

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync('git', args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8' }).trim();
}

function commit(repoRoot: string, value: number, date: string): void {
  writeFileSync(join(repoRoot, 'value.ts'), `export const value = ${value};\n`);
  git(repoRoot, ['add', '-A']);
  git(
    repoRoot,
    ['-c', 'user.name=Coverage Test', '-c', 'user.email=coverage@example.com', 'commit', '-q', '-m', `commit ${value}`],
    { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  );
}

function makeRepo(dates: string[]): string {
  const repoRoot = mkdtempSync(join(tmpdir(), 'codegraph-gitsync-coverage-'));
  git(repoRoot, ['init', '-q']);
  dates.forEach((date, index) => commit(repoRoot, index + 1, date));
  return repoRoot;
}

function makeClient(): { client: GraphClient; metadata: Map<string, string> } {
  const metadata = new Map<string, string>();
  const roQuery = vi.fn().mockImplementation(async (_cypher: string, options?: { params?: Record<string, unknown> }) => {
    const key = options?.params?.['key'];
    const value = typeof key === 'string' ? metadata.get(key) : undefined;
    return { data: value === undefined ? [] : [{ value }], metadata: [] };
  });
  const query = vi.fn().mockImplementation(async (_cypher: string, options?: { params?: Record<string, unknown> }) => {
    const key = options?.params?.['key'];
    const value = options?.params?.['value'];
    if (typeof key === 'string' && typeof value === 'string') metadata.set(key, value);
    return { data: [], metadata: [] };
  });
  const client = {
    graph: null,
    graphName: 'test',
    dialect: {},
    query,
    roQuery,
    ensureIndexes: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as GraphClient;
  return { client, metadata };
}

const repositories: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createOperations).mockReturnValue(opsMocks as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const repository of repositories.splice(0)) {
    rmSync(repository, { recursive: true, force: true });
  }
});

describe('syncGitHistory persisted history window', () => {
  it('resolves the default cutoff once to exactly 365 days before the first sync start', async () => {
    const repoRoot = makeRepo(['2026-08-01T12:00:00Z']);
    repositories.push(repoRoot);
    const { client, metadata } = makeClient();
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-08-23T12:00:00.000Z'));

    const first = await syncGitHistory(repoRoot, client);
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-23T12:00:00.000Z'));
    const second = await syncGitHistory(repoRoot, client);

    expect(first.historySince).toBe('2025-08-23T12:00:00.000Z');
    expect(first.historyMaxCommits).toBe(10_000);
    expect(first.historyWindowSize).toBe(10_000);
    expect(second.historySince).toBe(first.historySince);
    expect(metadata.get(`historySince:${repoRoot}`)).toBe(first.historySince);
    expect(metadata.get(`historyMaxCommits:${repoRoot}`)).toBe('10000');
  });

  it('uses an explicit ISO cutoff for initial history selection', async () => {
    const repoRoot = makeRepo([
      '2024-01-01T00:00:00Z',
      '2025-01-01T00:00:00Z',
      '2026-01-01T00:00:00Z',
    ]);
    repositories.push(repoRoot);

    const result = await syncGitHistory(repoRoot, makeClient().client, {
      historySince: '2025-06-01T00:00:00Z',
      historyMaxCommits: 10,
    });

    expect(result.commitsProcessed).toBe(1);
    expect(result.historySince).toBe('2025-06-01T00:00:00Z');
    expect(result.historyTruncated).toBe(true);
    expect(result.historyComplete).toBe(false);
  });

  it('records the earliest actually indexed date when the max truncates a backfill', async () => {
    const repoRoot = makeRepo([
      '2025-01-01T00:00:00Z',
      '2025-02-01T00:00:00Z',
      '2025-03-01T00:00:00Z',
    ]);
    repositories.push(repoRoot);
    const { client, metadata } = makeClient();

    const result = await syncGitHistory(repoRoot, client, {
      historySince: '2024-01-01T00:00:00Z',
      historyMaxCommits: 2,
    });

    expect(result).toMatchObject({
      commitsProcessed: 2,
      totalCommits: 3,
      historyMaxCommits: 2,
      historyWindowSize: 2,
      historyTruncated: true,
      historyComplete: false,
    });
    expect(new Date(result.earliestIndexedCommitDate as string).toISOString()).toBe('2025-02-01T00:00:00.000Z');
    expect(metadata.get(`historyEarliestIndexedDate:${repoRoot}`)).toBe(result.earliestIndexedCommitDate);
  });

  it('replays a widened max with merge-safe inputs and becomes idempotent', async () => {
    const repoRoot = makeRepo([
      '2025-01-01T00:00:00Z',
      '2025-02-01T00:00:00Z',
      '2025-03-01T00:00:00Z',
      '2025-04-01T00:00:00Z',
    ]);
    repositories.push(repoRoot);
    const { client } = makeClient();

    const first = await syncGitHistory(repoRoot, client, {
      historySince: '2024-01-01T00:00:00Z',
      historyMaxCommits: 2,
    });
    const widened = await syncGitHistory(repoRoot, client, { historyMaxCommits: 4 });
    const repeated = await syncGitHistory(repoRoot, client, { historyMaxCommits: 4 });

    expect(first.commitsProcessed).toBe(2);
    expect(widened).toMatchObject({ commitsProcessed: 4, historyMaxCommits: 4, historyTruncated: false, historyComplete: true });
    expect(repeated).toMatchObject({ commitsProcessed: 0, historyMaxCommits: 4, historyTruncated: false, historyComplete: true });
  });

  it('keeps the persisted union when callers request a narrower window', async () => {
    const repoRoot = makeRepo(['2025-01-01T00:00:00Z', '2025-02-01T00:00:00Z']);
    repositories.push(repoRoot);
    const { client } = makeClient();

    await syncGitHistory(repoRoot, client, {
      historySince: '2024-01-01T00:00:00Z',
      historyMaxCommits: 20,
    });
    const result = await syncGitHistory(repoRoot, client, {
      historySince: '2025-01-15T00:00:00Z',
      historyMaxCommits: 1,
    });

    expect(result.historySince).toBe('2024-01-01T00:00:00Z');
    expect(result.historyMaxCommits).toBe(20);
    expect(result.commitsProcessed).toBe(0);
  });

  it('processes an incremental backlog larger than the initial cap without skipping commits', async () => {
    const repoRoot = makeRepo(['2025-01-01T00:00:00Z']);
    repositories.push(repoRoot);
    const { client, metadata } = makeClient();

    const initial = await syncGitHistory(repoRoot, client, {
      historySince: '2024-01-01T00:00:00Z',
      historyMaxCommits: 1,
    });
    for (let index = 2; index <= 6; index += 1) {
      commit(repoRoot, index, `2025-01-0${index}T00:00:00Z`);
    }
    const incremental = await syncGitHistory(repoRoot, client, { historyMaxCommits: 1 });
    const head = git(repoRoot, ['rev-parse', 'HEAD']);

    expect(initial.commitsProcessed).toBe(1);
    expect(incremental.commitsProcessed).toBe(5);
    expect(incremental.lastCommitHash).toBe(head);
    expect(metadata.get(`lastCommitSynced:${repoRoot}`)).toBe(head);
  });
});
