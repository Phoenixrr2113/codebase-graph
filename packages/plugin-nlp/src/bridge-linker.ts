/**
 * Bridge Linker — auto-creates ABOUT edges from knowledge entities to code graph nodes.
 *
 * Two linking strategies:
 *
 * 1. Name matching (linkEntitiesToCode):
 *    Runs at NLP extraction time. Checks entity text against code symbol names.
 *    Three tiers: exact (1.0), case-insensitive (0.95), contained (0.9).
 *
 * 2. Embedding similarity (linkByEmbedding):
 *    Batch/CLI mode. For entities that didn't match by name, generates embeddings
 *    and does vector search against code node HNSW indexes. Catches semantic
 *    matches like "payment retry bug" → retryWithBackoff().
 *
 * Usage:
 *   // Name matching (at extraction time)
 *   const linked = await linkEntitiesToCode(extractedEntities, client, kgOps);
 *
 *   // Embedding similarity (batch, CLI)
 *   const result = await linkByEmbedding(client, kgOps, { threshold: 0.8 });
 *   console.log(`Linked ${result.linked} entities via embedding similarity`);
 */

import type { GraphClient } from '@codegraph/graph';
import type { KnowledgeOperations, AboutEdgeInput } from '@codegraph/graph';
import { createOperations } from '@codegraph/graph';
import { createLogger } from '@codegraph/logger';
import { generateEmbedding, isEmbeddingAvailable } from './embeddings';
import { buildEntityEmbeddingText } from './embedding-text';

const logger = createLogger({ namespace: 'nlp:bridge-linker' });

// ============================================================================
// Types
// ============================================================================

export interface BridgeLinkerInput {
  /** Entity text (from NLP extraction) */
  text: string;
  /** Entity type (from NLP extraction, e.g., 'CodeEntity', 'Technology', 'Concept') */
  type: string;
}

export interface BridgeLinkResult {
  /** Total entities considered */
  total: number;
  /** Number of ABOUT edges created */
  linked: number;
  /** Number of entities skipped (no code match) */
  skipped: number;
  /** Details of each link created */
  links: Array<{
    entityText: string;
    entityType: string;
    targetLabel: string;
    targetValue: string;
    confidence: number;
  }>;
}

export interface BridgeLinkerConfig {
  /** Minimum confidence for creating a link (default: 0.85) */
  minConfidence?: number;
  /** Whether to skip Person/Organization entity types (default: true) */
  skipNonCodeTypes?: boolean;
  /** Maximum number of code nodes to query per batch (default: 500) */
  batchLimit?: number;
}

/** Entity types that are unlikely to match code symbols */
const NON_CODE_ENTITY_TYPES = new Set([
  'Person',
  'Organization',
  'Location',
  'Event',
  'Date',
]);

/** Code node labels we can link to, mapped to their identifying property */
const CODE_NODE_LABELS: Record<string, string> = {
  Function: 'name',
  Class: 'name',
  Interface: 'name',
  Component: 'name',
  Type: 'name',
  Variable: 'name',
  File: 'path',
};

// ============================================================================
// Code Symbol Index (batch-loaded from graph)
// ============================================================================

interface CodeSymbol {
  label: string;
  name: string;       // the identifying value (name for most, path for File)
  nameLower: string;   // lowercase for case-insensitive matching
}

/**
 * Load all code symbol names from the graph in a single batch query.
 * Returns a flat array of { label, name, nameLower }.
 */
async function loadCodeSymbols(
  client: GraphClient,
  limit: number,
): Promise<CodeSymbol[]> {
  const symbols: CodeSymbol[] = [];

  // Query each node label — FalkorDB requires explicit label in MATCH
  const labelQueries: Array<{ label: string; cypher: string }> = [
    { label: 'Function', cypher: `MATCH (n:Function) RETURN n.name AS name LIMIT ${limit}` },
    { label: 'Class', cypher: `MATCH (n:Class) RETURN n.name AS name LIMIT ${limit}` },
    { label: 'Interface', cypher: `MATCH (n:Interface) RETURN n.name AS name LIMIT ${limit}` },
    { label: 'Component', cypher: `MATCH (n:Component) RETURN n.name AS name LIMIT ${limit}` },
    { label: 'Type', cypher: `MATCH (n:Type) RETURN n.name AS name LIMIT ${limit}` },
    { label: 'Variable', cypher: `MATCH (n:Variable) RETURN n.name AS name LIMIT ${limit}` },
    { label: 'File', cypher: `MATCH (n:File) RETURN n.path AS name LIMIT ${limit}` },
  ];

  for (const { label, cypher } of labelQueries) {
    try {
      const result = await client.roQuery<{ name: string }>(cypher, { params: {} });
      for (const row of result.data) {
        if (row.name) {
          symbols.push({
            label,
            name: row.name,
            nameLower: row.name.toLowerCase(),
          });
        }
      }
    } catch {
      // Label might not have any nodes yet — that's fine
      logger.debug(`No ${label} nodes found in graph (or label not created)`);
    }
  }

  logger.debug(`Loaded ${symbols.length} code symbols from graph`);
  return symbols;
}

// ============================================================================
// Matching Logic
// ============================================================================

interface Match {
  symbol: CodeSymbol;
  confidence: number;
}

/**
 * Find the best matching code symbol for an entity text.
 *
 * Returns the highest-confidence match, or null if none found.
 * Priority: exact > case-insensitive > contained.
 */
function findBestMatch(
  entityText: string,
  symbols: CodeSymbol[],
  minConfidence: number,
): Match | null {
  const textLower = entityText.toLowerCase();
  let bestMatch: Match | null = null;

  for (const sym of symbols) {
    let confidence = 0;

    // Tier 1: Exact match
    if (entityText === sym.name) {
      confidence = 1.0;
    }
    // Tier 2: Case-insensitive match
    else if (textLower === sym.nameLower) {
      confidence = 0.95;
    }
    // Tier 3: Contained match (entity text contains symbol name, or vice versa)
    // Only match if the symbol name is at least 3 chars (avoid matching 'a', 'b', etc.)
    else if (sym.name.length >= 3) {
      if (textLower.includes(sym.nameLower) || sym.nameLower.includes(textLower)) {
        confidence = 0.9;
      }
    }

    if (confidence >= minConfidence && (!bestMatch || confidence > bestMatch.confidence)) {
      bestMatch = { symbol: sym, confidence };
    }
  }

  return bestMatch;
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Link extracted knowledge entities to code graph nodes via ABOUT edges.
 *
 * Call this after `importEntitiesAndRelationships()` so that Entity nodes
 * exist in the graph and ABOUT edges can reference them.
 *
 * @param entities  - Entities from NLP extraction (text + type)
 * @param client    - GraphClient for querying code nodes
 * @param kgOps     - KnowledgeOperations for creating ABOUT edges
 * @param config    - Optional configuration
 * @returns Summary of links created
 */
export async function linkEntitiesToCode(
  entities: BridgeLinkerInput[],
  client: GraphClient,
  kgOps: KnowledgeOperations,
  config: BridgeLinkerConfig = {},
): Promise<BridgeLinkResult> {
  const minConfidence = config.minConfidence ?? 0.85;
  const skipNonCode = config.skipNonCodeTypes ?? true;
  const batchLimit = config.batchLimit ?? 500;

  const result: BridgeLinkResult = {
    total: entities.length,
    linked: 0,
    skipped: 0,
    links: [],
  };

  if (entities.length === 0) return result;

  // Filter out non-code entity types (Person, Organization, etc.)
  const candidates = skipNonCode
    ? entities.filter((e) => !NON_CODE_ENTITY_TYPES.has(e.type))
    : entities;

  result.skipped = entities.length - candidates.length;

  if (candidates.length === 0) {
    logger.debug('No candidate entities for bridge linking (all non-code types)');
    return result;
  }

  // Batch-load all code symbol names from the graph
  const symbols = await loadCodeSymbols(client, batchLimit);

  if (symbols.length === 0) {
    logger.debug('No code symbols in graph — skipping bridge linking');
    result.skipped = entities.length;
    return result;
  }

  // For each candidate entity, find the best matching code symbol
  for (const entity of candidates) {
    const match = findBestMatch(entity.text, symbols, minConfidence);

    if (!match) {
      result.skipped++;
      continue;
    }

    // Determine the target key (name for most labels, path for File)
    const targetKey = CODE_NODE_LABELS[match.symbol.label] ?? 'name';

    const input: AboutEdgeInput = {
      entityText: entity.text,
      entityType: entity.type,
      targetLabel: match.symbol.label,
      targetKey,
      targetValue: match.symbol.name,
      confidence: match.confidence,
      method: 'exact_match',
    };

    try {
      const created = await kgOps.createAboutEdge(input);
      if (created) {
        result.linked++;
        result.links.push({
          entityText: entity.text,
          entityType: entity.type,
          targetLabel: match.symbol.label,
          targetValue: match.symbol.name,
          confidence: match.confidence,
        });
        logger.debug(
          `Linked: "${entity.text}" (${entity.type}) → ${match.symbol.label}:${match.symbol.name} [${match.confidence}]`,
        );
      }
    } catch (err) {
      logger.warn(`Failed to create ABOUT edge for "${entity.text}": ${err}`);
    }
  }

  logger.info(
    `Bridge linker: ${result.linked} linked, ${result.skipped} skipped, ${result.total} total`,
  );

  return result;
}

// ============================================================================
// Embedding Similarity Linker (Batch / CLI)
// ============================================================================

export interface EmbeddingLinkConfig {
  /** Minimum cosine similarity threshold (default: 0.8) */
  threshold?: number;
  /** Re-link all entities, even those that already have ABOUT edges (default: false) */
  force?: boolean;
  /** Whether to skip Person/Organization entity types (default: true) */
  skipNonCodeTypes?: boolean;
  /** Maximum entities to process per batch (default: 100) */
  batchSize?: number;
  /** Progress callback for CLI output */
  onProgress?: (current: number, total: number) => void;
}

export interface EmbeddingLinkResult {
  /** Total entities considered */
  total: number;
  /** Number of ABOUT edges created */
  linked: number;
  /** Entities skipped (already linked, below threshold, or no embedding) */
  skipped: number;
  /** Number that already had name-match ABOUT edges */
  alreadyLinked: number;
  /** Details of each link created */
  links: Array<{
    entityText: string;
    entityType: string;
    targetLabel: string;
    targetValue: string;
    confidence: number;
  }>;
}

/** Code node types that have HNSW vector indexes */
const VECTOR_NODE_TYPES = [
  'Function', 'Class', 'Interface', 'Component', 'Type', 'Variable',
] as const;

/**
 * Link knowledge entities to code nodes via embedding similarity.
 *
 * For each unlinked entity (or all with force=true):
 * 1. Generate an embedding for the entity text
 * 2. Vector search against each code node type's HNSW index
 * 3. If best match similarity > threshold → create ABOUT edge
 *
 * @param client - GraphClient for querying code nodes
 * @param kgOps  - KnowledgeOperations for entity queries and ABOUT edges
 * @param config - Optional configuration
 * @returns Summary of links created
 */
export async function linkByEmbedding(
  client: GraphClient,
  kgOps: KnowledgeOperations,
  config: EmbeddingLinkConfig = {},
): Promise<EmbeddingLinkResult> {
  const threshold = config.threshold ?? 0.8;
  const force = config.force ?? false;
  const skipNonCode = config.skipNonCodeTypes ?? true;
  const batchSize = config.batchSize ?? 100;

  const result: EmbeddingLinkResult = {
    total: 0,
    linked: 0,
    skipped: 0,
    alreadyLinked: 0,
    links: [],
  };

  // Check embedding availability
  if (!isEmbeddingAvailable()) {
    logger.warn('Embedding not available — cannot run embedding similarity linker');
    return result;
  }

  // Get all entities from the knowledge graph
  const allEntities = await kgOps.searchEntities({ limit: 10000 });
  result.total = allEntities.length;

  if (allEntities.length === 0) {
    logger.info('No entities in knowledge graph — nothing to link');
    return result;
  }

  // Filter candidates
  const candidates = allEntities.filter((e) => {
    // Skip non-code types
    if (skipNonCode && NON_CODE_ENTITY_TYPES.has(e.type)) {
      result.skipped++;
      return false;
    }
    return true;
  });

  // If not force mode, filter out entities that already have ABOUT edges
  const toProcess: typeof candidates = [];
  if (!force) {
    for (const entity of candidates) {
      const existing = await kgOps.getAboutEdgesForEntity(entity.text, entity.type, 1);
      if (existing.length > 0) {
        result.alreadyLinked++;
        result.skipped++;
        continue;
      }
      toProcess.push(entity);
    }
  } else {
    toProcess.push(...candidates);
  }

  if (toProcess.length === 0) {
    logger.info(`No unlinked entities to process (${result.alreadyLinked} already linked)`);
    return result;
  }

  logger.info(
    `Embedding linker: processing ${toProcess.length} entities (threshold: ${threshold}, force: ${force})`,
  );

  const ops = createOperations(client);

  // Process in batches
  for (let i = 0; i < toProcess.length; i += batchSize) {
    const batch = toProcess.slice(i, i + batchSize);

    for (const entity of batch) {
      try {
        // Generate embedding for the entity text
        const embText = buildEntityEmbeddingText({ text: entity.text, type: entity.type });
        const embResult = await generateEmbedding(embText);

        if (!embResult) {
          result.skipped++;
          continue;
        }

        // Vector search across all code node types, find the best match
        let bestMatch: { nodeType: string; name: string; similarity: number } | null = null;

        for (const nodeType of VECTOR_NODE_TYPES) {
          const hits = await ops.searchByVector(nodeType, embResult.embedding, 1);
          if (hits.length > 0) {
            const hit = hits[0]!;
            // FalkorDB vector search returns cosine distance (lower = closer)
            // Convert to similarity: similarity = 1 - distance
            const similarity = 1 - hit.distance;

            if (similarity >= threshold && (!bestMatch || similarity > bestMatch.similarity)) {
              bestMatch = {
                nodeType,
                name: hit.name,
                similarity,
              };
            }
          }
        }

        if (!bestMatch) {
          result.skipped++;
          continue;
        }

        // Create ABOUT edge with embedding_similarity method
        const targetKey = CODE_NODE_LABELS[bestMatch.nodeType] ?? 'name';

        const aboutInput: AboutEdgeInput = {
          entityText: entity.text,
          entityType: entity.type,
          targetLabel: bestMatch.nodeType,
          targetKey,
          targetValue: bestMatch.name,
          confidence: bestMatch.similarity,
          method: 'embedding_similarity',
        };

        const created = await kgOps.createAboutEdge(aboutInput);
        if (created) {
          result.linked++;
          result.links.push({
            entityText: entity.text,
            entityType: entity.type,
            targetLabel: bestMatch.nodeType,
            targetValue: bestMatch.name,
            confidence: bestMatch.similarity,
          });
          logger.debug(
            `Embedding linked: "${entity.text}" (${entity.type}) → ${bestMatch.nodeType}:${bestMatch.name} [${bestMatch.similarity.toFixed(3)}]`,
          );
        }
      } catch (err) {
        logger.warn(`Embedding link failed for "${entity.text}": ${err}`);
        result.skipped++;
      }

      // Progress callback
      config.onProgress?.(i + batch.indexOf(entity) + 1, toProcess.length);
    }
  }

  logger.info(
    `Embedding linker: ${result.linked} linked, ${result.skipped} skipped, ${result.alreadyLinked} already linked, ${result.total} total`,
  );

  return result;
}
