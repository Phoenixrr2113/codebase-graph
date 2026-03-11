/**
 * @codegraph/core — Hybrid Search Orchestration
 *
 * Combines three search strategies:
 *   1. Vector: embed query → cosine search across all node types
 *   2. Text: CONTAINS on name + docstring
 *   3. Graph: from top hits, traverse CALLS/IMPORTS/EXTENDS 1-2 hops
 *
 * Merges results, deduplicates, and returns a ranked list with relationships.
 * Falls back to text-only search when no embeddings are available.
 */

import { createLogger } from '@codegraph/logger';
import type { GraphClient } from '@codegraph/graph';
import { createOperations, type VectorSearchResult } from '@codegraph/graph';
import { createKnowledgeOperations, type EntitySearchResult } from '@codegraph/graph';
import {
  generateEmbedding,
  isEmbeddingAvailable,
  type EmbeddingConfig,
} from '@codegraph/plugin-nlp';

const logger = createLogger({ namespace: 'core:hybrid-search' });

// ============================================================================
// Types
// ============================================================================

/** Node types that support vector search */
const CODE_NODE_TYPES = [
  'Function', 'Class', 'Interface', 'Component', 'Type', 'Variable', 'File',
] as const;

export type CodeNodeType = (typeof CODE_NODE_TYPES)[number];

/** A single search hit */
export interface HybridSearchHit {
  /** Unique key for dedup: "nodeType:filePath:name" or "entity:id" */
  key: string;
  /** Node type (Function, Class, etc.) or "Entity" for knowledge graph */
  nodeType: string;
  /** Symbol or entity name */
  name: string;
  /** File path (code nodes only) */
  filePath?: string;
  /** Start line (code nodes only) */
  startLine?: number;
  /** Combined relevance score (higher = more relevant, 0-1 range) */
  score: number;
  /** How this hit was found */
  sources: ('vector' | 'text' | 'graph')[];
  /** Raw vector distance (lower = closer) — only for vector hits */
  vectorDistance?: number;
  /** Additional properties from the node */
  properties: Record<string, unknown>;
}

/** A related node found via graph traversal */
export interface RelatedHit {
  /** The search hit this relates to */
  sourceKey: string;
  /** The related node */
  name: string;
  nodeType: string;
  filePath?: string;
  startLine?: number;
  /** Edge label (CALLS, IMPORTS, EXTENDS, ABOUT, etc.) */
  edgeLabel: string;
  /** Direction: "outgoing" (source → related) or "incoming" (related → source) */
  direction: 'outgoing' | 'incoming';
  /** For ABOUT-linked knowledge entities: entity type */
  entityType?: string;
  /** For ABOUT-linked knowledge entities: confidence of the ABOUT link */
  aboutConfidence?: number;
}

/** Full hybrid search result */
export interface HybridSearchResult {
  /** Ranked hits (highest score first) */
  hits: HybridSearchHit[];
  /** Related nodes found via graph traversal */
  related: RelatedHit[];
  /** Search metadata */
  meta: {
    query: string;
    totalHits: number;
    vectorHits: number;
    textHits: number;
    graphExpanded: number;
    aboutExpanded: number;
    embeddingAvailable: boolean;
    durationMs: number;
  };
}

/** Options for hybrid search */
export interface HybridSearchOptions {
  /** Maximum results to return (default: 20) */
  limit?: number;
  /** Node types to search (default: all code + entity) */
  nodeTypes?: CodeNodeType[];
  /** Include knowledge graph entities (default: true) */
  includeKnowledge?: boolean;
  /** Include graph traversal for related nodes (default: true) */
  expandGraph?: boolean;
  /** Max hops for graph traversal (default: 1) */
  maxHops?: number;
  /** Embedding config (default: auto-detect) */
  embeddings?: EmbeddingConfig;
  /** File path scope filter (only return results under this path) */
  scope?: string;
  /** Weight for vector score (default: 0.7) */
  vectorWeight?: number;
  /** Weight for text match bonus (default: 0.3) */
  textWeight?: number;
  /** Traverse ABOUT edges to include cross-layer results (default: true) */
  includeAboutEdges?: boolean;
}

// ============================================================================
// Main hybrid search function
// ============================================================================

/**
 * Execute a hybrid search combining vector, text, and graph strategies.
 *
 * @param query - Natural language search query
 * @param client - Graph database client
 * @param options - Search options
 * @returns Ranked search results with related nodes
 */
export async function hybridSearch(
  query: string,
  client: GraphClient,
  options: HybridSearchOptions = {},
): Promise<HybridSearchResult> {
  const startTime = Date.now();
  const limit = options.limit ?? 20;
  const nodeTypes = options.nodeTypes ?? [...CODE_NODE_TYPES];
  const includeKnowledge = options.includeKnowledge ?? true;
  const expandGraph = options.expandGraph ?? true;
  const maxHops = options.maxHops ?? 1;
  const vectorWeight = options.vectorWeight ?? 0.7;
  const textWeight = options.textWeight ?? 0.3;
  const includeAbout = options.includeAboutEdges ?? true;

  const ops = createOperations(client);

  // Accumulate hits in a map for dedup
  const hitMap = new Map<string, HybridSearchHit>();

  // ----------------------------------------------------------------
  // Step 1: Embed the query (if embedding available)
  // ----------------------------------------------------------------
  let queryEmbedding: number[] | null = null;
  let embeddingAvailable = false;

  const embeddingConfig = options.embeddings;
  if (isEmbeddingAvailable(embeddingConfig)) {
    try {
      const result = await generateEmbedding(query, embeddingConfig);
      queryEmbedding = result.embedding;
      embeddingAvailable = true;
      logger.debug(`Query embedded: ${result.dimensions}d via ${result.provider}`);
    } catch (err) {
      logger.warn(`Failed to embed query: ${err}`);
    }
  }

  // ----------------------------------------------------------------
  // Step 2: Vector search (parallel across node types)
  // ----------------------------------------------------------------
  let vectorHitCount = 0;

  if (queryEmbedding) {
    // Run vector searches in parallel
    const vectorPromises: Promise<VectorSearchResult[]>[] = nodeTypes.map(
      (nt) => ops.searchByVector(nt, queryEmbedding!, limit),
    );

    // Knowledge graph vector search
    let knowledgePromise: Promise<EntitySearchResult[]> | null = null;
    if (includeKnowledge) {
      const kgOps = createKnowledgeOperations(client);
      knowledgePromise = kgOps.searchEntitiesByVector(queryEmbedding, limit);
    }

    const vectorResults = await Promise.all(vectorPromises);

    // Merge vector results
    for (const results of vectorResults) {
      for (const r of results) {
        const key = makeCodeKey(r.nodeType, r.filePath, r.name);
        if (options.scope && r.filePath && !r.filePath.startsWith(options.scope)) continue;

        const score = distanceToScore(r.distance) * vectorWeight;
        const hit: HybridSearchHit = {
          key,
          nodeType: r.nodeType,
          name: r.name,
          filePath: r.filePath,
          score,
          sources: ['vector'],
          vectorDistance: r.distance,
          properties: r.properties,
        };
        if (r.startLine != null) hit.startLine = r.startLine;
        mergeHit(hitMap, hit);
        vectorHitCount++;
      }
    }

    // Merge knowledge graph vector results
    if (knowledgePromise) {
      const kgResults = await knowledgePromise;
      for (const r of kgResults) {
        const key = `entity:${r.id}`;
        const dist = (r as unknown as Record<string, unknown>)['distance'] as number | undefined;
        const score = dist != null ? distanceToScore(dist) * vectorWeight : 0.5 * vectorWeight;
        const kgHit: HybridSearchHit = {
          key,
          nodeType: 'Entity',
          name: r.text,
          score,
          sources: ['vector'],
          properties: {
            id: r.id,
            type: r.type,
            confidence: r.confidence,
            relevanceScore: r.relevanceScore,
          },
        };
        if (dist != null) kgHit.vectorDistance = dist;
        mergeHit(hitMap, kgHit);
        vectorHitCount++;
      }
    }
  }

  // ----------------------------------------------------------------
  // Step 3: Text search (name CONTAINS)
  // ----------------------------------------------------------------
  let textHitCount = 0;

  const textResults = await textSearchNodes(client, query, nodeTypes, limit, options.scope);
  for (const r of textResults) {
    const key = makeCodeKey(r.nodeType, r.filePath, r.name);
    // Exact name match gets full text weight; partial match gets half
    const isExact = r.name.toLowerCase() === query.toLowerCase();
    const score = (isExact ? 1.0 : 0.5) * textWeight;
    mergeHit(hitMap, {
      key,
      nodeType: r.nodeType,
      name: r.name,
      filePath: r.filePath,
      startLine: r.startLine,
      score,
      sources: ['text'],
      properties: {},
    });
    textHitCount++;
  }

  // Knowledge text search
  if (includeKnowledge) {
    const kgOps = createKnowledgeOperations(client);
    const kgTextResults = await kgOps.searchEntities({ textContains: query, limit });
    for (const r of kgTextResults) {
      const key = `entity:${r.id}`;
      const isExact = r.text.toLowerCase() === query.toLowerCase();
      const score = (isExact ? 1.0 : 0.5) * textWeight;
      mergeHit(hitMap, {
        key,
        nodeType: 'Entity',
        name: r.text,
        score,
        sources: ['text'],
        properties: {
          id: r.id,
          type: r.type,
          confidence: r.confidence,
          relevanceScore: r.relevanceScore,
        },
      });
      textHitCount++;
    }
  }

  // ----------------------------------------------------------------
  // Step 4: Rank and take top N
  // ----------------------------------------------------------------
  const allHits = Array.from(hitMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  // ----------------------------------------------------------------
  // Step 5: Graph traversal (expand top hits with related nodes)
  // ----------------------------------------------------------------
  const related: RelatedHit[] = [];
  let graphExpanded = 0;

  if (expandGraph && allHits.length > 0) {
    // Only expand code nodes (not knowledge entities)
    // Prioritize File nodes — they have the richest graph structure (CONTAINS, IMPORTS)
    const codeHits = allHits
      .filter((h) => h.nodeType !== 'Entity' && h.filePath)
      .sort((a, b) => {
        if (a.nodeType === 'File' && b.nodeType !== 'File') return -1;
        if (a.nodeType !== 'File' && b.nodeType === 'File') return 1;
        return 0; // preserve score order within same priority
      })
      .slice(0, 10);

    for (const hit of codeHits) {
      try {
        const neighbors = await traverseNeighbors(
          client, hit.nodeType, hit.name, hit.filePath!, maxHops,
        );
        for (const n of neighbors) {
          if (options.scope && n.filePath && !n.filePath.startsWith(options.scope)) continue;
          related.push({ ...n, sourceKey: hit.key });
          graphExpanded++;
        }
      } catch {
        // Traversal failures are non-fatal
      }
    }
  }

  // ----------------------------------------------------------------
  // Step 6: ABOUT edge traversal (cross-layer links)
  // ----------------------------------------------------------------
  let aboutExpanded = 0;

  if (includeAbout && allHits.length > 0) {
    const kgOps = createKnowledgeOperations(client);

    // For code nodes: find knowledge entities linked via ABOUT
    const codeHitsForAbout = allHits
      .filter((h) => h.nodeType !== 'Entity' && h.name)
      .slice(0, 10);

    for (const hit of codeHitsForAbout) {
      try {
        const aboutEdges = await kgOps.getAboutEdgesForCodeNode(
          hit.nodeType, hit.name, 5,
        );
        for (const edge of aboutEdges) {
          related.push({
            sourceKey: hit.key,
            name: edge.entityText,
            nodeType: 'Entity',
            edgeLabel: 'ABOUT',
            direction: 'incoming',
            entityType: edge.entityType,
            aboutConfidence: edge.confidence,
          });
          aboutExpanded++;
        }
      } catch {
        // ABOUT traversal failures are non-fatal
      }
    }

    // For knowledge entities: find code nodes linked via ABOUT
    const entityHits = allHits
      .filter((h) => h.nodeType === 'Entity')
      .slice(0, 10);

    for (const hit of entityHits) {
      try {
        const entityType = (hit.properties.type as string) ?? '';
        const aboutEdges = await kgOps.getAboutEdgesForEntity(
          hit.name, entityType, 5,
        );
        for (const edge of aboutEdges) {
          related.push({
            sourceKey: hit.key,
            name: edge.targetValue,
            nodeType: edge.targetLabel,
            edgeLabel: 'ABOUT',
            direction: 'outgoing',
            aboutConfidence: edge.confidence,
          });
          aboutExpanded++;
        }
      } catch {
        // ABOUT traversal failures are non-fatal
      }
    }
  }

  const durationMs = Date.now() - startTime;
  logger.info(
    `Hybrid search "${query}": ${allHits.length} hits ` +
    `(${vectorHitCount} vector, ${textHitCount} text, ${graphExpanded} graph, ${aboutExpanded} about) in ${durationMs}ms`,
  );

  return {
    hits: allHits,
    related,
    meta: {
      query,
      totalHits: allHits.length,
      vectorHits: vectorHitCount,
      textHits: textHitCount,
      graphExpanded,
      aboutExpanded,
      embeddingAvailable,
      durationMs,
    },
  };
}

// ============================================================================
// Helpers
// ============================================================================

/** Dedup key for code nodes */
function makeCodeKey(nodeType: string, filePath: string | undefined, name: string): string {
  return `${nodeType}:${filePath ?? ''}:${name}`;
}

/** Convert Euclidean distance to a 0-1 score (closer = higher) */
function distanceToScore(distance: number): number {
  // Euclidean distance ≥ 0. For normalized embeddings, max is ~2.0
  // Use inverse mapping: score = 1 / (1 + distance)
  return 1 / (1 + distance);
}

/** Merge a hit into the map, combining scores and sources */
function mergeHit(
  map: Map<string, HybridSearchHit>,
  hit: HybridSearchHit,
): void {
  const existing = map.get(hit.key);
  if (existing) {
    existing.score += hit.score;
    for (const src of hit.sources) {
      if (!existing.sources.includes(src)) {
        existing.sources.push(src);
      }
    }
    // Keep the vector distance from vector source
    if (hit.vectorDistance != null && existing.vectorDistance == null) {
      existing.vectorDistance = hit.vectorDistance;
    }
    // Merge properties
    Object.assign(existing.properties, hit.properties);
  } else {
    map.set(hit.key, { ...hit });
  }
}

// ============================================================================
// Text search across code node types
// ============================================================================

interface TextSearchHit {
  nodeType: string;
  name: string;
  filePath: string;
  startLine: number;
}

async function textSearchNodes(
  client: GraphClient,
  query: string,
  nodeTypes: readonly string[],
  limit: number,
  scope?: string,
): Promise<TextSearchHit[]> {
  const dialect = client.dialect;
  const firstLabel = dialect.firstLabelExpr('n');

  // Build label filter
  const labelClauses = nodeTypes.map(
    (nt) => dialect.labelCheckExpr('n', nt),
  );
  const labelFilter = `(${labelClauses.join(' OR ')})`;

  const scopeFilter = scope ? 'AND n.filePath STARTS WITH $scope' : '';

  // Case-insensitive name search
  // File nodes store their path as `path`; all other code nodes use `filePath`
  const cypher = `
    MATCH (n)
    WHERE ${labelFilter}
      AND toLower(n.name) CONTAINS toLower($query)
      ${scopeFilter}
    RETURN n.name AS name, ${firstLabel} AS nodeType,
           CASE WHEN ${dialect.labelCheckExpr('n', 'File')} THEN n.path ELSE n.filePath END AS filePath,
           n.startLine AS startLine
    ORDER BY n.name
    LIMIT $limit
  `;

  const params: Record<string, string | number | boolean | null | Array<unknown>> = { query, limit };
  if (scope) params.scope = scope;

  try {
    const result = await client.roQuery<TextSearchHit>(cypher, { params });
    return result.data;
  } catch {
    return [];
  }
}

// ============================================================================
// Graph traversal (1-2 hops from a hit)
// ============================================================================

interface TraversalHit {
  name: string;
  nodeType: string;
  filePath?: string;
  startLine?: number;
  edgeLabel: string;
  direction: 'outgoing' | 'incoming';
}

async function traverseNeighbors(
  client: GraphClient,
  nodeType: string,
  name: string,
  filePath: string,
  maxHops: number,
): Promise<TraversalHit[]> {
  const dialect = client.dialect;
  const firstLabel = dialect.firstLabelExpr('other');
  const edgeType = dialect.typeExpr('r');
  const hopRange = maxHops > 1 ? `*1..${maxHops}` : '';

  // File nodes use `path` property; all other code nodes use `filePath`
  const matchProps = nodeType === 'File'
    ? '{name: $name}'
    : '{name: $name, filePath: $filePath}';

  // Outgoing traversal (e.g., this function CALLS other functions, File CONTAINS functions)
  const outCypher = `
    MATCH (n:${nodeType} ${matchProps})-[r${hopRange}]->(other)
    RETURN other.name AS name, ${firstLabel} AS nodeType,
           other.filePath AS filePath, other.startLine AS startLine,
           ${edgeType} AS edgeLabel
    LIMIT 20
  `;

  // Incoming traversal (e.g., other functions CALL this function)
  const inCypher = `
    MATCH (other)-[r${hopRange}]->(n:${nodeType} ${matchProps})
    RETURN other.name AS name, ${firstLabel} AS nodeType,
           other.filePath AS filePath, other.startLine AS startLine,
           ${edgeType} AS edgeLabel
    LIMIT 20
  `;

  const params: Record<string, string | number | boolean | null | Array<unknown>> = { name, filePath };

  type RowType = { name: string; nodeType: string; filePath?: string; startLine?: number; edgeLabel: string };
  const emptyData = { data: [] as RowType[] };

  const [outResults, inResults] = await Promise.all([
    client.roQuery<RowType>(outCypher, { params }).catch(() => emptyData),
    client.roQuery<RowType>(inCypher, { params }).catch(() => emptyData),
  ]);

  const hits: TraversalHit[] = [];

  for (const row of outResults.data) {
    const hit: TraversalHit = {
      name: row.name,
      nodeType: row.nodeType,
      edgeLabel: row.edgeLabel,
      direction: 'outgoing',
    };
    if (row.filePath != null) hit.filePath = row.filePath;
    if (row.startLine != null) hit.startLine = row.startLine;
    hits.push(hit);
  }

  for (const row of inResults.data) {
    const hit: TraversalHit = {
      name: row.name,
      nodeType: row.nodeType,
      edgeLabel: row.edgeLabel,
      direction: 'incoming',
    };
    if (row.filePath != null) hit.filePath = row.filePath;
    if (row.startLine != null) hit.startLine = row.startLine;
    hits.push(hit);
  }

  return hits;
}
