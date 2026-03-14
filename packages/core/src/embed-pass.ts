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
  buildVariableEmbeddingText,
  buildFileEmbeddingText,
  generateEmbeddings,
  isEmbeddingAvailable,
  type EmbeddingConfig,
} from '@codegraph/plugin-nlp';
import type { ParsedFileEntities } from '@codegraph/types';
import type { GraphOperations } from '@codegraph/graph';
import { createLogger } from '@codegraph/logger';

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

/** Internal: an entity ready for embedding */
interface EmbeddableItem {
  nodeType: 'File' | 'Function' | 'Class' | 'Interface' | 'Variable' | 'Type' | 'Component';
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

/**
 * Collect all embeddable entities from a ParsedFileEntities result,
 * build their embedding text, and compute text hashes.
 */
function collectEmbeddableItems(parsed: ParsedFileEntities): EmbeddableItem[] {
  const items: EmbeddableItem[] = [];

  // File
  const fileText = buildFileEmbeddingText(parsed.file);
  items.push({
    nodeType: 'File',
    text: fileText,
    textHash: hashText(fileText),
    identifier: { filePath: parsed.file.path },
  });

  // Functions
  for (const fn of parsed.functions) {
    const text = buildFunctionEmbeddingText(fn);
    items.push({
      nodeType: 'Function',
      text,
      textHash: hashText(text),
      identifier: { name: fn.name, filePath: fn.filePath, startLine: fn.startLine },
    });
  }

  // Classes
  for (const cls of parsed.classes) {
    const text = buildClassEmbeddingText(cls);
    items.push({
      nodeType: 'Class',
      text,
      textHash: hashText(text),
      identifier: { name: cls.name, filePath: cls.filePath, startLine: cls.startLine },
    });
  }

  // Interfaces
  for (const iface of parsed.interfaces) {
    const text = buildInterfaceEmbeddingText(iface);
    items.push({
      nodeType: 'Interface',
      text,
      textHash: hashText(text),
      identifier: { name: iface.name, filePath: iface.filePath, startLine: iface.startLine },
    });
  }

  // Variables
  for (const v of parsed.variables) {
    const text = buildVariableEmbeddingText(v);
    items.push({
      nodeType: 'Variable',
      text,
      textHash: hashText(text),
      identifier: { name: v.name, filePath: v.filePath, line: v.line },
    });
  }

  // Types
  for (const t of parsed.types) {
    const text = buildTypeEmbeddingText(t);
    items.push({
      nodeType: 'Type',
      text,
      textHash: hashText(text),
      identifier: { name: t.name, filePath: t.filePath, startLine: t.startLine },
    });
  }

  // Components
  for (const comp of parsed.components) {
    const text = buildComponentEmbeddingText(comp);
    items.push({
      nodeType: 'Component',
      text,
      textHash: hashText(text),
      identifier: { name: comp.name, filePath: comp.filePath, startLine: comp.startLine },
    });
  }

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
  if (item.nodeType === 'File') {
    return `File::${item.identifier['path']}:0`;
  }
  const startLine = item.nodeType === 'Variable'
    ? item.identifier['line']
    : item.identifier['startLine'];
  return `${item.nodeType}:${item.identifier['name']}:${item.identifier['filePath']}:${startLine}`;
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

  logger.info(`Embedding pass: ${allItems.length} entities across ${parsedList.length} files`);

  // 2. Query existing embedding hashes for incremental skip
  const filePaths = parsedList.map(p => p.file.path);
  let existingHashes = new Map<string, string>();
  try {
    existingHashes = await ops.getEmbeddingHashesForFiles(filePaths);
    if (existingHashes.size > 0) {
      logger.info(`Found ${existingHashes.size} existing embedding hashes for comparison`);
    }
  } catch {
    // Non-fatal — will regenerate all
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
