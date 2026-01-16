/**
 * Parse service - orchestrates parsing and graph persistence
 */

import type { ParseResult, ParseStats } from '@codegraph/types';
import { initParser, parseFile, parseFiles } from '@codegraph/parser';
import fastGlob from 'fast-glob';
import { stat } from 'node:fs/promises';

/** Default glob patterns to ignore during parsing */
const DEFAULT_IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/coverage/**',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/__tests__/**',
  '**/__mocks__/**',
  '**/.next/**',
  '**/.turbo/**',
];

/** Supported file extensions */
const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];

/**
 * Parse a project directory
 */
export async function parseProject(
  projectPath: string,
  ignorePatterns: string[] = []
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

    // TODO: Once graph package exports are updated, persist to FalkorDB
    // For now, we just return parsing stats
    // const graphClient = await createClient();
    // const ops = createOperations(graphClient);
    // for (const result of results) {
    //   if (result.tree) {
    //     await ops.batchUpsert(extractEntities(result.tree));
    //   }
    // }

    const stats: ParseStats = {
      files: successCount,
      entities: 0, // Will be populated when graph integration is complete
      edges: 0,
      durationMs: Date.now() - startTime,
    };

    if (errorCount > 0) {
      console.warn(`[Parse] ${errorCount} files failed to parse`);
    }

    return {
      status: 'complete',
      stats,
    };
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown parsing error',
    };
  }
}

/**
 * Parse a single file
 */
export async function parseSingleFile(filePath: string): Promise<{
  success: boolean;
  error?: string;
  entities?: number;
  edges?: number;
}> {
  try {
    await initParser();
    await parseFile(filePath);

    // TODO: Extract entities and persist to graph
    // const entities = extractEntities(tree);
    // const graphClient = await createClient();
    // const ops = createOperations(graphClient);
    // await ops.batchUpsert({ filePath, entities });

    return {
      success: true,
      entities: 0, // Will be populated when extractors are complete
      edges: 0,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Remove a file and its entities from the graph
 */
export async function removeFileFromGraph(_filePath: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    // TODO: Delete from graph once exports are available
    // const graphClient = await createClient();
    // const ops = createOperations(graphClient);
    // await ops.deleteFileEntities(filePath);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
