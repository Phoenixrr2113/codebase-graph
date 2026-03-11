/**
 * Parse service - thin orchestrator around @codegraph/core's indexer
 *
 * Delegates file discovery, parsing, and graph persistence to core's
 * indexProject/indexSingleFile. This service adds:
 * - traced() observability wrappers
 * - Post-ingestion analytics hooks
 * - removeFileFromGraph (API-specific)
 */

import type { ParseResult } from '@codegraph/types';
import { indexProject, indexSingleFile, getGraphClient, codeGraphService } from '@codegraph/core';
import { createLogger, traced } from '@codegraph/logger';
import { getAnalyticsService } from './analyticsService';

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
    });

    if (!result.success) {
      return {
        status: 'error',
        error: result.errorMessages.join('; '),
      };
    }

    return {
      status: 'complete',
      stats: {
        files: result.stats.files,
        entities: result.stats.entities,
        edges: result.stats.edges,
        durationMs: result.stats.durationMs,
      },
    };
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown parsing error',
    };
  } finally {
    // Trigger post-ingestion analytics (non-blocking)
    try {
      const analyticsService = getAnalyticsService();
      analyticsService.onIngestionComplete(projectPath).catch(err => {
        logger.warn('Post-ingestion analytics failed:', err);
      });
    } catch {
      // Analytics service not available - ignore
    }
  }
});

/**
 * Parse a single file
 */
export const parseSingleFile = traced('parseSingleFile', async function parseSingleFile(filePath: string): Promise<{
  success: boolean;
  error?: string;
  entities?: number;
  edges?: number;
}> {
  try {
    const client = await getGraphClient();
    return await indexSingleFile(filePath, undefined, client);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
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
    await codeGraphService.deleteFileEntities(filePath);

    logger.debug(`Removed file from graph: ${filePath}`);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});
