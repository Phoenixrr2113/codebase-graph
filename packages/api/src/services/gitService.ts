/**
 * Git History Service
 * Extracts git commit history using simple-git and creates temporal edges
 */

import simpleGit, { type SimpleGit, type LogResult, type DefaultLogFields } from 'simple-git';
import { createClient, createOperations, type GraphClient } from '@codegraph/graph';
import type { CommitEntity } from '@codegraph/types';
import { createLogger, traced } from '@codegraph/logger';

const logger = createLogger({ namespace: 'API:Git' });

// ============================================================================
// Types
// ============================================================================

/** Result of git history extraction */
export interface GitSyncResult {
  /** Number of commits processed */
  commitsProcessed: number;
  /** Number of file->commit edges created */
  edgesCreated: number;
  /** Last commit hash synced */
  lastCommitHash: string | null;
  /** Duration in milliseconds */
  durationMs: number;
  /** Any errors encountered */
  errors: string[];
}

/** Options for git history extraction */
export interface GitSyncOptions {
  /** Maximum number of commits to process (default: 100) */
  maxCommits?: number;
  /** Only process commits after this hash */
  sinceCommit?: string;
  /** Include file change stats in MODIFIED_IN edges */
  includeStats?: boolean;
}

// ============================================================================
// Metadata Management
// ============================================================================

const CYPHER = {
  GET_LAST_COMMIT: `
    MATCH (m:Metadata {key: 'lastCommitSynced'})
    RETURN m.value as value
  `,
  SET_LAST_COMMIT: `
    MERGE (m:Metadata {key: 'lastCommitSynced'})
    SET m.value = $value
    RETURN m
  `,
};

// ============================================================================
// Git Service Implementation
// ============================================================================

/**
 * Extract git history and sync to graph
 * Creates Commit nodes and MODIFIED_IN edges from Files to Commits
 */
export const extractGitHistory = traced('extractGitHistory', async function extractGitHistory(
  repoPath: string,
  options: GitSyncOptions = {}
): Promise<GitSyncResult> {
  const startTime = Date.now();
  const { maxCommits = 100, sinceCommit, includeStats = false } = options;
  const errors: string[] = [];

  try {
    // Initialize git client
    const git: SimpleGit = simpleGit(repoPath);

    // Verify it's a git repository
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return {
        commitsProcessed: 0,
        edgesCreated: 0,
        lastCommitHash: null,
        durationMs: Date.now() - startTime,
        errors: ['Not a git repository'],
      };
    }

    // Get graph operations
    const client = await createClient();
    const ops = createOperations(client);

    // Get last synced commit from graph metadata
    let lastSyncedCommit = sinceCommit;
    if (!lastSyncedCommit) {
      lastSyncedCommit = await getLastSyncedCommit(client);
    }

    // Build git log options
    const logOptions: Parameters<SimpleGit['log']>[0] = {
      maxCount: maxCommits,
      '--name-only': null, // Include changed file names
    };

    // If we have a last synced commit, only get commits since then
    if (lastSyncedCommit) {
      logOptions.from = lastSyncedCommit;
      logOptions.to = 'HEAD';
    }

    // Get commit log
    const log: LogResult<DefaultLogFields> = await git.log(logOptions);

    if (log.all.length === 0) {
      logger.info('No new commits to sync');
      return {
        commitsProcessed: 0,
        edgesCreated: 0,
        lastCommitHash: lastSyncedCommit ?? null,
        durationMs: Date.now() - startTime,
        errors: [],
      };
    }

    logger.info(`Processing ${log.all.length} commits`);

    let commitsProcessed = 0;
    let edgesCreated = 0;
    let newestCommitHash: string | null = null;

    // Process commits in reverse (oldest first) to maintain proper order
    const commits = [...log.all].reverse();

    for (const commit of commits) {
      try {
        // Store newest commit hash (the last one in original order)
        if (!newestCommitHash) {
          newestCommitHash = log.all[0]?.hash ?? null;
        }

        // Create CommitEntity
        const commitEntity: CommitEntity = {
          hash: commit.hash,
          message: commit.message,
          author: commit.author_name,
          email: commit.author_email,
          date: commit.date,
        };

        // Upsert commit node
        await ops.upsertCommit(commitEntity);
        commitsProcessed++;

        // Get files changed in this commit
        const diffSummary = await git.diffSummary([`${commit.hash}^`, commit.hash]).catch(() => null);

        if (diffSummary) {
          for (const file of diffSummary.files) {
            // Get file stats if requested
            const linesAdded = includeStats ? (file as { insertions?: number }).insertions : undefined;
            const linesRemoved = includeStats ? (file as { deletions?: number }).deletions : undefined;

            // Create MODIFIED_IN edge from file to commit
            // Note: file path needs to be resolved to absolute path for matching
            const absolutePath = `${repoPath}/${file.file}`;

            try {
              await ops.createModifiedInEdge(
                absolutePath,
                commit.hash,
                linesAdded,
                linesRemoved
              );
              edgesCreated++;
            } catch (edgeError) {
              // File might not exist in graph (not indexed yet)
              // This is expected for files outside the indexed set
              logger.debug(`Could not create edge for ${file.file}: ${edgeError}`);
            }
          }
        }
      } catch (commitError) {
        const errorMsg = `Error processing commit ${commit.hash}: ${commitError}`;
        logger.error(errorMsg);
        errors.push(errorMsg);
      }
    }

    // Update last synced commit in metadata
    if (newestCommitHash) {
      await setLastSyncedCommit(client, newestCommitHash);
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
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`Git sync failed: ${errorMsg}`);

    return {
      commitsProcessed: 0,
      edgesCreated: 0,
      lastCommitHash: null,
      durationMs: Date.now() - startTime,
      errors: [errorMsg],
    };
  }
});

/**
 * Get the last synced commit hash from graph metadata
 */
async function getLastSyncedCommit(client: GraphClient): Promise<string | undefined> {
  try {
    const result = await client.roQuery<{ value: string }>(CYPHER.GET_LAST_COMMIT);
    return result.data?.[0]?.value;
  } catch {
    // Metadata node doesn't exist yet
    return undefined;
  }
}

/**
 * Set the last synced commit hash in graph metadata
 */
async function setLastSyncedCommit(client: GraphClient, commitHash: string): Promise<void> {
  await client.query(CYPHER.SET_LAST_COMMIT, { params: { value: commitHash } });
}

/**
 * Get git repository info
 */
export const getRepoInfo = traced('getRepoInfo', async function getRepoInfo(repoPath: string): Promise<{
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
});
