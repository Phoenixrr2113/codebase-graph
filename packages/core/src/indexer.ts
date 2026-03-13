/**
 * Core Indexer
 *
 * Uses the internal pipeline module to index projects into the graph.
 * Shared by MCP server, API, and CLI.
 *
 * Performance optimizations:
 * - Incremental indexing: skips unchanged files (hash comparison)
 * - Parallel processing: processes files in concurrent batches
 * - Single file read: content read once, shared between parser and entity creation
 * - Progress logging: reports N/total at intervals
 */

import {
  initParser,
  parseFile,
  parseCode,
  getLanguageForExtension,
  createFileEntityFromContent,
  extractEntitiesForFile,
  buildParsedFileEntities,
  countEntities,
  countEdges,
  SUPPORTED_EXTENSIONS,
  DEFAULT_IGNORE_PATTERNS,
} from './pipeline';
import { createOperations, type GraphClient } from '@codegraph/graph';
import type { ProjectEntity } from '@codegraph/types';
import type { EmbeddingConfig } from '@codegraph/plugin-nlp';
import { getGraphClient } from './graphClient';
import { embedParsedEntities, embedAllParsedEntities } from './embed-pass';
import { createLogger } from '@codegraph/logger';
import { stat, readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { glob } from 'glob';

const logger = createLogger({ namespace: 'Core:Indexer' });

/** Default number of files to process in parallel */
const DEFAULT_CONCURRENCY = 20;

// ============================================================================
// Types
// ============================================================================

export interface IndexStats {
  files: number;
  entities: number;
  edges: number;
  errors: number;
  durationMs: number;
  /** Number of entities that had embeddings generated */
  embedded?: number;
  /** Number of files skipped because they were unchanged */
  skipped?: number;
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
 *
 * Supports incremental indexing (default): only re-parses files whose
 * content hash has changed since the last index. Use `force: true` to
 * re-parse everything.
 *
 * Processes files in parallel batches for speed.
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
    /** Embedding configuration. Set to false to disable embedding generation. */
    embeddings?: EmbeddingConfig | false;
    /** Number of files to process in parallel (default: 20) */
    concurrency?: number;
  } = {},
): Promise<IndexResult> {
  const startTime = Date.now();
  const { deepAnalysis = true, includeExternals = false, force = false } = options;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
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

    // ----------------------------------------------------------------
    // Incremental: build hash map of previously indexed files
    // ----------------------------------------------------------------
    let storedHashes = new Map<string, string>();
    if (!force && existingProject) {
      try {
        const stored = await ops.getProjectFileHashes(project.id);
        storedHashes = new Map(stored.map(f => [f.path, f.hash]));
        logger.info(`Loaded ${storedHashes.size} stored file hashes for incremental comparison`);
      } catch {
        logger.warn('Could not load stored hashes — falling back to full index');
      }
    }

    // ----------------------------------------------------------------
    // Compute content hashes for all files, determine which need processing
    // Read file content once — reuse for both hashing and parsing
    // ----------------------------------------------------------------
    interface FileWithContent {
      path: string;
      content: string;
      mtime: Date;
    }

    const filesToProcess: FileWithContent[] = [];
    let skippedCount = 0;

    // Read files in parallel batches to compute hashes
    for (let i = 0; i < files.length; i += concurrency) {
      const batch = files.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        batch.map(async (filePath) => {
          const [fileStat, content] = await Promise.all([
            stat(filePath),
            readFile(filePath, 'utf-8'),
          ]);
          return { path: filePath, content, mtime: fileStat.mtime };
        }),
      );

      for (const result of results) {
        if (result.status === 'rejected') continue;
        const file = result.value;
        const hash = createHash('sha256').update(file.content).digest('hex').slice(0, 16);
        const storedHash = storedHashes.get(file.path);

        if (!force && storedHash === hash) {
          skippedCount++;
        } else {
          filesToProcess.push(file);
        }
      }
    }

    const hashDurationMs = Date.now() - startTime;
    if (skippedCount > 0) {
      logger.info(`Incremental: ${skippedCount} unchanged, ${filesToProcess.length} to process (hash check: ${hashDurationMs}ms)`);
    }

    // Resolve embedding config (false = disabled, undefined = default)
    const embeddingConfig = options.embeddings === false ? undefined : options.embeddings;
    const embeddingsEnabled = options.embeddings !== false;

    // ----------------------------------------------------------------
    // PERF.10: Two-phase pipeline — parse all, then bulk upsert all
    // Phase 1: Parse files in parallel batches (CPU-bound)
    // Phase 2: Single bulk UNWIND upsert for all entities (I/O-bound)
    // ----------------------------------------------------------------
    let totalEntities = 0;
    let totalEdges = 0;
    let totalFiles = 0;
    let totalErrors = 0;
    let totalEmbedded = 0;
    const totalToProcess = filesToProcess.length;

    // Progress logging interval (every 10% or every 50 files, whichever is smaller)
    const progressInterval = Math.max(1, Math.min(50, Math.floor(totalToProcess / 10)));

    // Phase 1: Parse all files in parallel batches
    type ParsedResult = { file: string; built: ReturnType<typeof buildParsedFileEntities>; extracted: ReturnType<typeof extractEntitiesForFile> };
    const allParsed: ParsedResult[] = [];

    for (let i = 0; i < totalToProcess; i += concurrency) {
      const batch = filesToProcess.slice(i, i + concurrency);

      const parsed = await Promise.allSettled(
        batch.map(async (file) => {
          // Use parseCode with already-loaded content (avoids redundant disk read)
          const ext = extname(file.path);
          const language = getLanguageForExtension(ext);
          if (!language) {
            throw new Error(`Unsupported extension: ${ext}`);
          }
          const syntaxTree = parseCode(file.content, language);
          syntaxTree.filePath = file.path;

          const extracted = extractEntitiesForFile(syntaxTree.rootNode, file.path);
          const fileEntity = createFileEntityFromContent(file.path, file.content, file.mtime);
          const built = buildParsedFileEntities(
            fileEntity,
            extracted,
            syntaxTree.rootNode,
            { deepAnalysis, includeExternals },
            rootPath,
          );
          return { file: file.path, built, extracted };
        }),
      );

      for (let j = 0; j < parsed.length; j++) {
        const result = parsed[j]!;
        if (result.status === 'rejected') {
          totalErrors++;
          const msg = `Failed: ${batch[j]!.path}: ${result.reason instanceof Error ? result.reason.message : result.reason}`;
          errorMessages.push(msg);
          logger.warn(msg);
          continue;
        }
        allParsed.push(result.value);
      }

      // Progress logging for parse phase
      const processed = Math.min(i + concurrency, totalToProcess);
      if (processed % progressInterval === 0 || processed === totalToProcess) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        logger.info(`Parse: ${processed}/${totalToProcess} files (${elapsed}s)`);
      }
    }

    const parseDurationMs = Date.now() - startTime - hashDurationMs;
    logger.info(`Phase 1 (parse) complete: ${allParsed.length} files in ${parseDurationMs}ms`);

    // Phase 2: Bulk upsert ALL entities in chunked UNWIND batches
    // Process in chunks of 500 files to avoid oversized queries
    const UPSERT_CHUNK_SIZE = 500;

    if (allParsed.length > 0) {
      const upsertStart = Date.now();

      for (let i = 0; i < allParsed.length; i += UPSERT_CHUNK_SIZE) {
        const chunk = allParsed.slice(i, i + UPSERT_CHUNK_SIZE);
        try {
          await ops.batchUpsertBulk(chunk.map(r => r.built));
          await ops.linkProjectFiles(project.id, chunk.map(r => r.file));

          for (const { extracted, built } of chunk) {
            totalFiles++;
            totalEntities += 1 + countEntities(extracted);
            totalEdges += countEdges(built) + countEntities(extracted);
          }
        } catch (err) {
          // Fall back to per-file writes for this chunk
          logger.warn(`Bulk write failed for chunk, falling back to per-file: ${err instanceof Error ? err.message : err}`);
          for (const { file, built, extracted } of chunk) {
            try {
              await ops.batchUpsert(built);
              await ops.linkProjectFile(project.id, file);
              totalFiles++;
              totalEntities += 1 + countEntities(extracted);
              totalEdges += countEdges(built) + countEntities(extracted);
            } catch (fileErr) {
              totalErrors++;
              const msg = `Failed write: ${file}: ${fileErr instanceof Error ? fileErr.message : fileErr}`;
              errorMessages.push(msg);
              logger.warn(msg);
            }
          }
        }
      }

      const upsertDurationMs = Date.now() - upsertStart;
      logger.info(`Phase 2 (upsert) complete: ${totalFiles} files in ${upsertDurationMs}ms`);

      // Phase 3: Embeddings (deferred, runs after structure is committed)
      // Uses cross-file batching with incremental hash comparison
      if (embeddingsEnabled) {
        const embedStart = Date.now();
        try {
          const embedResult = await embedAllParsedEntities(
            allParsed.map(r => r.built),
            ops,
            embeddingConfig,
          );
          totalEmbedded = embedResult.embedded;
        } catch (err) {
          logger.warn(`Embedding pass failed: ${err instanceof Error ? err.message : err}`);
        }
        const embedDurationMs = Date.now() - embedStart;
        if (totalEmbedded > 0) {
          logger.info(`Phase 3 (embed) complete: ${totalEmbedded} entities in ${embedDurationMs}ms`);
        }
      }
    }

    // Update project metadata
    project.lastParsed = now;
    project.fileCount = totalFiles + skippedCount;
    await ops.upsertProject(project);

    const durationMs = Date.now() - startTime;
    const skipMsg = skippedCount > 0 ? `, ${skippedCount} skipped (unchanged)` : '';
    const embedMsg = totalEmbedded > 0 ? `, ${totalEmbedded} embedded` : '';
    logger.info(`Indexed ${rootPath}: ${totalFiles} files, ${totalEntities} entities, ${totalEdges} edges${skipMsg}${embedMsg} in ${durationMs}ms`);

    const stats: IndexStats = {
      files: totalFiles,
      entities: totalEntities,
      edges: totalEdges,
      errors: totalErrors,
      durationMs,
    };
    if (totalEmbedded > 0) stats.embedded = totalEmbedded;
    if (skippedCount > 0) stats.skipped = skippedCount;

    return {
      success: true,
      projectId: project.id,
      projectName: project.name,
      stats,
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
  embeddingConfig?: EmbeddingConfig | false,
): Promise<{ success: boolean; entities: number; edges: number; embedded?: number; error?: string }> {
  try {
    await initParser();

    // Read file once, reuse for parsing and entity creation
    const [fileStat, content] = await Promise.all([
      stat(filePath),
      readFile(filePath, 'utf-8'),
    ]);

    const syntaxTree = await parseFile(filePath);
    const extracted = extractEntitiesForFile(syntaxTree.rootNode, filePath);
    const fileEntity = createFileEntityFromContent(filePath, content, fileStat.mtime);
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

    // Embedding pass
    let embedded = 0;
    if (embeddingConfig !== false) {
      try {
        const embedResult = await embedParsedEntities(parsed, ops, embeddingConfig ?? undefined);
        embedded = embedResult.embedded;
      } catch {
        // Non-fatal
      }
    }

    const entityCount = 1 + countEntities(extracted);
    const edgeCount = countEdges(parsed) + countEntities(extracted);

    const result: { success: boolean; entities: number; edges: number; embedded?: number; error?: string } = {
      success: true,
      entities: entityCount,
      edges: edgeCount,
    };
    if (embedded > 0) result.embedded = embedded;
    return result;
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
