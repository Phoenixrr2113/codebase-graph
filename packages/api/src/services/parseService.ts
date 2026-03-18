/**
 * Parse service - thin orchestrator around @codegraph/core's indexer
 *
 * Delegates file discovery, parsing, and graph persistence to core's
 * indexProject/indexSingleFile. This service adds:
 * - traced() observability wrappers
 * - Post-ingestion analytics hooks
 * - removeFileFromGraph (API-specific)
 */

import type { ParseResult, FileError } from '@codegraph/types';
import { indexProject, indexSingleFile, getGraphClient, codeGraphService } from '@codegraph/core';
import { createLogger, traced, toErrorMessage } from '@codegraph/logger';

const logger = createLogger({ namespace: 'API:Parse' });

/** Parse options for deep analysis */
export interface ParseOptions {
  deepAnalysis?: boolean;
  includeExternals?: boolean;
}

export const parseProject = traced('parseProject', async function parseProject(
  projectPath: string,
  ignorePatterns: string[] = [],
  options: ParseOptions = {}
): Promise<ParseResult> {
  try {
    const client = await getGraphClient();
    const result = await indexProject(projectPath, {
      deepAnalysis: options.deepAnalysis ?? false,
      includeExternals: options.includeExternals ?? false,
      ignorePatterns,
      client,
      deferEmbeddings: true, // Graph is searchable immediately; embeddings generate in background
    });

    // Parse error messages into structured file errors
    // Core indexer formats them as "Failed: /path/to/file: error message"
    const fileErrors: FileError[] = result.errorMessages.map((msg) => {
      const match = msg.match(/^Failed:\s+(.+?):\s+(.+)$/);
      if (match && match[1] && match[2]) {
        return { file: match[1], message: match[2] };
      }
      return { file: 'unknown', message: msg };
    });

    if (!result.success) {
      const errorResult: ParseResult = {
        status: 'error',
        error: result.errorMessages.join('; '),
      };
      if (fileErrors.length > 0) errorResult.fileErrors = fileErrors;
      return errorResult;
    }

    const parseResult: ParseResult = {
      status: 'complete',
      stats: {
        files: result.stats.files,
        entities: result.stats.entities,
        edges: result.stats.edges,
        durationMs: result.stats.durationMs,
        errors: result.stats.errors,
      },
    };
    if (fileErrors.length > 0) parseResult.fileErrors = fileErrors;

    return parseResult;
  } catch (error) {
    return {
      status: 'error',
      error: toErrorMessage(error),
    };
  }
});

/**
 * Parse a single file
 */
export const parseSingleFile = traced('parseSingleFile', async function parseSingleFile(
  filePath: string,
  options?: { deferEmbeddings?: boolean },
): Promise<{
  success: boolean;
  error?: string;
  entities?: number;
  edges?: number;
}> {
  try {
    const client = await getGraphClient();
    return await indexSingleFile(filePath, undefined, client, undefined, options);
  } catch (error) {
    return {
      success: false,
      error: toErrorMessage(error),
    };
  }
});

/**
 * Remove a file and its entities from the graph
 */
export const removeFileFromGraph = traced('removeFileFromGraph', async function removeFileFromGraph(filePath: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    await codeGraphService.removeFileAndCleanup(filePath);

    logger.debug(`Removed file from graph: ${filePath}`);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: toErrorMessage(error),
    };
  }
});
