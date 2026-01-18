/**
 * Parse service - orchestrates parsing and graph persistence
 */

import type { ParseResult, ParseStats, FileEntity, ProjectEntity } from '@codegraph/types';
import { initParser, parseFile, parseFiles, extractAllEntities, extractCalls, extractRenders, extractInheritance, type ExtractedEntities } from '@codegraph/parser';
import {
  extractFunctions as extractPythonFunctions,
  extractClasses as extractPythonClasses,
  extractImports as extractPythonImports,
  extractVariables as extractPythonVariables,
  extractInheritance as extractPythonInheritance,
  extractCalls as extractPythonCalls,
  resolvePythonImport,
} from '@codegraph/plugin-python';
import type Parser from 'tree-sitter';
import { createClient, createOperations, type ParsedFileEntities, type GraphOperations } from '@codegraph/graph';
import { createLogger, traced } from '@codegraph/logger';
import fastGlob from 'fast-glob';
import { stat, readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

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
  '**/__pycache__/**',
  '**/.venv/**',
  '**/venv/**',
  '**/*.pyc',
];

/** Supported file extensions */
const SUPPORTED_EXTENSIONS = [
  // TypeScript/JavaScript
  '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs',
  // Python
  '.py', '.pyw', '.pyi',
];

/** Python file extensions */
const PYTHON_EXTENSIONS = ['.py', '.pyw', '.pyi'];

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

/** Parse options for deep analysis */
export interface ParseOptions {
  deepAnalysis?: boolean;
  includeExternals?: boolean;
}

/**
 * Check if file is a Python file
 */
function isPythonFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return PYTHON_EXTENSIONS.includes(ext);
}

/**
 * Extract entities from a file based on its language
 * Uses TypeScript extractors for TS/JS files, Python extractors for .py files
 */
function extractEntitiesForFile(rootNode: Parser.SyntaxNode, filePath: string): ExtractedEntities {
  if (isPythonFile(filePath)) {
    // Use Python extractors - note: Python doesn't have interfaces, types, or components
    return {
      functions: extractPythonFunctions(rootNode as any, filePath),
      classes: extractPythonClasses(rootNode as any, filePath),
      variables: extractPythonVariables(rootNode as any, filePath),
      imports: extractPythonImports(rootNode as any, filePath),
      interfaces: [], // Not applicable for Python
      types: [], // Not applicable for Python
      components: [], // Not applicable for Python
    };
  }

  // Use TypeScript/JavaScript extractors
  return extractAllEntities(rootNode, filePath);
}

/**
 * Build ParsedFileEntities from extracted entities
 */
function buildParsedFileEntities(
  file: FileEntity,
  extracted: ExtractedEntities,
  rootNode?: Parser.SyntaxNode,
  options: ParseOptions = {},
  projectRoot?: string
): ParsedFileEntities {
  const { deepAnalysis = false, includeExternals = false } = options;

  // Build import edges from import entities
  let importsEdges: { fromFilePath: string; toFilePath: string; specifiers: string[] }[] = [];

  if (isPythonFile(file.path) && projectRoot) {
    // Python: Resolve module names to file paths
    for (const imp of extracted.imports) {
      const resolvedPath = resolvePythonImport(imp.source, file.path, projectRoot);
      if (resolvedPath) {
        importsEdges.push({
          fromFilePath: file.path,
          toFilePath: resolvedPath,
          specifiers: imp.specifiers.map((s) => s.name),
        });
      }
    }

  } else {
    // TypeScript/JavaScript: Use resolvedPath from parser
    importsEdges = extracted.imports
      .filter((imp) => imp.resolvedPath)
      .map((imp) => ({
        fromFilePath: file.path,
        toFilePath: imp.resolvedPath!,
        specifiers: imp.specifiers.map((s) => s.name),
      }));
  }

  // Build extends/implements edges
  let extendsEdges: { childId: string; parentId: string }[] = [];
  let implementsEdges: { classId: string; interfaceId: string }[] = [];

  if (isPythonFile(file.path)) {
    // Python: Use plugin's extractInheritance  
    const inheritanceRefs = extractPythonInheritance(rootNode as any, file.path);

    for (const ref of inheritanceRefs) {
      const cls = extracted.classes.find(c => c.name === ref.childName);
      if (cls) {
        extendsEdges.push({
          childId: `Class:${file.path}:${cls.name}:${cls.startLine}`,
          parentId: `Class:external:${ref.parentName}`,
        });
      }
    }
  } else {
    // TypeScript/JavaScript: Use full inheritance extraction with import resolution
    const inheritance = extractInheritance(
      file.path,
      extracted.classes,
      extracted.interfaces,
      extracted.imports,
      includeExternals
    );

    extendsEdges = inheritance.extends.map((ext) => ({
      childId: `Class:${ext.childFilePath}:${ext.childName}:${ext.childStartLine}`,
      parentId: ext.parentFilePath
        ? `Class:${ext.parentFilePath}:${ext.parentName}`
        : `Class:external:${ext.parentName}`,
    }));

    implementsEdges = inheritance.implements.map((impl) => ({
      classId: `Class:${impl.classFilePath}:${impl.className}:${impl.classStartLine}`,
      interfaceId: impl.interfaceFilePath
        ? `Interface:${impl.interfaceFilePath}:${impl.interfaceName}`
        : `Interface:external:${impl.interfaceName}`,
    }));
  }

  // Build call edges (only if deep analysis enabled and we have rootNode)
  let callEdges: ParsedFileEntities['callEdges'] = [];
  if (deepAnalysis && rootNode) {
    if (isPythonFile(file.path)) {
      // Python: Use plugin's extractCalls
      const pythonCalls = extractPythonCalls(rootNode as unknown as import('@codegraph/types').SyntaxNode, file.path);
      callEdges = pythonCalls.map((call) => ({
        callerId: `Function:${call.filePath}:${call.callerName}`,
        calleeId: `Function:${call.filePath}:${call.calleeName}`,
        line: call.line,
      }));
    } else {
    // TypeScript/JavaScript
      logger.debug(`[Deep Analysis] Extracting calls for ${file.path}`);
      const calls = extractCalls(
        rootNode,
        file.path,
        extracted.functions,
        extracted.imports,
        includeExternals
      );
      logger.debug(`[Deep Analysis] Found ${calls.length} call references in ${file.path}`);
      callEdges = calls.map((call) => ({
        callerId: `Function:${call.callerFilePath}:${call.callerName}`,
        calleeId: call.calleeFilePath
          ? `Function:${call.calleeFilePath}:${call.calleeName}`
          : `Function:external:${call.calleeName}`,
        line: call.line,
      }));
    }
  }

  // Build render edges (only if deep analysis enabled and we have rootNode)
  let rendersEdges: ParsedFileEntities['rendersEdges'] = [];
  if (deepAnalysis && rootNode) {
    const renders = extractRenders(
      rootNode,
      file.path,
      extracted.components,
      extracted.imports,
      includeExternals
    );
    rendersEdges = renders.map((render) => ({
      parentId: `Component:${render.parentFilePath}:${render.parentName}`,
      childId: render.childFilePath
        ? `Component:${render.childFilePath}:${render.childName}`
        : `Component:external:${render.childName}`,
      line: render.line,
    }));
  }

  return {
    file,
    functions: extracted.functions,
    classes: extracted.classes,
    interfaces: extracted.interfaces,
    variables: extracted.variables,
    types: extracted.types,
    components: extracted.components,
    imports: extracted.imports,
    callEdges,
    importsEdges,
    extendsEdges,
    implementsEdges,
    rendersEdges,
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
