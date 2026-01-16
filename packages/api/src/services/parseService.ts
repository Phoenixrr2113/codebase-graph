/**
 * Parse service - orchestrates parsing and graph persistence
 */

import type { ParseResult, ParseStats, FileEntity } from '@codegraph/types';
import { initParser, parseFile, parseFiles, extractAllEntities, type ExtractedEntities } from '@codegraph/parser';
import { createClient, createOperations, type ParsedFileEntities, type GraphOperations } from '@codegraph/graph';
import { createLogger, traced } from '@codegraph/logger';
import fastGlob from 'fast-glob';
import { stat, readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { createHash } from 'node:crypto';

const logger = createLogger({ namespace: 'API:Parse' });

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

/**
 * Create a FileEntity from file metadata
 */
const createFileEntity = traced('createFileEntity', async function createFileEntity(filePath: string): Promise<FileEntity> {
  const fileStat = await stat(filePath);
  const content = await readFile(filePath, 'utf-8');
  const loc = content.split('\n').length;
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);

  return {
    path: filePath,
    name: basename(filePath),
    extension: extname(filePath).slice(1), // Remove leading dot
    loc,
    lastModified: fileStat.mtime.toISOString(),
    hash,
  };
});

/**
 * Build ParsedFileEntities from extracted entities
 */
function buildParsedFileEntities(
  file: FileEntity,
  extracted: ExtractedEntities
): ParsedFileEntities {
  // Build import edges from import entities
  const importsEdges = extracted.imports
    .filter((imp) => imp.resolvedPath)
    .map((imp) => ({
      fromFilePath: file.path,
      toFilePath: imp.resolvedPath!,
      specifiers: imp.specifiers.map((s) => s.name),
    }));

  // Build extends edges from classes
  const extendsEdges = extracted.classes
    .filter((cls) => cls.extends)
    .map((cls) => ({
      childId: `Class:${cls.filePath}:${cls.name}:${cls.startLine}`,
      parentId: `Class:${cls.extends}`, // Parent may not have full path
    }));

  // Build implements edges from classes
  const implementsEdges = extracted.classes.flatMap((cls) =>
    (cls.implements ?? []).map((ifaceName) => ({
      classId: `Class:${cls.filePath}:${cls.name}:${cls.startLine}`,
      interfaceId: `Interface:${ifaceName}`,
    }))
  );

  return {
    file,
    functions: extracted.functions,
    classes: extracted.classes,
    interfaces: extracted.interfaces,
    variables: extracted.variables,
    types: extracted.types,
    components: extracted.components,
    imports: extracted.imports,
    callEdges: [], // Call analysis requires cross-file resolution - future enhancement
    importsEdges,
    extendsEdges,
    implementsEdges,
    rendersEdges: [], // Render analysis requires JSX traversal - future enhancement
  };
}

/**
 * Count total entities in extracted result
 */
function countEntities(extracted: ExtractedEntities): number {
  return (
    extracted.imports.length +
    extracted.functions.length +
    extracted.classes.length +
    extracted.variables.length +
    extracted.types.length +
    extracted.interfaces.length +
    extracted.components.length
  );
}

/**
 * Count total edges in parsed file entities
 */
function countEdges(parsed: ParsedFileEntities): number {
  return (
    parsed.callEdges.length +
    parsed.importsEdges.length +
    parsed.extendsEdges.length +
    parsed.implementsEdges.length +
    parsed.rendersEdges.length
  );
}

export const parseProject = traced('parseProject', async function parseProject(
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

    // Get graph operations
    const ops = await getGraphOps();

    // Track totals
    let totalEntities = 0;
    let totalEdges = 0;

    // Process each successfully parsed file
    for (const result of results) {
      if (result.tree) {
        try {
          // Extract entities from syntax tree
          const extracted = extractAllEntities(result.tree.rootNode, result.filePath);

          // Create file entity
          const fileEntity = await createFileEntity(result.filePath);

          // Build full parsed file structure
          const parsed = buildParsedFileEntities(fileEntity, extracted);

          // Persist to graph database
          await ops.batchUpsert(parsed);

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
    const extracted = extractAllEntities(tree.rootNode, filePath);

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
