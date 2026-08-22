/**
 * Embedding Pass — generates and stores embeddings for parsed entities.
 *
 * Called after entity extraction + upsert in the indexing pipeline.
 * Collects all entities from a ParsedFileEntities, builds embedding texts
 * via the type-specific text builders, batch-generates embeddings via the
 * two-tier embedding utility, and updates each node in the graph.
 *
 * Graceful degradation: if embedding is unavailable (no model, no API key),
 * the pass silently returns zero results. The rest of the pipeline is unaffected.
 */

import { createHash } from 'node:crypto';
import {
  buildFunctionEmbeddingText,
  buildClassEmbeddingText,
  buildInterfaceEmbeddingText,
  buildComponentEmbeddingText,
  buildTypeEmbeddingText,
  generateEmbeddings,
  isEmbeddingAvailable,
  type EmbeddingConfig,
} from '@codegraph/plugin-nlp';
import type { ParsedFileEntities } from '@codegraph/types';
import type { GraphClient, GraphOperations, QueryOptions, QueryResult } from '@codegraph/graph';
import { createLogger } from '@codegraph/logger';
import { embedAllNodes, type EmbedNodesResult } from './embed-nodes';

const logger = createLogger({ namespace: 'Core:EmbedPass' });

// ============================================================================
// Types
// ============================================================================

export interface EmbedPassResult {
  /** Number of entities successfully embedded */
  embedded: number;
  /** Number of entities skipped (errors or unchanged) */
  skipped: number;
  /** Duration of the embedding pass in milliseconds */
  durationMs: number;
}

export type EmbeddingPassScope =
  | { type: 'global' }
  | { type: 'project'; projectId: string; rootPath: string };

export interface EmbeddingPassState {
  running: boolean;
  scope: EmbeddingPassScope | null;
  startedAt: string | null;
}

export interface ScheduleEmbeddingPassOptions {
  client: GraphClient;
  force?: boolean;
  projectId?: string;
  rootPath?: string;
  /** Work that must settle before the remaining-node pass starts. */
  after?: Promise<unknown>;
}

/** Internal: an entity ready for embedding */
interface EmbeddableItem {
  nodeType: 'Function' | 'Class' | 'Interface' | 'Type' | 'Component';
  text: string;
  textHash: string;
  identifier: Record<string, unknown>;
}

// ============================================================================
// Helpers
// ============================================================================

function hashText(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

const EMBEDDABLE_MATCH = /MATCH \(([A-Za-z_][A-Za-z0-9_]*):(File|Function|Class|Interface|Variable|Type|Component)\)/;

function normalizeProjectRoot(rootPath: string): string {
  return rootPath.replace(/\/+$/, '') || '/';
}

/**
 * Restrict embedAllNodes() reads to one project without changing its write
 * behavior. Updates still target the stable identifiers returned by these
 * scoped reads.
 */
function createProjectScopedClient(client: GraphClient, rootPath: string): GraphClient {
  const projectPath = normalizeProjectRoot(rootPath);
  const projectPathPrefix = projectPath === '/' ? '/' : `${projectPath}/`;

  return {
    graph: client.graph,
    graphName: client.graphName,
    dialect: client.dialect,
    query<T>(cypher: string, options?: QueryOptions): Promise<QueryResult<T>> {
      return client.query<T>(cypher, options);
    },
    roQuery<T>(cypher: string, options?: QueryOptions): Promise<QueryResult<T>> {
      const match = EMBEDDABLE_MATCH.exec(cypher);
      if (!match) {
        throw new Error('Cannot scope an embedding query without an embeddable node match');
      }
      const variable = match[1]!;
      const pathFilter = `(${variable}.filePath = $projectPath OR ${variable}.filePath STARTS WITH $projectPathPrefix)`;
      const scopedCypher = cypher.includes('WHERE')
        ? cypher.replace('WHERE', `WHERE ${pathFilter} AND`)
        : cypher.replace(match[0], `${match[0]}\n    WHERE ${pathFilter}`);
      return client.roQuery<T>(scopedCypher, {
        ...options,
        params: {
          ...(options?.params ?? {}),
          projectPath,
          projectPathPrefix,
        },
      });
    },
    ensureIndexes(options?: { embeddingDim?: number }): Promise<void> {
      return client.ensureIndexes(options);
    },
    close(): Promise<void> {
      return client.close();
    },
  };
}

const scheduledPasses = new Map<string, Promise<EmbedNodesResult>>();
const scheduledPassStates = new Map<string, { key: string; scope: EmbeddingPassScope; startedAt: string }>();
let passTail: Promise<void> = Promise.resolve();
let activePass: { key: string; scope: EmbeddingPassScope; startedAt: string } | null = null;

/**
 * Schedule one serialized remaining-node pass. Calls for the same scope share
 * one promise, so post-index continuation and a concurrent Generate request
 * cannot perform duplicate work.
 */
export function scheduleEmbeddingPass(
  options: ScheduleEmbeddingPassOptions,
): Promise<EmbedNodesResult> {
  if ((options.projectId === undefined) !== (options.rootPath === undefined)) {
    return Promise.reject(new Error('projectId and rootPath must be provided together'));
  }

  const key = options.projectId ?? 'global';
  const existing = scheduledPasses.get(key);
  if (existing) return existing;

  const scope: EmbeddingPassScope = options.projectId && options.rootPath
    ? {
        type: 'project',
        projectId: options.projectId,
        rootPath: normalizeProjectRoot(options.rootPath),
      }
    : { type: 'global' };
  const scheduledState = { key, scope, startedAt: new Date().toISOString() };
  scheduledPassStates.set(key, scheduledState);

  const run = passTail
    .catch(() => undefined)
    .then(async () => {
      activePass = scheduledState;

      if (options.after) {
        try {
          await options.after;
        } catch (error) {
          logger.warn(`Initial embedding work failed before continuation: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      const passClient = scope.type === 'project'
        ? createProjectScopedClient(options.client, scope.rootPath)
        : options.client;
      return embedAllNodes({
        client: passClient,
        force: options.force ?? false,
      });
    })
    .catch((error: unknown) => {
      logger.warn(`Embedding continuation failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    })
    .finally(() => {
      if (activePass?.key === key) activePass = null;
      scheduledPasses.delete(key);
      scheduledPassStates.delete(key);
    });

  scheduledPasses.set(key, run);
  passTail = run.then(() => undefined, () => undefined);
  return run;
}

/** Return the active pass relevant to a global or project-scoped status call. */
export function getEmbeddingPassState(projectId?: string): EmbeddingPassState {
  const projectPass = projectId === undefined ? undefined : scheduledPassStates.get(projectId);
  const globalPass = scheduledPassStates.get('global');
  const relevant = projectPass ?? globalPass ?? (
    projectId === undefined ? activePass ?? scheduledPassStates.values().next().value : undefined
  ) ?? null;

  return relevant
    ? { running: true, scope: relevant.scope, startedAt: relevant.startedAt }
    : { running: false, scope: null, startedAt: null };
}

/** Track filtered entity counts for logging */
let _lastFilterStats = { total: 0, kept: 0, skippedFiles: 0, skippedVars: 0, skippedTypes: 0, skippedFns: 0 };
export function getLastFilterStats() { return _lastFilterStats; }

/**
 * Collect embeddable entities from a ParsedFileEntities result,
 * build their embedding text, and compute text hashes.
 *
 * Filters out low-value entities that add noise without semantic depth:
 * - Files: "index.ts TypeScript file 42 lines" has no semantic content
 * - Variables: "const MAX_RETRIES: number" has zero semantic depth
 * - Types without docstrings: "type Props" adds nothing
 * - Trivial functions: <3 lines, no docstring, no body snippet
 */
function collectEmbeddableItems(parsed: ParsedFileEntities): EmbeddableItem[] {
  const items: EmbeddableItem[] = [];
  let skippedFiles = 0, skippedVars = 0, skippedTypes = 0, skippedFns = 0;

  // Skip Files entirely — "index.ts TypeScript file 42 lines" has no semantic content
  skippedFiles = 1;

  // Functions — skip trivial ones (<3 lines, no docstring, no body snippet)
  for (const fn of parsed.functions) {
    const lineCount = fn.endLine - fn.startLine + 1;
    if (lineCount < 3 && !fn.docstring && !fn.bodySnippet) {
      skippedFns++;
      continue;
    }
    const text = buildFunctionEmbeddingText(fn);
    items.push({
      nodeType: 'Function',
      text,
      textHash: hashText(text),
      identifier: { id: fn.id },
    });
  }

  // Classes — always embed (they have rich semantic content)
  for (const cls of parsed.classes) {
    const text = buildClassEmbeddingText(cls);
    items.push({
      nodeType: 'Class',
      text,
      textHash: hashText(text),
      identifier: { id: cls.id },
    });
  }

  // Interfaces — always embed
  for (const iface of parsed.interfaces) {
    const text = buildInterfaceEmbeddingText(iface);
    items.push({
      nodeType: 'Interface',
      text,
      textHash: hashText(text),
      identifier: { id: iface.id },
    });
  }

  // Skip Variables entirely — "const MAX_RETRIES: number" has zero semantic depth
  skippedVars = parsed.variables.length;

  // Types — only embed if they have docstrings (bare type aliases add noise to vector search)
  for (const t of parsed.types) {
    if (!t.docstring) {
      skippedTypes++;
      continue;
    }
    const text = buildTypeEmbeddingText(t);
    items.push({
      nodeType: 'Type',
      text,
      textHash: hashText(text),
      identifier: { id: t.id },
    });
  }

  // Components — always embed (they have props, structure)
  for (const comp of parsed.components) {
    const text = buildComponentEmbeddingText(comp);
    items.push({
      nodeType: 'Component',
      text,
      textHash: hashText(text),
      identifier: { id: comp.id },
    });
  }

  // Update filter stats for logging
  _lastFilterStats = {
    total: 1 + parsed.functions.length + parsed.classes.length + parsed.interfaces.length +
           parsed.variables.length + parsed.types.length + parsed.components.length,
    kept: items.length,
    skippedFiles,
    skippedVars,
    skippedTypes,
    skippedFns,
  };

  return items;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Generate and store embeddings for all entities in a ParsedFileEntities.
 *
 * Call this after `ops.batchUpsert(parsed)` — entities must exist in the
 * graph before their embeddings can be updated.
 *
 * Gracefully returns zero results if embeddings are unavailable.
 */
export async function embedParsedEntities(
  parsed: ParsedFileEntities,
  ops: GraphOperations,
  config?: EmbeddingConfig,
): Promise<EmbedPassResult> {
  const start = performance.now();

  if (!isEmbeddingAvailable(config)) {
    return { embedded: 0, skipped: 0, durationMs: 0 };
  }

  const items = collectEmbeddableItems(parsed);
  if (items.length === 0) {
    return { embedded: 0, skipped: 0, durationMs: 0 };
  }

  // Batch generate embeddings for all texts
  const texts = items.map((item) => item.text);
  let embeddings: number[][];
  try {
    const result = await generateEmbeddings(texts, config);
    embeddings = result.embeddings;
  } catch (err) {
    logger.warn(`Embedding generation failed for ${parsed.file.path}: ${err}`);
    return { embedded: 0, skipped: items.length, durationMs: performance.now() - start };
  }

  // Batch update all embeddings using UNWIND (7 queries max instead of N)
  let embedded = 0;
  const batchItems = items.map((item, i) => ({
    nodeType: item.nodeType,
    identifier: item.identifier,
    embedding: embeddings[i]!,
    embeddingTextHash: item.textHash,
  }));

  try {
    embedded = await ops.batchUpdateEmbeddings(batchItems);
  } catch (err) {
    // Fall back to individual writes
    logger.warn(`Batch embedding update failed, falling back to individual: ${err}`);
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      const embedding = embeddings[i]!;
      try {
        await ops.updateEmbedding(item.nodeType, item.identifier, embedding, item.textHash);
        embedded++;
      } catch (writeErr) {
        logger.warn(`Failed to update embedding for ${item.nodeType}: ${writeErr}`);
      }
    }
  }

  const durationMs = performance.now() - start;
  if (embedded > 0) {
    logger.debug(`Embedded ${embedded}/${items.length} entities for ${parsed.file.path} in ${durationMs.toFixed(0)}ms`);
  }

  return { embedded, skipped: items.length - embedded, durationMs };
}

// ============================================================================
// Bulk cross-file embedding (PERF.3 + PERF.9)
// ============================================================================

/**
 * Build a cache key for an embeddable item (matches the format used by getEmbeddingHashesForFiles).
 */
function itemCacheKey(item: EmbeddableItem): string {
  const id = item.identifier['id'];
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`Missing persisted id for ${item.nodeType} embedding`);
  }
  return id;
}

/**
 * Generate and store embeddings for ALL entities across multiple ParsedFileEntities.
 *
 * Improvements over per-file embedParsedEntities:
 * 1. Incremental: queries existing embeddingTextHash values, skips unchanged entities
 * 2. Cross-file batching: one generateEmbeddings call for all entities
 * 3. One batchUpdateEmbeddings call for all results (7 UNWIND queries total)
 *
 * Call this after all entities are upserted to the graph.
 */
export async function embedAllParsedEntities(
  parsedList: ParsedFileEntities[],
  ops: GraphOperations,
  config?: EmbeddingConfig,
  preloadedHashes?: Map<string, string>,
): Promise<EmbedPassResult> {
  const start = performance.now();

  if (!isEmbeddingAvailable(config)) {
    return { embedded: 0, skipped: 0, durationMs: 0 };
  }

  // 1. Collect all embeddable items across all files
  const allItems: EmbeddableItem[] = [];
  for (const parsed of parsedList) {
    allItems.push(...collectEmbeddableItems(parsed));
  }

  if (allItems.length === 0) {
    return { embedded: 0, skipped: 0, durationMs: 0 };
  }

  // Log how many entities were filtered out
  const stats = getLastFilterStats();
  const totalBeforeFilter = stats.total;
  logger.info(`Embedding pass: ${allItems.length} entities to embed across ${parsedList.length} files (filtered from ~${totalBeforeFilter * parsedList.length / Math.max(parsedList.length, 1)} per-file total; skipped: Files, Variables, ${stats.skippedTypes} docstring-less Types, ${stats.skippedFns} trivial Functions)`);

  // 2. Query existing embedding hashes for incremental skip
  // preloadedHashes allows callers to snapshot hashes before clearing the graph (full reindex)
  let existingHashes: Map<string, string>;
  if (preloadedHashes && preloadedHashes.size > 0) {
    existingHashes = preloadedHashes;
    logger.info(`Using ${existingHashes.size} preloaded embedding hashes for comparison`);
  } else {
    existingHashes = new Map();
    const filePaths = parsedList.map(p => p.file.path);
    try {
      existingHashes = await ops.getEmbeddingHashesForFiles(filePaths);
      if (existingHashes.size > 0) {
        logger.info(`Found ${existingHashes.size} existing embedding hashes for comparison`);
      }
    } catch {
      // Non-fatal — will regenerate all
    }
  }

  // 3. Filter out unchanged entities
  const itemsToEmbed: EmbeddableItem[] = [];
  let skippedUnchanged = 0;
  for (const item of allItems) {
    const key = itemCacheKey(item);
    const existing = existingHashes.get(key);
    if (existing === item.textHash) {
      skippedUnchanged++;
    } else {
      itemsToEmbed.push(item);
    }
  }

  if (skippedUnchanged > 0) {
    logger.info(`Incremental embedding: ${skippedUnchanged} unchanged, ${itemsToEmbed.length} to generate`);
  }

  if (itemsToEmbed.length === 0) {
    const durationMs = performance.now() - start;
    return { embedded: 0, skipped: skippedUnchanged, durationMs };
  }

  // 4. Generate embeddings for all texts in one batch
  const texts = itemsToEmbed.map(item => item.text);
  let embeddings: number[][];
  try {
    const genStart = performance.now();
    const result = await generateEmbeddings(texts, config);
    embeddings = result.embeddings;
    const genMs = (performance.now() - genStart).toFixed(0);
    logger.info(`Generated ${embeddings.length} embeddings in ${genMs}ms (${(Number(genMs) / embeddings.length).toFixed(1)}ms/entity)`);
  } catch (err) {
    logger.warn(`Embedding generation failed: ${err}`);
    return { embedded: 0, skipped: allItems.length, durationMs: performance.now() - start };
  }

  // 5. Batch write all embeddings using UNWIND
  let embedded = 0;
  const batchItems = itemsToEmbed.map((item, i) => ({
    nodeType: item.nodeType,
    identifier: item.identifier,
    embedding: embeddings[i]!,
    embeddingTextHash: item.textHash,
  }));

  try {
    embedded = await ops.batchUpdateEmbeddings(batchItems);
  } catch (err) {
    logger.warn(`Batch embedding write failed, falling back to individual: ${err}`);
    for (let i = 0; i < itemsToEmbed.length; i++) {
      const item = itemsToEmbed[i]!;
      const embedding = embeddings[i]!;
      try {
        await ops.updateEmbedding(item.nodeType, item.identifier, embedding, item.textHash);
        embedded++;
      } catch (writeErr) {
        logger.warn(`Failed to update embedding for ${item.nodeType}: ${writeErr}`);
      }
    }
  }

  const durationMs = performance.now() - start;
  logger.info(`Embedding pass complete: ${embedded} embedded, ${skippedUnchanged} skipped in ${durationMs.toFixed(0)}ms`);

  return { embedded, skipped: skippedUnchanged + (itemsToEmbed.length - embedded), durationMs };
}
