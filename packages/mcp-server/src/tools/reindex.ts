/**
 * MCP Tool: trigger_reindex
 *
 * Triggers a reindex of the codebase, either incrementally or full.
 * Uses @codegraph/core's extraction pipeline for actual parsing.
 */

import { stat } from 'node:fs/promises';
import { indexProject, indexSingleFile, getActiveProjectPaths, syncGitHistory } from '@codegraph/core';
import { getGraphClient } from '@codegraph/core';
import { createLogger } from '@codegraph/logger';
import type { ToolDefinition } from './router';

/** Query current embedding count from the graph */
async function getEmbeddedCount(): Promise<number> {
  try {
    const client = await getGraphClient();
    const result = await client.roQuery<{ count: number }>(
      'MATCH (n) WHERE n.embedding IS NOT NULL RETURN count(n) AS count'
    );
    return result.data?.[0]?.count ?? 0;
  } catch {
    return 0;
  }
}

const logger = createLogger({ namespace: 'MCP:Reindex' });

// Input schema
export interface ReindexInput {
  mode?: 'incremental' | 'full';
  scope?: string;
  concurrency?: number;
  /**
   * When true, return immediately after structural indexing and run embeddings
   * in the background. Default false: block until embeddings complete so
   * search.find returns non-empty results immediately after this call.
   */
  deferEmbeddings?: boolean;
}

// Output type
export interface ReindexOutput {
  success: boolean;
  filesProcessed: number;
  symbolsUpdated: number;
  gitCommitsSynced: number;
  gitEdgesCreated: number;
  duration: number;
  errors: string[];
  /** When true, embeddings are generating in the background after this response */
  embeddingsDeferred?: boolean;
  /** Current count of nodes that have embeddings (may increase as background embedding runs) */
  embeddedCount?: number;
}

// Tool definition for MCP
export const reindexToolDefinition: ToolDefinition = {
  name: 'trigger_reindex',
  description: 'Trigger a reindex of the codebase. Supports incremental (changed files only) or full mode. If no scope is specified, re-indexes all active projects.',
  inputSchema: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['incremental', 'full'],
        default: 'incremental',
        description: 'Reindex mode: incremental (default) processes only changed files, full reprocesses everything',
      },
      scope: {
        type: 'string',
        description: 'Specific file or directory path to reindex. If omitted, reindexes all active projects.',
      },
      concurrency: {
        type: 'number',
        description: 'Number of files to process in parallel. Defaults to CPU count.',
      },
      deferEmbeddings: {
        type: 'boolean',
        default: false,
        description: 'When true, return immediately and run embeddings in background. Default false: block until embeddings complete.',
      },
    },
    required: [],
  },
};

/**
 * Handler for trigger_reindex tool
 */
export async function triggerReindex(input: ReindexInput): Promise<ReindexOutput> {
  const startTime = Date.now();
  const errors: string[] = [];
  let totalGitCommits = 0;
  let totalGitEdges = 0;

  try {
    // If scope is provided, determine if it's a file or directory
    if (input.scope) {
      const scopeStat = await stat(input.scope);

      if (scopeStat.isFile()) {
        // Single file reindex
        logger.info(`Re-indexing single file: ${input.scope}`);
        const result = await indexSingleFile(input.scope);

        return {
          success: result.success,
          filesProcessed: result.success ? 1 : 0,
          symbolsUpdated: result.entities,
          gitCommitsSynced: 0,
          gitEdgesCreated: 0,
          duration: Date.now() - startTime,
          errors: result.error ? [result.error] : [],
          // indexSingleFile accepts deferEmbeddings, but we don't pass it through
          // here — single-file reindex always blocks on embeddings to keep the code
          // path simple. Per-file reindex is rare and the cost difference is tiny.
          embeddingsDeferred: false,
          embeddedCount: await getEmbeddedCount(),
        };

      } else if (scopeStat.isDirectory()) {
        // Directory reindex
        logger.info(`Re-indexing directory: ${input.scope} (mode: ${input.mode})`);
        const result = await indexProject(input.scope, {
          force: input.mode === 'full',
          deepAnalysis: true,
          deferEmbeddings: input.deferEmbeddings ?? false,
          ...(input.concurrency != null && { concurrency: input.concurrency }),
        });

        // Sync git history after indexing
        const gitResult = await syncGitAfterIndex(input.scope, errors);
        totalGitCommits += gitResult.commits;
        totalGitEdges += gitResult.edges;

        return {
          success: result.success,
          filesProcessed: result.stats.files,
          symbolsUpdated: result.stats.entities,
          gitCommitsSynced: totalGitCommits,
          gitEdgesCreated: totalGitEdges,
          duration: Date.now() - startTime,
          errors: [...result.errorMessages, ...errors],
          embeddingsDeferred: input.deferEmbeddings ?? false,
          embeddedCount: result.stats.embedded ?? await getEmbeddedCount(),
        };

      } else {
        return {
          success: false,
          filesProcessed: 0,
          symbolsUpdated: 0,
          gitCommitsSynced: 0,
          gitEdgesCreated: 0,
          duration: Date.now() - startTime,
          errors: [`Scope path is neither a file nor directory: ${input.scope}`],
        };
      }
    }

    // No scope provided — re-index all active projects
    const activePaths = await getActiveProjectPaths();

    if (activePaths.length === 0) {
      return {
        success: false,
        filesProcessed: 0,
        symbolsUpdated: 0,
        gitCommitsSynced: 0,
        gitEdgesCreated: 0,
        duration: Date.now() - startTime,
        errors: ['No active projects configured. Use configure_projects to set up projects first.'],
      };
    }

    logger.info(`Re-indexing ${activePaths.length} active project(s) (mode: ${input.mode})`);

    let totalFiles = 0;
    let totalEntities = 0;

    for (const rootPath of activePaths) {
      try {
        const result = await indexProject(rootPath, {
          force: input.mode === 'full',
          deepAnalysis: true,
          deferEmbeddings: input.deferEmbeddings ?? false,
          ...(input.concurrency != null && { concurrency: input.concurrency }),
        });
        totalFiles += result.stats.files;
        totalEntities += result.stats.entities;
        errors.push(...result.errorMessages);

        // Sync git history after each project
        const gitResult = await syncGitAfterIndex(rootPath, errors);
        totalGitCommits += gitResult.commits;
        totalGitEdges += gitResult.edges;
      } catch (err) {
        const msg = `Failed to index ${rootPath}: ${err instanceof Error ? err.message : err}`;
        errors.push(msg);
        logger.error(msg);
      }
    }

    return {
      success: true,
      filesProcessed: totalFiles,
      symbolsUpdated: totalEntities,
      gitCommitsSynced: totalGitCommits,
      gitEdgesCreated: totalGitEdges,
      duration: Date.now() - startTime,
      errors,
      embeddingsDeferred: input.deferEmbeddings ?? false,
      embeddedCount: await getEmbeddedCount(),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error during reindex';
    errors.push(errorMessage);

    return {
      success: false,
      filesProcessed: 0,
      symbolsUpdated: 0,
      gitCommitsSynced: 0,
      gitEdgesCreated: 0,
      duration: Date.now() - startTime,
      errors,
    };
  }
}

/**
 * Run git sync after indexing a project. Non-fatal — errors are collected, not thrown.
 */
async function syncGitAfterIndex(
  rootPath: string,
  errors: string[],
): Promise<{ commits: number; edges: number }> {
  try {
    const client = await getGraphClient();
    const gitResult = await syncGitHistory(rootPath, client);
    if (gitResult.errors.length > 0) {
      errors.push(...gitResult.errors);
    }
    if (gitResult.commitsProcessed > 0) {
      logger.info(`Git sync: ${gitResult.commitsProcessed} commits, ${gitResult.edgesCreated} edges for ${rootPath}`);
    }
    return { commits: gitResult.commitsProcessed, edges: gitResult.edgesCreated };
  } catch (err) {
    const msg = `Git sync failed for ${rootPath}: ${err instanceof Error ? err.message : err}`;
    logger.warn(msg);
    errors.push(msg);
    return { commits: 0, edges: 0 };
  }
}
