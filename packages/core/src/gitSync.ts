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

        // Get files changed in this commit with status (A=added, M=modified, D=deleted)
        const diffSummary = await git
          .diffSummary([`${commit.hash}^`, commit.hash])
          .catch(() => null);

        // Get name-status for INTRODUCED_IN / DELETED_IN detection
        const nameStatus = await git
          .raw(['diff', '--name-status', `${commit.hash}^`, commit.hash])
          .catch(() => '');

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
            const absolutePath = `${repoPath}/${file.file}`;
            const linesAdded = includeStats
              ? (file as { insertions?: number }).insertions
              : undefined;
            const linesRemoved = includeStats
              ? (file as { deletions?: number }).deletions
              : undefined;

            try {
              await ops.createModifiedInEdge(absolutePath, commit.hash, linesAdded, linesRemoved);
              edgesCreated++;
            } catch {
              // File may not be in the graph (not indexed) — expected
            }

            // INTRODUCED_IN: file was added in this commit
            const status = statusMap.get(file.file);
            if (status === 'A') {
              try {
                await ops.createIntroducedInEdgesForFile(absolutePath, commit.hash);
              } catch {
                // Entities may not exist yet
              }
            }

            // DELETED_IN: file was deleted in this commit
            if (status === 'D') {
              try {
                await ops.createDeletedInEdgesForFile(absolutePath, commit.hash);
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
