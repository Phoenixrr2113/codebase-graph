/**
 * Parse service - orchestrates parsing and graph persistence
 *
 * Core extraction logic (entity extraction, complexity, edge building) lives
 * in @codegraph/parser's pipeline module. This service is a thin orchestrator
 * that handles file discovery, Project node management, and graph persistence.
 */

import type { ParseResult, ParseStats, ProjectEntity } from '@codegraph/types';
import {
  initParser,
  parseFile,
  parseFiles,
  createFileEntity,
  extractEntitiesForFile,
  buildParsedFileEntities,
  countEntities,
  countEdges,
  SUPPORTED_EXTENSIONS,
  DEFAULT_IGNORE_PATTERNS,
} from '@codegraph/parser';
import { createClient, createOperations, type GraphOperations } from '@codegraph/graph';
import { createLogger, traced } from '@codegraph/logger';
import fastGlob from 'fast-glob';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getAnalyticsService } from './analyticsService';

const logger = createLogger({ namespace: 'API:Parse' });

/** Singleton graph operations instance */
let graphOps: GraphOperations | null = null;

/**
 * Get or create graph operations instance
 */
const getGraphOps = traced('getGraphOps', async function getGraphOps(): Promise<GraphOperations> {
  if (!graphOps) {
    const client = await createClient();
    graphOps = createOperations(client);
  }
  return graphOps;
});

/** Parse options for deep analysis (re-exported from parser as PipelineOptions) */
export interface ParseOptions {
  deepAnalysis?: boolean;
  includeExternals?: boolean;
}

export const parseProject = traced('parseProject', async function parseProject(
  projectPath: string,
  ignorePatterns: string[] = [],
  options: ParseOptions = {}
): Promise<ParseResult> {
  const startTime = Date.now();

  try {
    // Verify project path exists and is a directory
    const pathStat = await stat(projectPath);
    if (!pathStat.isDirectory()) {
      return {
        status: 'error',
        error: `Path is not a directory: ${projectPath}`,
      };
    }

    // Initialize parser
    await initParser();

    // Find all source files
    const patterns = SUPPORTED_EXTENSIONS.map(ext => `**/*${ext}`);
    const ignoreList = [...DEFAULT_IGNORE_PATTERNS, ...ignorePatterns];

    const files = await fastGlob(patterns, {
      cwd: projectPath,
      absolute: true,
      ignore: ignoreList,
      onlyFiles: true,
    });

    if (files.length === 0) {
      return {
        status: 'complete',
        stats: {
          files: 0,
          entities: 0,
          edges: 0,
          durationMs: Date.now() - startTime,
        },
      };
    }

    // Parse all files
    const results = await parseFiles(files);

    // Count successful parses
    const successCount = results.filter(r => r.tree).length;
    const errorCount = results.filter(r => r.error).length;

    // Get graph operations
    const ops = await getGraphOps();

    // Create or update project entity
    const now = new Date().toISOString();
    let existingProject = await ops.getProjectByRoot(projectPath);
    const project: ProjectEntity = existingProject ?? {
      id: randomUUID(),
      name: basename(projectPath),
      rootPath: projectPath,
      createdAt: now,
      lastParsed: now,
      fileCount: successCount,
    };
    project.lastParsed = now;
    project.fileCount = successCount;
    await ops.upsertProject(project);

    // Track totals
    let totalEntities = 0;
    let totalEdges = 0;

    // Process each successfully parsed file
    for (const result of results) {
      if (result.tree) {
        try {
          // Extract entities from syntax tree (language-aware)
          const extracted = extractEntitiesForFile(result.tree.rootNode, result.filePath);

          // Create file entity
          const fileEntity = await createFileEntity(result.filePath);

          // Build full parsed file structure (pass rootNode for deep analysis)
          const parsed = buildParsedFileEntities(fileEntity, extracted, result.tree.rootNode, options, projectPath);

          // Persist to graph database
          await ops.batchUpsert(parsed);

          // Link file to project
          await ops.linkProjectFile(project.id, result.filePath);

          // Update counts (add 1 for the file entity itself)
          totalEntities += 1 + countEntities(extracted);
          totalEdges += countEdges(parsed) + countEntities(extracted); // CONTAINS edges
        } catch (err) {
          logger.error(`Failed to persist ${result.filePath}:`, err);
        }
      }
    }

    const stats: ParseStats = {
      files: successCount,
      entities: totalEntities,
      edges: totalEdges,
      durationMs: Date.now() - startTime,
    };

    if (errorCount > 0) {
      logger.warn(`${errorCount} files failed to parse`);
    }

    logger.info(`Completed: ${successCount} files, ${totalEntities} entities, ${totalEdges} edges in ${stats.durationMs}ms`);

    return {
      status: 'complete',
      stats,
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
    await initParser();
    const tree = await parseFile(filePath);

    // Extract entities from syntax tree
    const extracted = extractEntitiesForFile(tree.rootNode, filePath);

    // Create file entity
    const fileEntity = await createFileEntity(filePath);

    // Build full parsed file structure
    const parsed = buildParsedFileEntities(fileEntity, extracted);

    // Get graph operations and persist
    const ops = await getGraphOps();
    await ops.batchUpsert(parsed);

    // Calculate counts
    const entityCount = 1 + countEntities(extracted); // +1 for file
    const edgeCount = countEdges(parsed) + countEntities(extracted); // CONTAINS edges

    logger.debug(`File ${filePath}: ${entityCount} entities, ${edgeCount} edges`);

    return {
      success: true,
      entities: entityCount,
      edges: edgeCount,
    };
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
    const ops = await getGraphOps();
    await ops.deleteFileEntities(filePath);

    logger.debug(`Removed file from graph: ${filePath}`);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});
