/**
 * MCP Tool: trigger_reindex
 *
 * Triggers a reindex of the codebase, either incrementally or full.
 * Uses @codegraph/core's extraction pipeline for actual parsing.
 */

import { stat } from 'node:fs/promises';
import { indexProject, indexSingleFile, getActiveProjectPaths } from '@codegraph/core';
import { createLogger } from '@codegraph/logger';
import type { ToolDefinition } from './consolidated';

const logger = createLogger({ namespace: 'MCP:Reindex' });

// Input schema
export interface ReindexInput {
  mode?: 'incremental' | 'full';
  scope?: string;
}

// Output type
export interface ReindexOutput {
  success: boolean;
  filesProcessed: number;
  symbolsUpdated: number;
  duration: number;
  errors: string[];
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
          duration: Date.now() - startTime,
          errors: result.error ? [result.error] : [],
        };

      } else if (scopeStat.isDirectory()) {
        // Directory reindex
        logger.info(`Re-indexing directory: ${input.scope} (mode: ${input.mode})`);
        const result = await indexProject(input.scope, {
          force: input.mode === 'full',
          deepAnalysis: true,
        });

        return {
          success: result.success,
          filesProcessed: result.stats.files,
          symbolsUpdated: result.stats.entities,
          duration: result.stats.durationMs,
          errors: result.errorMessages,
        };

      } else {
        return {
          success: false,
          filesProcessed: 0,
          symbolsUpdated: 0,
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
        });
        totalFiles += result.stats.files;
        totalEntities += result.stats.entities;
        errors.push(...result.errorMessages);
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
      duration: Date.now() - startTime,
      errors,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error during reindex';
    errors.push(errorMessage);

    return {
      success: false,
      filesProcessed: 0,
      symbolsUpdated: 0,
      duration: Date.now() - startTime,
      errors,
    };
  }
}
