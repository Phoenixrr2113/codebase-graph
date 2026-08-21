/**
 * Git History Sync — extracts commit history and creates temporal edges
 *
 * Portable module that accepts a GraphClient, usable from CLI, MCP, and API.
 * Creates Commit nodes and MODIFIED_IN edges from Files to Commits.
 */

import simpleGit, { type SimpleGit, type LogResult, type DefaultLogFields } from 'simple-git';
import { createOperations, type GraphClient } from '@codegraph/graph';
import type { CommitEntity } from '@codegraph/types';
import { createLogger } from '@codegraph/logger';
import { relative, resolve, join } from 'node:path';
import { realpath } from 'node:fs/promises';

const logger = createLogger({ namespace: 'core:gitSync' });

// ============================================================================
// Types
// ============================================================================

export interface GitSyncResult {
  commitsProcessed: number;
  edgesCreated: number;
  lastCommitHash: string | null;
  durationMs: number;
  errors: string[];
}

export interface GitSyncOptions {
  /** Maximum number of commits to process (default: 100) */
  maxCommits?: number;
  /** Only process commits after this hash */
  sinceCommit?: string;
  /** Include file change stats (linesAdded/linesRemoved) on MODIFIED_IN edges */
  includeStats?: boolean;
  /** GraphClient to use (uses default if not provided) */
  client?: GraphClient;
}

// ============================================================================
// Metadata helpers (Metadata node table for graph-level state)
// ============================================================================

const METADATA_CYPHER = {
  GET: `MATCH (m:Metadata {key: $key}) RETURN m.value as value`,
  // Kuzu doesn't support ON CREATE/MATCH SET, so check-then-insert
  CHECK: `MATCH (m:Metadata {key: $key}) RETURN m.value as value`,
  INSERT: `CREATE (m:Metadata {key: $key, value: $value})`,
  UPDATE: `MATCH (m:Metadata {key: $key}) SET m.value = $value`,
};

async function getMetadata(client: GraphClient, key: string): Promise<string | undefined> {
  try {
    const result = await client.roQuery<{ value: string }>(METADATA_CYPHER.GET, {
      params: { key },
    });
    return result.data?.[0]?.value;
  } catch {
    return undefined;
  }
}

async function setMetadata(client: GraphClient, key: string, value: string): Promise<void> {
  const existing = await getMetadata(client, key);
  if (existing !== undefined) {
    await client.query(METADATA_CYPHER.UPDATE, { params: { key, value } });
  } else {
    await client.query(METADATA_CYPHER.INSERT, { params: { key, value } });
  }
}

// ============================================================================
// Git Sync Implementation
// ============================================================================

/**
 * Git's well-known empty tree object hash (SHA-1 of an empty tree). Used as
 * the "before" state when diffing a repository's root commit, which has no
 * parent and so cannot be diffed with the usual `<hash>^` syntax.
 */
const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/**
 * Resolve the revision to diff a commit against: its parent (`<hash>^`) for
 * a normal commit, or the empty tree for a root commit. A root commit has
 * no parent, so `<hash>^` is not a valid revision and `git diff` exits 128 -
 * that failure used to be silently swallowed by a blanket .catch(), which
 * meant a repo's first commit never got MODIFIED_IN/INTRODUCED_IN edges for
 * its files.
 */
async function resolveDiffBase(git: SimpleGit, commitHash: string): Promise<string> {
  try {
    const revList = await git.raw(['rev-list', '--parents', '-n', '1', commitHash]);
    // Output is "<commit> [<parent> ...]" - a root commit has no parent, so
    // there is exactly one token.
    const tokens = revList.trim().split(/\s+/).filter(Boolean);
    return tokens.length > 1 ? `${commitHash}^` : EMPTY_TREE_HASH;
  } catch (err) {
    logger.warn(`Could not determine parent commit for ${commitHash}, assuming it has one: ${err instanceof Error ? err.message : String(err)}`);
    return `${commitHash}^`;
  }
}

/**
 * Sync git history for a repository into the graph.
 * Creates Commit nodes and MODIFIED_IN edges from Files to Commits.
 * Supports incremental sync via Metadata node tracking.
 */
/**
 * Get git repository info (branch, remote, last commit).
 * Standalone utility — does not require a graph connection.
 */
export async function getRepoInfo(repoPath: string): Promise<{
  isRepo: boolean;
  branch?: string | undefined;
  remoteUrl?: string | undefined;
  lastCommit?: string | undefined;
  totalCommits?: number | undefined;
}> {
  try {
    const git = simpleGit(repoPath);

    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return { isRepo: false };
    }

    const [branch, remotes, log] = await Promise.all([
      git.revparse(['--abbrev-ref', 'HEAD']),
      git.getRemotes(true),
      git.log({ maxCount: 1 }),
    ]);

    return {
      isRepo: true,
      branch: branch.trim(),
      remoteUrl: remotes[0]?.refs?.fetch,
      lastCommit: log.latest?.hash,
      totalCommits: log.total,
    };
  } catch (error) {
    logger.error(`Failed to get repo info: ${error}`);
    return { isRepo: false };
  }
}

/**
 * Sync git history for a repository into the graph.
 * Creates Commit nodes and MODIFIED_IN edges from Files to Commits.
 * Supports incremental sync via Metadata node tracking.
 */
export async function syncGitHistory(
  repoPath: string,
  client: GraphClient,
  options: GitSyncOptions = {},
): Promise<GitSyncResult> {
  const startTime = Date.now();
  const { maxCommits = 100, sinceCommit, includeStats = true } = options;
  const errors: string[] = [];

  try {
    const git: SimpleGit = simpleGit(repoPath);

    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return {
        commitsProcessed: 0,
        edgesCreated: 0,
        lastCommitHash: null,
        durationMs: Date.now() - startTime,
        errors: [`${repoPath} is not a git repository`],
      };
    }

    const ops = createOperations(client);

    // git reports file paths (via `git diff` / `--name-status`) relative to
    // the REPOSITORY root, not relative to repoPath, which may be a
    // subdirectory of the repo (e.g. one package in a monorepo checkout).
    // Resolve the real repo root once so every commit's paths can be turned
    // into the same absolute path the indexer used when it created File
    // nodes, instead of naively joining repoPath with git's relative path.
    const repoRoot = (await git.revparse(['--show-toplevel'])).trim();
    const indexedRoot = resolve(repoPath);

    // `git rev-parse --show-toplevel` resolves symlinks. On macOS,
    // os.tmpdir() lives under /var/folders, itself a symlink to
    // /private/var/folders, so a repo created under it reports repoRoot as
    // /private/var/folders/... while indexedRoot (built from whatever the
    // caller passed in, unresolved) stays /var/folders/... . Comparing those
    // two directly makes every file look "outside" the indexed root, since
    // relative() sees two different-looking paths even though they name the
    // same directory. Resolve indexedRoot's real path once, purely for that
    // boundary comparison - never for the filePath written onto edges,
    // which must stay in the caller's original (possibly symlinked)
    // namespace to match File.filePath (see indexer.ts, which never calls
    // realpath either).
    let realIndexedRoot: string;
    try {
      realIndexedRoot = await realpath(indexedRoot);
    } catch (err) {
      logger.warn(`Could not resolve real path for indexed root ${indexedRoot}, using it as-is: ${err instanceof Error ? err.message : String(err)}`);
      realIndexedRoot = indexedRoot;
    }

    // Determine starting point for incremental sync
    let fromCommit = sinceCommit;
    if (!fromCommit) {
      fromCommit = await getMetadata(client, `lastCommitSynced:${repoPath}`);
    }

    // Build git log options
    const logOptions: Parameters<SimpleGit['log']>[0] = {
      maxCount: maxCommits,
      '--name-only': null,
    };

    if (fromCommit) {
      logOptions.from = fromCommit;
      logOptions.to = 'HEAD';
    }

    const log: LogResult<DefaultLogFields> = await git.log(logOptions);

    if (log.all.length === 0) {
      logger.info('No new commits to sync');
      return {
        commitsProcessed: 0,
        edgesCreated: 0,
        lastCommitHash: fromCommit ?? null,
        durationMs: Date.now() - startTime,
        errors: [],
      };
    }

    logger.info(`Processing ${log.all.length} commits for ${repoPath}`);

    let commitsProcessed = 0;
    let edgesCreated = 0;
    const newestCommitHash = log.all[0]?.hash ?? null;

    // Process oldest first for proper ordering
    const commits = [...log.all].reverse();

    for (const commit of commits) {
      try {
        const commitEntity: CommitEntity = {
          hash: commit.hash,
          message: commit.message,
          author: commit.author_name,
          email: commit.author_email,
          date: commit.date,
        };

        await ops.upsertCommit(commitEntity);
        commitsProcessed++;

        // Get files changed in this commit with status (A=added, M=modified, D=deleted).
        // diffBase is the commit's parent, or the empty tree for a root commit
        // (see resolveDiffBase) - a root commit has no parent to diff against.
        const diffBase = await resolveDiffBase(git, commit.hash);

        const diffSummary = await git
          .diffSummary([diffBase, commit.hash])
          .catch((err: unknown) => {
            logger.warn(`Could not compute diff stats for commit ${commit.hash}: ${err instanceof Error ? err.message : String(err)}`);
            return null;
          });

        // Get name-status for INTRODUCED_IN / DELETED_IN detection
        const nameStatus = await git
          .raw(['diff', '--name-status', diffBase, commit.hash])
          .catch((err: unknown) => {
            logger.warn(`Could not compute name-status for commit ${commit.hash}: ${err instanceof Error ? err.message : String(err)}`);
            return '';
          });

        // Parse name-status into a map: filePath → status
        const statusMap = new Map<string, string>();
        for (const line of nameStatus.split('\n')) {
          const match = line.match(/^([AMDRC])\t(.+)/);
          if (match && match[2] && match[1]) {
            statusMap.set(match[2], match[1]);
          }
        }

        if (diffSummary) {
          for (const file of diffSummary.files) {
            // file.file is relative to repoRoot (git's convention), not to
            // repoPath. Resolve it against repoRoot to get the file's real
            // (symlink-resolved) absolute path, since repoRoot itself came
            // from `git rev-parse --show-toplevel`, which resolves symlinks.
            const resolvedAbsolutePath = resolve(repoRoot, file.file);

            // Boundary check against the equally-resolved indexed root, so
            // a symlink difference between the two (e.g. macOS os.tmpdir())
            // can't make every file look like it's outside the project.
            const relativeToIndexedRoot = relative(realIndexedRoot, resolvedAbsolutePath);
            if (relativeToIndexedRoot.startsWith('..')) {
              // Genuinely outside the indexed root: belongs to a different
              // part of the repo (e.g. a sibling package) and can't
              // correspond to a File node here.
              continue;
            }

            // Map back into the caller's ORIGINAL (possibly unresolved)
            // path namespace for the edge itself, so it byte-matches
            // File.filePath, which indexer.ts builds from the unresolved
            // root it was given (see createFileEntityFromContent()).
            const filePath = join(indexedRoot, relativeToIndexedRoot);

            const linesAdded = includeStats
              ? (file as { insertions?: number }).insertions
              : undefined;
            const linesRemoved = includeStats
              ? (file as { deletions?: number }).deletions
              : undefined;

            try {
              await ops.createModifiedInEdge(filePath, commit.hash, linesAdded, linesRemoved);
              edgesCreated++;
            } catch {
              // File may not be in the graph (not indexed) — expected
            }

            // INTRODUCED_IN: file was added in this commit
            const status = statusMap.get(file.file);
            if (status === 'A') {
              try {
                await ops.createIntroducedInEdgesForFile(filePath, commit.hash);
              } catch {
                // Entities may not exist yet
              }
            }

            // DELETED_IN: file was deleted in this commit
            if (status === 'D') {
              try {
                await ops.createDeletedInEdgesForFile(filePath, commit.hash);
              } catch {
                // Entities may already be gone
              }
            }
          }
        }
      } catch (commitError) {
        const errorMsg = `Error processing commit ${commit.hash}: ${commitError}`;
        logger.warn(errorMsg);
        errors.push(errorMsg);
      }
    }

    // Track last synced commit for incremental sync
    if (newestCommitHash) {
      await setMetadata(client, `lastCommitSynced:${repoPath}`, newestCommitHash);
    }

    logger.info(`Git sync complete: ${commitsProcessed} commits, ${edgesCreated} edges`);

    return {
      commitsProcessed,
      edgesCreated,
      lastCommitHash: newestCommitHash,
      durationMs: Date.now() - startTime,
      errors,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown git sync error';
    logger.error(`Git sync failed: ${errorMsg}`);

    return {
      commitsProcessed: 0,
      edgesCreated: 0,
      lastCommitHash: null,
      durationMs: Date.now() - startTime,
      errors: [errorMsg],
    };
  }
}
