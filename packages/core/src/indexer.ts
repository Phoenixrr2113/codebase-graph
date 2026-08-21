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
  registerTier2Languages,
  buildReExportIndex,
  countEntities,
  countEdges,
  isMarkdownFile,
  getSupportedExtensions,
  DEFAULT_IGNORE_PATTERNS,
} from './pipeline';
import { extractReExports, extractLocalExportedNames, type ReExportEntity } from '@codegraph/plugin-typescript';
import { parseMarkdownContent } from '@codegraph/plugin-markdown';
import { createOperations, type GraphClient } from '@codegraph/graph';
import type { ProjectEntity, ExtractedDocumentEntities } from '@codegraph/types';
import type { EmbeddingConfig } from '@codegraph/plugin-nlp';
import { getGraphClient } from './graphClient';
import { loadGitignorePatterns } from './watchService';
import { embedParsedEntities, embedAllParsedEntities } from './embed-pass';
import { syncGitHistory } from './gitSync';
import { createLogger } from '@codegraph/logger';
import { stat, readFile } from 'node:fs/promises';
import { basename, extname, relative, resolve } from 'node:path';
import ignore from 'ignore';
import { randomUUID, createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { glob } from 'glob';

const execFileAsync = promisify(execFile);
const logger = createLogger({ namespace: 'Core:Indexer' });

/** Skip files larger than 512 KB — they stall the parser and are usually generated/bundled */
const MAX_FILE_SIZE_BYTES = 512 * 1024;

/** Default concurrency scales with available CPUs (min 4) */
const DEFAULT_CONCURRENCY = Math.max(4, cpus().length);

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
  /** Number of git commits synced */
  commitsProcessed?: number;
  /** Number of git edges created (MODIFIED_IN, INTRODUCED_IN, DELETED_IN) */
  gitEdges?: number;
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
 * Apply gitignore-style patterns to a list of absolute file paths.
 * Patterns are matched against paths relative to `rootPath`, so files outside
 * `rootPath` are passed through unchanged.
 *
 * Uses the `ignore` package — full gitignore semantics including anchoring,
 * negation, and trailing-slash directory rules. Replaces an earlier
 * substring-based approximation that broke for worktrees living inside
 * directories whose names matched ignore patterns.
 */
export function applyIgnoreFilter(
  files: string[],
  ignorePatterns: string[],
  rootPath: string,
): string[] {
  if (ignorePatterns.length === 0) return files;
  const ig = ignore().add(ignorePatterns);
  return files.filter((f) => {
    const rel = relative(rootPath, f);
    if (rel.startsWith('..') || rel === '') return true;  // outside root — not our business to filter
    return !ig.ignores(rel);
  });
}

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

    return applyIgnoreFilter(files, ignorePatterns, rootPath);
  } catch {
    return null; // Not a git repo or git not available
  }
}

// ============================================================================
// Barrel re-export index (best-effort, batch-index only)
// ============================================================================

/**
 * Cheap heuristic for "this file might contain a barrel re-export"
 * (`export * from '...'`, `export { x } from '...'`, `export { x as y } from
 * '...'`, `export * as ns from '...'`). Deliberately permissive: it also
 * matches plain local exports like `export { x }` (no `from` clause), which
 * extractReExports() itself filters out (it looks for a `from` source), so a
 * false positive here just costs one wasted parse. A false negative would
 * silently break barrel resolution for that file, so the pattern must never
 * be tightened to the point of missing a real `export ... from` statement.
 *
 * Whitespace is not the only thing that can legally sit between `export` and
 * the `*`/`{` it introduces: a line comment or a block comment can too
 * (e.g. `export` followed by a block comment, then `* from './x'`), which a
 * plain `\s+` gap missed entirely. The `(?:...)*` group here explicitly
 * allows any interleaving of whitespace, line comments, and block comments,
 * so nothing that can syntactically appear in that position causes a miss.
 */
export const REEXPORT_HINT_PATTERN = /export(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*(\*|\{)/;

/**
 * The two cross-file lookups the barrel-chain resolver needs, built once per
 * indexProject() run:
 *  - barrelIndex: filePath -> that file's re-export entries (consumed via
 *    `PipelineOptions.barrelIndex`).
 *  - localExportsIndex: filePath -> the names that file exports via a LOCAL
 *    declaration (not a re-export). The resolver needs this as its base
 *    case: a "mixed barrel" (`export * from './x'` plus its own
 *    `export function localOnly() {}`) must stop at its own declaration
 *    instead of following the unrelated star re-export just because the same
 *    file happens to have one.
 */
export interface BarrelResolutionIndexes {
  barrelIndex: Map<string, ReExportEntity[]>;
  localExportsIndex: Map<string, string[]>;
}

/**
 * Build the cross-file barrel-resolution data above. Both indexes are built
 * from `files` (the full discovered set for this project, including files
 * that are not changing this run): a barrel chain can pass through, or land
 * on, a file that did not change.
 *
 * The two indexes deliberately use DIFFERENT candidate scopes:
 *  - Re-exports are only extracted from files that look like they contain
 *    `export ... from` syntax (REEXPORT_HINT_PATTERN), since that is the
 *    only syntax extractReExports() looks for; most files in a real project
 *    never match, so this saves a wasted AST walk for them.
 *  - Local exports are collected for EVERY TypeScript file, not just
 *    hint-matched ones. A chain can terminate at any file, including a
 *    plain origin file with no re-export syntax at all (an aliased
 *    re-export chain, for instance: consumer -> barrel -> origin, where
 *    origin has no `export ... from` and so never matches
 *    REEXPORT_HINT_PATTERN). There is no way to know in advance which files
 *    a chain will land on without already knowing the full barrel graph, so
 *    the only correct scope for local exports is every TypeScript file.
 *    (A regex-only heuristic for enumerating exported NAMES, as opposed to
 *    just detecting re-export syntax, would also be far less reliable than
 *    the real AST-based extractor: there are too many ways to export
 *    something, function/class/const/destructured-const/interface/enum/
 *    source-less `export { x }`, to approximate safely with regex. Given
 *    that a chain's landing file cannot be known ahead of time either way,
 *    correctness rules out narrowing this scope for a performance gain that
 *    would not even be sound.)
 *
 * Every candidate file is parsed once and reused for both extractions when a
 * file needs both (i.e. a mixed barrel). A read or parse failure for one
 * file is logged and that file is skipped from both indexes, never aborting
 * the rest of indexing, since barrel resolution is a best-effort enrichment
 * layered on top of already-correct (if less complete) call resolution.
 */
export async function buildBarrelResolutionIndexes(
  files: string[],
  concurrency: number,
): Promise<BarrelResolutionIndexes> {
  const candidates = files.filter((f) => getLanguageForExtension(extname(f)) === 'typescript');
  const reExportEntries: Array<{ filePath: string; reExports: ReExportEntity[] }> = [];
  const localExportsIndex = new Map<string, string[]>();

  for (let i = 0; i < candidates.length; i += concurrency) {
    const batch = candidates.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (filePath) => {
        const content = await readFile(filePath, 'utf-8');
        const syntaxTree = parseCode(content, 'typescript', extname(filePath));
        const localNames = extractLocalExportedNames(syntaxTree.rootNode, filePath);
        const reExports = REEXPORT_HINT_PATTERN.test(content)
          ? extractReExports(syntaxTree.rootNode, filePath)
          : [];
        return { filePath, localNames, reExports };
      }),
    );

    for (let j = 0; j < results.length; j++) {
      const result = results[j]!;
      if (result.status === 'rejected') {
        const msg = `Barrel pre-pass: failed to scan ${batch[j]}: ${result.reason instanceof Error ? result.reason.message : result.reason}`;
        logger.warn(msg);
        continue;
      }
      const { filePath, localNames, reExports } = result.value;
      if (localNames.length > 0) localExportsIndex.set(filePath, localNames);
      reExportEntries.push({ filePath, reExports });
    }
  }

  return { barrelIndex: buildReExportIndex(reExportEntries), localExportsIndex };
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
    /** Sync git commit history into the graph (default: true). Set false for fixtures inside an unrelated repo. */
    gitSync?: boolean;
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

    // Register language plugins + initialize parser. Tier-2 languages (Ruby,
    // Kotlin, Swift, C, C++, ...) must be registered before file discovery
    // below: getSupportedExtensions() only returns extensions for languages
    // already in the registry, so skipping this call means tier-2 source
    // files are never even discovered, let alone parsed.
    registerPlugins();
    await initParser();
    await registerTier2Languages();

    // Discover source files (git ls-files when available, glob fallback)
    const gitignorePatterns = await loadGitignorePatterns(rootPath);
    const ignoreList = [...DEFAULT_IGNORE_PATTERNS, ...(options.ignorePatterns ?? []), ...gitignorePatterns];
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
    // Persist the Project node now, before any file processing.
    // linkProjectFiles() MATCHes the Project by id, so if the node doesn't
    // exist yet (brand-new project, or right after deleteProject() clears it
    // below) the MATCH silently finds nothing and no HAS_FILE edges get
    // created. The final upsertProject() call further down still runs, to
    // persist fileCount/lastParsed once those are known.
    await ops.upsertProject(project);

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

    // Barrel re-export index and local-exports index (best-effort): let
    // buildParsedFileEntities() below resolve a callee reached through a
    // barrel to its origin file instead of the barrel (which has no
    // matching Function node, silently dropping the CALLS edge), and stop
    // at a file that locally declares the name being chased instead of
    // following an unrelated re-export from the same (mixed-barrel) file.
    // Built from the full discovered file set, not just codeFiles, since a
    // barrel chain can pass through, or land on, an unchanged file. Only
    // worth building when there is at least one file about to be parsed
    // this run.
    const { barrelIndex, localExportsIndex } = codeFiles.length > 0
      ? await buildBarrelResolutionIndexes(files, concurrency)
      : { barrelIndex: new Map<string, ReExportEntity[]>(), localExportsIndex: new Map<string, string[]>() };
    if (barrelIndex.size > 0) {
      logger.info(`Barrel re-export index: ${barrelIndex.size} files with re-exports`);
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
    // Re-create the project node after clear. deleteProject() above DETACH
    // DELETEs it, so it must exist again before the chunk loop below calls
    // linkProjectFiles(), or every HAS_FILE edge silently fails to attach.
    if (useCreatePath) {
      project.createdAt = now;
      await ops.upsertProject(project);
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
          // Incremental: clean up old entities before re-upserting.
          // removeFileContents() detaches CONTAINS edges and deletes orphaned
          // entities that have no incoming cross-file edges, preventing stale
          // nodes when functions move lines or get deleted. Unlike
          // removeFileAndCleanup(), it leaves the File node itself (and its
          // MODIFIED_IN / HAS_FILE / EXPORTS edges) untouched, since this
          // file's content changed, it was not deleted from disk. The
          // upsertBulk call below then updates that same File node in place
          // (MERGE), instead of a fresh node replacing a deleted one.
          await Promise.all(chunk.map(r => ops.removeFileContents(r.file)));
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
            { deepAnalysis, includeExternals, barrelIndex, localExportsIndex },
            rootPath,
          );
          // Skip non-exported variables — they're disconnected noise (62% of graph, zero edges)
          built.variables = built.variables.filter(v => v.isExported);
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

    // Git history sync — creates Commit nodes and temporal edges
    let commitsProcessed = 0;
    let gitEdges = 0;
    if (options.gitSync !== false) try {
      const gitResult = await syncGitHistory(rootPath, graphClient, {
        maxCommits: 200,
        includeStats: true,
      });
      commitsProcessed = gitResult.commitsProcessed;
      gitEdges = gitResult.edgesCreated;
      if (commitsProcessed > 0) {
        logger.info(`Git sync: ${commitsProcessed} commits, ${gitEdges} edges in ${gitResult.durationMs}ms`);
      }
      if (gitResult.errors.length > 0) {
        logger.warn(`Git sync warnings: ${gitResult.errors.length} errors`);
      }
    } catch (err) {
      logger.warn(`Git sync failed (non-fatal): ${err instanceof Error ? err.message : err}`);
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
    if (commitsProcessed > 0) stats.commitsProcessed = commitsProcessed;
    if (gitEdges > 0) stats.gitEdges = gitEdges;

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

    // Register language plugins + initialize parser (tier-2 too, so a
    // single-file re-index of e.g. a .rb or .kt file resolves correctly)
    registerPlugins();
    await initParser();
    await registerTier2Languages();

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
    // No barrelIndex here (accepted limitation, not a bug): resolving a
    // callee through a barrel re-export chain requires every project file's
    // re-exports to already be known (see buildBarrelResolutionIndexes() in
    // indexProject()). A single-file reindex has no sibling files in memory,
    // so a callee reached through a barrel stays unresolved to the barrel
    // file here, same as before barrel resolution existed; a subsequent
    // full/incremental indexProject() run resolves it correctly.
    const parsed = buildParsedFileEntities(
      fileEntity,
      extracted,
      syntaxTree.rootNode,
      { deepAnalysis: true },
      projectRoot,
    );
    // Skip non-exported variables
    parsed.variables = parsed.variables.filter(v => v.isExported);

    // Clean up old entities before re-upserting (prevents stale nodes when
    // code moves/deletes). This path re-indexes a file whose content
    // changed (see onFileChanged in the watcher integrations) -- it was not
    // deleted from disk, so use removeFileContents() rather than
    // removeFileAndCleanup(), which would destroy this File node's
    // MODIFIED_IN / HAS_FILE / EXPORTS edges along with it. True deletions
    // go through removeFileAndCleanup() directly, from onFileRemoved.
    await ops.removeFileContents(filePath);
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
