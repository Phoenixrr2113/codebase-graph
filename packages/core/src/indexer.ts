/**
 * Core Indexer
 *
 * Uses the internal pipeline module to index projects into the graph.
 * Shared by MCP server, API, and CLI.
 */

import {
  initParser,
  parseFile,
  createFileEntity,
  extractEntitiesForFile,
  buildParsedFileEntities,
  countEntities,
  countEdges,
  SUPPORTED_EXTENSIONS,
  DEFAULT_IGNORE_PATTERNS,
} from './pipeline';
import { createOperations, type GraphClient } from '@codegraph/graph';
import type { ProjectEntity } from '@codegraph/types';
import { getGraphClient } from './graphClient';
import { createLogger } from '@codegraph/logger';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { glob } from 'glob';

const logger = createLogger({ namespace: 'Core:Indexer' });

// ============================================================================
// Types
// ============================================================================

export interface IndexStats {
  files: number;
  entities: number;
  edges: number;
  errors: number;
  durationMs: number;
}

export interface IndexResult {
  success: boolean;
  projectId: string;
  projectName: string;
  stats: IndexStats;
  errorMessages: string[];
}

// ============================================================================
// Index a full project
// ============================================================================

/**
 * Index a project directory into the graph.
 * Creates/updates the Project node, parses all source files,
 * extracts entities + edges, and persists via batchUpsert.
 */
export async function indexProject(
  rootPath: string,
  options: {
    /** Re-parse all files even if hashes match (default: false) */
    force?: boolean;
    /** Enable deep analysis for call/render edges (default: true) */
    deepAnalysis?: boolean;
    /** Include external library references (default: false) */
    includeExternals?: boolean;
    /** Additional ignore patterns (merged with DEFAULT_IGNORE_PATTERNS) */
    ignorePatterns?: string[];
    /** Custom include patterns (overrides SUPPORTED_EXTENSIONS-based globs) */
    includePatterns?: string[];
    /** Use this client instead of the shared singleton */
    client?: GraphClient;
  } = {},
): Promise<IndexResult> {
  const startTime = Date.now();
  const { deepAnalysis = true, includeExternals = false } = options;
  const errorMessages: string[] = [];

  try {
    // Verify path is a directory
    const pathStat = await stat(rootPath);
    if (!pathStat.isDirectory()) {
      return {
        success: false,
        projectId: '',
        projectName: basename(rootPath),
        stats: { files: 0, entities: 0, edges: 0, errors: 1, durationMs: Date.now() - startTime },
        errorMessages: [`Path is not a directory: ${rootPath}`],
      };
    }

    // Initialize parser
    await initParser();

    // Discover source files
    const patterns = options.includePatterns ?? SUPPORTED_EXTENSIONS.map(ext => `**/*${ext}`);
    const ignoreList = [...DEFAULT_IGNORE_PATTERNS, ...(options.ignorePatterns ?? [])];
    const files = await glob(patterns, {
      cwd: rootPath,
      ignore: ignoreList,
      absolute: true,
    });

    logger.info(`Indexing ${rootPath}: found ${files.length} source files`);

    if (files.length === 0) {
      return {
        success: true,
        projectId: '',
        projectName: basename(rootPath),
        stats: { files: 0, entities: 0, edges: 0, errors: 0, durationMs: Date.now() - startTime },
        errorMessages: [],
      };
    }

    // Get graph operations
    const graphClient = options.client ?? await getGraphClient();
    const ops = createOperations(graphClient);

    // Create or update Project node
    const now = new Date().toISOString();
    const existingProject = await ops.getProjectByRoot(rootPath);
    const project: ProjectEntity = existingProject ?? {
      id: randomUUID(),
      name: basename(rootPath),
      rootPath,
      createdAt: now,
      lastParsed: now,
      fileCount: 0,
    };

    let totalEntities = 0;
    let totalEdges = 0;
    let totalFiles = 0;
    let totalErrors = 0;

    // Parse and persist each file
    for (const file of files) {
      try {
        const syntaxTree = await parseFile(file);
        const extracted = extractEntitiesForFile(syntaxTree.rootNode, file);
        const fileEntity = await createFileEntity(file);
        const parsed = buildParsedFileEntities(
          fileEntity,
          extracted,
          syntaxTree.rootNode,
          { deepAnalysis, includeExternals },
          rootPath,
        );

        await ops.batchUpsert(parsed);
        await ops.linkProjectFile(project.id, file);

        totalFiles++;
        totalEntities += 1 + countEntities(extracted);
        totalEdges += countEdges(parsed) + countEntities(extracted);
      } catch (err) {
        totalErrors++;
        const msg = `Failed: ${file}: ${err instanceof Error ? err.message : err}`;
        errorMessages.push(msg);
        logger.warn(msg);
      }
    }

    // Update project metadata
    project.lastParsed = now;
    project.fileCount = totalFiles;
    await ops.upsertProject(project);

    const durationMs = Date.now() - startTime;
    logger.info(`Indexed ${rootPath}: ${totalFiles} files, ${totalEntities} entities, ${totalEdges} edges in ${durationMs}ms`);

    return {
      success: true,
      projectId: project.id,
      projectName: project.name,
      stats: {
        files: totalFiles,
        entities: totalEntities,
        edges: totalEdges,
        errors: totalErrors,
        durationMs,
      },
      errorMessages,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error during indexing';
    errorMessages.push(msg);
    return {
      success: false,
      projectId: '',
      projectName: basename(rootPath),
      stats: { files: 0, entities: 0, edges: 0, errors: 1, durationMs: Date.now() - startTime },
      errorMessages,
    };
  }
}

// ============================================================================
// Index a single file
// ============================================================================

/**
 * Re-index a single file in the graph.
 */
export async function indexSingleFile(
  filePath: string,
  projectRoot?: string,
  client?: GraphClient,
): Promise<{ success: boolean; entities: number; edges: number; error?: string }> {
  try {
    await initParser();
    const syntaxTree = await parseFile(filePath);
    const extracted = extractEntitiesForFile(syntaxTree.rootNode, filePath);
    const fileEntity = await createFileEntity(filePath);
    const parsed = buildParsedFileEntities(
      fileEntity,
      extracted,
      syntaxTree.rootNode,
      { deepAnalysis: true },
      projectRoot,
    );

    const graphClient = client ?? await getGraphClient();
    const ops = createOperations(graphClient);
    await ops.batchUpsert(parsed);

    const entityCount = 1 + countEntities(extracted);
    const edgeCount = countEdges(parsed) + countEntities(extracted);

    return { success: true, entities: entityCount, edges: edgeCount };
  } catch (err) {
    return {
      success: false,
      entities: 0,
      edges: 0,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Check if a project needs indexing
// ============================================================================

/**
 * Check if a project root path is already indexed in the graph.
 */
export async function isProjectIndexed(rootPath: string): Promise<boolean> {
  try {
    const client = await getGraphClient();
    const ops = createOperations(client);
    const project = await ops.getProjectByRoot(rootPath);
    return project !== null && project !== undefined;
  } catch {
    return false;
  }
}
