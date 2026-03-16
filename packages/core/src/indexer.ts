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
  registerPlugins,
  countEntities,
  countEdges,
  isMarkdownFile,
  getSupportedExtensions,
  DEFAULT_IGNORE_PATTERNS,
} from './pipeline';
import { parseMarkdownContent } from '@codegraph/plugin-markdown';
import { createOperations, type GraphClient } from '@codegraph/graph';
import type { ProjectEntity, ExtractedDocumentEntities } from '@codegraph/types';
import type { EmbeddingConfig } from '@codegraph/plugin-nlp';
import { getGraphClient } from './graphClient';
import { embedParsedEntities, embedAllParsedEntities } from './embed-pass';
import { createLogger } from '@codegraph/logger';
import { stat, readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { glob } from 'glob';

const execFileAsync = promisify(execFile);
const logger = createLogger({ namespace: 'Core:Indexer' });

/** Skip files larger than 512 KB — they stall the parser and are usually generated/bundled */
const MAX_FILE_SIZE_BYTES = 512 * 1024;

/** Default concurrency scales with available CPUs (min 4) */
const DEFAULT_CONCURRENCY = Math.max(4, availableParallelism());

// ============================================================================
// Embedding backpressure — bounded concurrency for deferred embeddings
// ============================================================================

/** Max concurrent deferred embedding operations */
const MAX_DEFERRED_EMBEDDINGS = 4;
let activeEmbeddings = 0;
const embeddingQueue: Array<() => void> = [];

/** Acquire a slot; resolves when one is available */
function acquireEmbeddingSlot(): Promise<void> {
  if (activeEmbeddings < MAX_DEFERRED_EMBEDDINGS) {
    activeEmbeddings++;
    return Promise.resolve();
  }
  return new Promise<void>(resolve => {
    embeddingQueue.push(resolve);
  });
}

/** Release a slot, unblocking the next queued job */
function releaseEmbeddingSlot(): void {
  const next = embeddingQueue.shift();
  if (next) {
    // Transfer the slot to the next waiter (activeEmbeddings stays the same)
    next();
  } else {
    activeEmbeddings--;
  }
}

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
// File Discovery
// ============================================================================

/**
 * Discover source files using git ls-files (faster than glob, respects .gitignore).
 * Returns null if not a git repo or git is unavailable — caller should fall back to glob.
 */
async function discoverFilesGit(
  rootPath: string,
  extensions: string[],
  ignorePatterns: string[],
): Promise<string[] | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard'],
      { cwd: rootPath, maxBuffer: 50 * 1024 * 1024 },
    );

    const extensionSet = new Set(extensions.map(e => e.startsWith('.') ? e : `.${e}`));
    const files = stdout
      .split('\n')
      .filter(f => f.length > 0)
      .filter(f => extensionSet.has(extname(f).toLowerCase()))
      .map(f => resolve(rootPath, f));

    // Apply ignore patterns as simple substring/glob checks
    if (ignorePatterns.length > 0) {
      const ignoreSegments = ignorePatterns
        .map(p => p.replace(/\*\*/g, '').replace(/\*/g, '').replace(/\//g, ''))
        .filter(s => s.length > 0);
      return files.filter(f => !ignoreSegments.some(seg => f.includes(seg)));
    }

    return files;
  } catch {
    return null; // Not a git repo or git not available
  }
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
    /** Run embedding pass in background without blocking index return (default: false) */
    deferEmbeddings?: boolean;
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

    // Register language plugins + initialize parser
    registerPlugins();
    await initParser();

    // Discover source files (git ls-files when available, glob fallback)
    const ignoreList = [...DEFAULT_IGNORE_PATTERNS, ...(options.ignorePatterns ?? [])];
    let files: string[];

    if (options.includePatterns) {
      // Custom patterns — use glob directly
      files = await glob(options.includePatterns, {
        cwd: rootPath,
        ignore: ignoreList,
        absolute: true,
      });
    } else {
      // Try git ls-files first (faster, respects .gitignore natively)
      const gitFiles = await discoverFilesGit(rootPath, getSupportedExtensions(), ignoreList);
      if (gitFiles) {
        files = gitFiles;
        logger.info(`File discovery via git: ${files.length} files`);
      } else {
        const patterns = getSupportedExtensions().map(ext => `**/*${ext}`);
        files = await glob(patterns, {
          cwd: rootPath,
          ignore: ignoreList,
          absolute: true,
        });
      }
    }

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
    // Ensure schema/indexes exist before any writes (also pre-creates labels
    // to prevent FalkorDB #1240 crash on concurrent label introduction)
    await graphClient.ensureIndexes();
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
          const fileStat = await stat(filePath);
          // Skip oversized files (generated code, bundles, etc.)
          if (fileStat.size > MAX_FILE_SIZE_BYTES) {
            return null; // sentinel — filtered out below
          }
          const content = await readFile(filePath, 'utf-8');
          return { path: filePath, content, mtime: fileStat.mtime };
        }),
      );

      for (const result of results) {
        if (result.status === 'rejected') continue;
        const file = result.value;
        if (!file) { skippedCount++; continue; } // oversized file
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
    // Pipelined index: parse batch N while upserting batch N-1
    // Overlaps CPU-bound parsing with I/O-bound graph writes
    // ----------------------------------------------------------------
    let totalEntities = 0;
    let totalEdges = 0;
    let totalFiles = 0;
    let totalErrors = 0;
    let totalEmbedded = 0;
    const totalToProcess = filesToProcess.length;

    // Progress logging interval (every 10% or every 50 files, whichever is smaller)
    const progressInterval = Math.max(1, Math.min(50, Math.floor(totalToProcess / 10)));

    // Separate markdown files from code files — they use different parsers
    const codeFiles: FileWithContent[] = [];
    const markdownFiles: FileWithContent[] = [];
    for (const file of filesToProcess) {
      if (isMarkdownFile(file.path)) {
        markdownFiles.push(file);
      } else {
        codeFiles.push(file);
      }
    }
    if (markdownFiles.length > 0) {
      logger.info(`Split: ${codeFiles.length} code files, ${markdownFiles.length} markdown files`);
    }

    // Full reindex optimization: clear project data first, then use CREATE (much faster than MERGE)
    const useCreatePath = force;
    let savedEmbeddingHashes: Map<string, string> | undefined;
    if (useCreatePath && existingProject) {
      // Snapshot embedding hashes BEFORE clearing — allows skipping unchanged embeddings
      try {
        const allFilePaths = filesToProcess.map(f => f.path);
        savedEmbeddingHashes = await ops.getEmbeddingHashesForFiles(allFilePaths);
        if (savedEmbeddingHashes.size > 0) {
          logger.info(`Saved ${savedEmbeddingHashes.size} embedding hashes before clear`);
        }
      } catch {
        // Non-fatal — will regenerate all embeddings
      }
      logger.info('Full reindex: clearing existing project data for fast CREATE path');
      await ops.deleteProject(existingProject.id);
    }
    // Re-create the project node after clear
    if (useCreatePath) {
      project.createdAt = now;
    }

    // Pipelined parse + upsert for code files
    type ParsedResult = { file: string; built: ReturnType<typeof buildParsedFileEntities>; extracted: ReturnType<typeof extractEntitiesForFile> };
    const allParsed: ParsedResult[] = []; // Accumulated for embedding phase

    // Write a chunk of parsed results — uses CREATE (fast) or MERGE (incremental)
    const upsertChunk = async (chunk: ParsedResult[]): Promise<void> => {
      try {
        if (useCreatePath) {
          await ops.batchCreateBulk(chunk.map(r => r.built));
        } else {
          await ops.batchUpsertBulk(chunk.map(r => r.built));
        }
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
    };

    // Pipeline: parse batch N while upserting batch N-1
    let pendingUpsert: Promise<void> | null = null;
    let pendingBatch: ParsedResult[] = [];
    const UPSERT_CHUNK_SIZE = 50;

    for (let i = 0; i < codeFiles.length; i += concurrency) {
      const batch = codeFiles.slice(i, i + concurrency);

      const parsed = await Promise.allSettled(
        batch.map(async (file) => {
          const ext = extname(file.path);
          const language = getLanguageForExtension(ext);
          if (!language) {
            throw new Error(`Unsupported extension: ${ext}`);
          }
          const syntaxTree = parseCode(file.content, language, ext);
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

      // Collect successfully parsed results
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
        pendingBatch.push(result.value);
      }

      // When pending batch reaches upsert chunk size, fire upsert (with backpressure)
      if (pendingBatch.length >= UPSERT_CHUNK_SIZE) {
        if (pendingUpsert) await pendingUpsert; // Backpressure: wait for previous upsert
        const chunk = pendingBatch;
        pendingBatch = [];
        pendingUpsert = upsertChunk(chunk);
      }

      // Progress logging
      const processed = Math.min(i + concurrency, codeFiles.length);
      if (processed % progressInterval === 0 || processed === codeFiles.length) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        logger.info(`Pipeline: ${processed}/${codeFiles.length} parsed (${elapsed}s)`);
      }
    }

    // Flush remaining parsed results
    if (pendingUpsert) await pendingUpsert;
    if (pendingBatch.length > 0) {
      await upsertChunk(pendingBatch);
      pendingBatch = [];
    }

    // Parse markdown files (typically few, no pipeline needed)
    const allDocuments: ExtractedDocumentEntities[] = [];

    for (let i = 0; i < markdownFiles.length; i += concurrency) {
      const batch = markdownFiles.slice(i, i + concurrency);

      const parsed = await Promise.allSettled(
        batch.map(async (file) => {
          return parseMarkdownContent(file.content, file.path);
        }),
      );

      for (let j = 0; j < parsed.length; j++) {
        const result = parsed[j]!;
        if (result.status === 'rejected') {
          totalErrors++;
          const msg = `Failed (md): ${batch[j]!.path}: ${result.reason instanceof Error ? result.reason.message : result.reason}`;
          errorMessages.push(msg);
          logger.warn(msg);
          continue;
        }
        allDocuments.push(result.value);
      }
    }

    if (markdownFiles.length > 0) {
      logger.info(`Parse (markdown): ${allDocuments.length}/${markdownFiles.length} documents`);
    }

    const parseDurationMs = Date.now() - startTime - hashDurationMs;
    logger.info(`Pipeline complete: ${allParsed.length} code + ${allDocuments.length} docs in ${parseDurationMs}ms`);

    // Upsert document entities (markdown)
    if (allDocuments.length > 0) {
      try {
        await ops.batchUpsertDocuments(allDocuments);
        totalFiles += allDocuments.length;
        for (const doc of allDocuments) {
          totalEntities += 1 + doc.sections.length + doc.codeBlocks.length + doc.links.length;
          totalEdges += doc.sections.length + doc.codeBlocks.length + doc.links.length;
        }
      } catch (err) {
        logger.warn(`Document bulk write failed: ${err instanceof Error ? err.message : err}`);
        totalErrors += allDocuments.length;
      }
    }

    // Embeddings (runs after all structure is committed)
    if (allParsed.length > 0 && embeddingsEnabled) {
      const builtList = allParsed.map(r => r.built);

      if (options.deferEmbeddings) {
        // Fire-and-forget: graph structure is searchable immediately
        embedAllParsedEntities(builtList, ops, embeddingConfig, savedEmbeddingHashes)
          .then(result => {
            if (result.embedded > 0) {
              logger.info(`Background embedding complete: ${result.embedded} entities in ${result.durationMs.toFixed(0)}ms`);
            }
          })
          .catch(err => {
            logger.warn(`Background embedding failed: ${err instanceof Error ? err.message : err}`);
          });
      } else {
        const embedStart = Date.now();
        try {
          const embedResult = await embedAllParsedEntities(builtList, ops, embeddingConfig, savedEmbeddingHashes);
          totalEmbedded = embedResult.embedded;
        } catch (err) {
          logger.warn(`Embedding pass failed: ${err instanceof Error ? err.message : err}`);
        }
        const embedDurationMs = Date.now() - embedStart;
        if (totalEmbedded > 0) {
          logger.info(`Embed complete: ${totalEmbedded} entities in ${embedDurationMs}ms`);
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
 *
 * When `deferEmbeddings` is true, the graph structure is updated immediately
 * (fast path, <500ms) and embeddings are generated in the background (slow path).
 * This enables responsive real-time indexing during file watching.
 */
export async function indexSingleFile(
  filePath: string,
  projectRoot?: string,
  client?: GraphClient,
  embeddingConfig?: EmbeddingConfig | false,
  options?: { deferEmbeddings?: boolean },
): Promise<{ success: boolean; entities: number; edges: number; embedded?: number; error?: string }> {
  try {
    const graphClient = client ?? await getGraphClient();
    const ops = createOperations(graphClient);

    // Markdown files use a different parser (remark/unified, not tree-sitter)
    if (isMarkdownFile(filePath)) {
      const content = await readFile(filePath, 'utf-8');
      const docEntities = await parseMarkdownContent(content, filePath);
      await ops.batchUpsertDocuments([docEntities]);

      const entityCount = 1 + docEntities.sections.length + docEntities.codeBlocks.length + docEntities.links.length;
      const edgeCount = docEntities.sections.length + docEntities.codeBlocks.length + docEntities.links.length;
      return { success: true, entities: entityCount, edges: edgeCount };
    }

    // Register language plugins + initialize parser
    registerPlugins();
    await initParser();

    // Read file once, reuse for parsing and entity creation
    const [fileStat, content] = await Promise.all([
      stat(filePath),
      readFile(filePath, 'utf-8'),
    ]);

    // Skip oversized files
    if (fileStat.size > MAX_FILE_SIZE_BYTES) {
      return { success: true, entities: 0, edges: 0, error: `Skipped: file too large (${(fileStat.size / 1024).toFixed(0)} KB)` };
    }

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

    await ops.batchUpsert(parsed);

    // Embedding pass — deferred (background) or blocking
    let embedded = 0;
    if (embeddingConfig !== false) {
      if (options?.deferEmbeddings) {
        // Bounded fire-and-forget: graph structure is searchable immediately,
        // embeddings run in background with backpressure (max MAX_DEFERRED_EMBEDDINGS concurrent)
        acquireEmbeddingSlot()
          .then(() => embedParsedEntities(parsed, ops, embeddingConfig ?? undefined))
          .then(result => {
            releaseEmbeddingSlot();
            logger.debug('Deferred embeddings complete', { filePath, embedded: result.embedded });
          })
          .catch(err => {
            releaseEmbeddingSlot();
            logger.warn('Deferred embedding failed', { filePath, error: err instanceof Error ? err.message : String(err) });
          });
      } else {
        try {
          const embedResult = await embedParsedEntities(parsed, ops, embeddingConfig ?? undefined);
          embedded = embedResult.embedded;
        } catch {
          // Non-fatal
        }
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
