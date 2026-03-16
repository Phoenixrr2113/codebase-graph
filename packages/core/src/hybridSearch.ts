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
  rerank,
  isRerankAvailable,
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
    reranked: boolean;
    rerankDurationMs?: number;
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
  /** Weight for vector score (default: 0.4) */
  vectorWeight?: number;
  /** Weight for text match bonus (default: 0.6) */
  textWeight?: number;
  /** Traverse ABOUT edges to include cross-layer results (default: true) */
  includeAboutEdges?: boolean;
  /** Minimum normalized RRF score to include (default: 0.4). Set to 0 to disable. */
  minRRFScore?: number;
  /** Enable cross-encoder reranking (default: true when VOYAGE_API_KEY is set) */
  reranking?: boolean;
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
  const vectorWeight = options.vectorWeight ?? 0.4;
  const textWeight = options.textWeight ?? 0.6;
  const includeAbout = options.includeAboutEdges ?? true;

  const ops = createOperations(client);

  // Collect hits per-source for RRF fusion (FEAT.6)
  const vectorHitsList: Array<{ hit: HybridSearchHit; internalScore: number }> = [];
  const textHitsList: Array<{ hit: HybridSearchHit; internalScore: number }> = [];
  const kgOps = (includeKnowledge || includeAbout) ? createKnowledgeOperations(client) : null;

  // ----------------------------------------------------------------
  // Steps 1-3: Embedding/vector and text pipelines run in parallel
  // ----------------------------------------------------------------

  // Text pipeline: starts immediately (no embedding dependency)
  const textPipelinePromise = Promise.all([
    textSearchNodes(client, query, nodeTypes, limit, options.scope),
    kgOps
      ? kgOps.searchEntities({ textContains: query, limit })
      : Promise.resolve([] as EntitySearchResult[]),
  ]);

  // Vector pipeline: embed query → fan out vector searches (runs concurrently with text)
  const embeddingConfig = options.embeddings;
  const vectorPipelinePromise = (async (): Promise<{
    codeResults: VectorSearchResult[][];
    kgResults: EntitySearchResult[];
  } | null> => {
    if (!isEmbeddingAvailable(embeddingConfig)) return null;

    let queryEmbedding: number[];
    try {
      const result = await generateEmbedding(query, { ...embeddingConfig, inputType: 'query' });
      queryEmbedding = result.embedding;
      logger.debug(`Query embedded: ${result.dimensions}d via ${result.provider}`);
    } catch (err) {
      logger.warn(`Failed to embed query: ${err}`);
      return null;
    }

    // Cap vector results per node type to avoid overwhelming text results.
    // Total vector budget ≈ limit; spread across node types.
    const perTypeLimit = Math.max(3, Math.ceil(limit / nodeTypes.length));
    const [codeResults, kgResults] = await Promise.all([
      Promise.all(nodeTypes.map((nt) => ops.searchByVector(nt, queryEmbedding, perTypeLimit))),
      kgOps
        ? kgOps.searchEntitiesByVector(queryEmbedding, perTypeLimit)
        : Promise.resolve([] as EntitySearchResult[]),
    ]);

    return { codeResults, kgResults };
  })();

  // Await both pipelines concurrently
  const [[textResults, kgTextResults], vectorPipeline] = await Promise.all([
    textPipelinePromise,
    vectorPipelinePromise,
  ]);

  const embeddingAvailable = vectorPipeline !== null;

  // Collect vector results into ranked list (sorted by relevance for RRF).
  // Filter out weak matches (score < 0.55 ≈ distance > 0.82) to avoid diluting
  // text results with semantically distant nodes.
  const MIN_VECTOR_SCORE = 0.65;
  let vectorHitCount = 0;
  if (vectorPipeline) {
    for (const results of vectorPipeline.codeResults) {
      for (const r of results) {
        if (options.scope && r.filePath && !r.filePath.startsWith(options.scope)) continue;
        // Skip File nodes from vector search — their embeddings are too broad
        // (contain all symbols in the file) so they match almost any query.
        // Files should only appear via text search (name/docstring match).
        if (r.nodeType === 'File') continue;

        const internalScore = distanceToScore(r.distance);
        if (internalScore < MIN_VECTOR_SCORE) continue; // Skip weak matches

        const key = makeCodeKey(r.nodeType, r.filePath, r.name);

        // Deduplicate: same node can appear across multiple per-type vector searches.
        // Keep the one with the best (highest) internal score.
        const existingIdx = vectorHitsList.findIndex((v) => v.hit.key === key);
        if (existingIdx >= 0) {
          if (internalScore > vectorHitsList[existingIdx]!.internalScore) {
            vectorHitsList[existingIdx]!.internalScore = internalScore;
            vectorHitsList[existingIdx]!.hit.vectorDistance = r.distance;
          }
          continue;
        }

        const hit: HybridSearchHit = {
          key,
          nodeType: r.nodeType,
          name: r.name,
          filePath: r.filePath,
          score: 0, // Will be set by RRF
          sources: ['vector'],
          vectorDistance: r.distance,
          properties: r.properties,
        };
        if (r.startLine != null) hit.startLine = r.startLine;
        vectorHitsList.push({ hit, internalScore });
        vectorHitCount++;
      }
    }

    for (const r of vectorPipeline.kgResults) {
      const key = `entity:${r.id}`;
      const dist = (r as unknown as Record<string, unknown>)['distance'] as number | undefined;
      const internalScore = dist != null ? distanceToScore(dist) : 0.5;
      if (internalScore < MIN_VECTOR_SCORE) continue; // Skip weak matches

      const kgHit: HybridSearchHit = {
        key,
        nodeType: 'Entity',
        name: r.text,
        score: 0, // Will be set by RRF
        sources: ['vector'],
        properties: {
          id: r.id,
          type: r.type,
          confidence: r.confidence,
          relevanceScore: r.relevanceScore,
        },
      };
      if (dist != null) kgHit.vectorDistance = dist;
      vectorHitsList.push({ hit: kgHit, internalScore });
      vectorHitCount++;
    }
  }

  // Collect text results into ranked list (sorted by text score for RRF).
  // Skip docstring-only matches (score <= 0.3) — these are nodes whose name
  // doesn't contain any search term, adding noise to symbol/keyword lookups.
  const MIN_TEXT_SCORE = 0.4;
  const searchTerms = extractSearchTerms(query);
  let textHitCount = 0;
  for (const r of textResults) {
    const key = makeCodeKey(r.nodeType, r.filePath, r.name);
    const internalScore = scoreTextHit(r.name, query, searchTerms);
    if (internalScore < MIN_TEXT_SCORE) continue; // Skip docstring-only matches
    textHitsList.push({
      hit: {
        key,
        nodeType: r.nodeType,
        name: r.name,
        filePath: r.filePath,
        startLine: r.startLine,
        score: 0, // Will be set by RRF
        sources: ['text'],
        properties: {},
      },
      internalScore,
    });
    textHitCount++;
  }

  for (const r of kgTextResults) {
    const key = `entity:${r.id}`;
    const internalScore = scoreTextHit(r.text, query, searchTerms);
    textHitsList.push({
      hit: {
        key,
        nodeType: 'Entity',
        name: r.text,
        score: 0, // Will be set by RRF
        sources: ['text'],
        properties: {
          id: r.id,
          type: r.type,
          confidence: r.confidence,
          relevanceScore: r.relevanceScore,
        },
      },
      internalScore,
    });
    textHitCount++;
  }

  // ----------------------------------------------------------------
  // Step 4: RRF Fusion (FEAT.6) — rank-based score combination
  // ----------------------------------------------------------------

  // Sort each source by internal relevance score (best first = rank 1)
  vectorHitsList.sort((a, b) => b.internalScore - a.internalScore);
  textHitsList.sort((a, b) => b.internalScore - a.internalScore);

  // Fuse using Reciprocal Rank Fusion
  const fusedHits = rrfFuse([
    { hits: vectorHitsList.map((v) => v.hit), weight: vectorWeight, name: 'vector' },
    { hits: textHitsList.map((t) => t.hit), weight: textWeight, name: 'text' },
  ]);


  // ----------------------------------------------------------------
  // Step 4b: Reranker (optional, uses Voyage rerank-2 cross-encoder)
  // ----------------------------------------------------------------
  const useReranking = options.reranking ?? isRerankAvailable();
  let reranked = false;
  let rerankDurationMs: number | undefined;

  // Only rerank when there's enough ambiguity to benefit from cross-encoder:
  //   - Need multiple sources (vector+text) to have something to re-order
  //   - Need enough candidates to justify the API call latency
  const hasMultipleSources = vectorHitCount > 0 && textHitCount > 0;
  const enoughCandidates = fusedHits.length >= 5;

  if (useReranking && hasMultipleSources && enoughCandidates) {
    // Take top ~30 candidates for reranking (more than final limit to give reranker room)
    const rerankCandidates = fusedHits.slice(0, Math.max(limit * 2, 30));

    // Save original RRF scores before reranking
    const rrfScores = new Map<string, number>();
    for (const hit of rerankCandidates) {
      rrfScores.set(hit.key, hit.score);
    }

    // Build document texts for reranker from hit properties
    const rerankDocs = rerankCandidates.map((hit) => {
      const parts: string[] = [];
      parts.push(`${hit.nodeType}: ${hit.name}`);
      if (hit.filePath) parts.push(`in ${hit.filePath}`);
      const doc = hit.properties.docstring as string | undefined;
      if (doc) parts.push(doc.slice(0, 200));
      const body = hit.properties.bodySnippet as string | undefined;
      if (body) parts.push(body.slice(0, 300));
      return parts.join(' ');
    });

    try {
      const rerankStart = performance.now();
      const rerankResults = await rerank(query, rerankDocs, { topK: Math.max(limit * 2, 30) });
      rerankDurationMs = performance.now() - rerankStart;

      // Blend reranker scores with RRF scores (60% RRF + 40% reranker).
      // This lets the reranker promote/demote results without completely
      // overriding strong text-match signals from RRF fusion.
      const RRF_WEIGHT = 0.6;
      const RERANK_WEIGHT = 0.4;

      const rerankedHits: HybridSearchHit[] = [];
      for (const rr of rerankResults) {
        const hit = rerankCandidates[rr.index]!;
        const originalRRF = rrfScores.get(hit.key) ?? 0;
        hit.score = RRF_WEIGHT * originalRRF + RERANK_WEIGHT * rr.relevanceScore;
        rerankedHits.push(hit);
      }

      // Re-sort by blended score
      rerankedHits.sort((a, b) => b.score - a.score);

      // Replace fusedHits with reranked results for downstream processing
      fusedHits.length = 0;
      fusedHits.push(...rerankedHits);
      reranked = true;
      logger.debug(`Reranked ${rerankCandidates.length} → ${rerankedHits.length} hits in ${rerankDurationMs.toFixed(0)}ms`);
    } catch (err) {
      logger.warn(`Reranking failed, using RRF scores: ${err}`);
    }
  }

  // Drop results whose score is too far below the top hit.
  // This prunes tangential vector matches that dilute precision for focused queries.
  // Callers like CONTEXT_WALK can set minRRFScore=0 for broader exploration.
  const minRRFScore = options.minRRFScore ?? 0.4;
  const allHits = fusedHits
    .filter((h) => h.score >= minRRFScore)
    .slice(0, limit);

  // ----------------------------------------------------------------
  // Steps 5-6: Graph + ABOUT traversal in parallel
  // ----------------------------------------------------------------
  const related: RelatedHit[] = [];
  let graphExpanded = 0;
  let aboutExpanded = 0;

  // Prepare hit lists for traversal
  const codeHitsForGraph = expandGraph
    ? allHits
        .filter((h) => h.nodeType !== 'Entity' && h.filePath)
        .sort((a, b) => {
          if (a.nodeType === 'File' && b.nodeType !== 'File') return -1;
          if (a.nodeType !== 'File' && b.nodeType === 'File') return 1;
          return 0;
        })
        .slice(0, 10)
    : [];

  const codeHitsForAbout = includeAbout
    ? allHits.filter((h) => h.nodeType !== 'Entity' && h.name).slice(0, 10)
    : [];

  const entityHitsForAbout = includeAbout
    ? allHits.filter((h) => h.nodeType === 'Entity').slice(0, 10)
    : [];

  // Fan out all traversals in parallel
  const [graphTraversals, codeAboutTraversals, entityAboutTraversals] = await Promise.all([
    // Graph traversal: all hits in parallel
    Promise.all(
      codeHitsForGraph.map((hit) =>
        traverseNeighbors(client, hit.nodeType, hit.name, hit.filePath!, maxHops)
          .catch(() => [] as TraversalHit[]),
      ),
    ),
    // ABOUT: code nodes → knowledge entities
    kgOps
      ? Promise.all(
          codeHitsForAbout.map((hit) =>
            kgOps.getAboutEdgesForCodeNode(hit.nodeType, hit.name, 5)
              .catch(() => [] as { entityText: string; entityType: string; confidence: number }[]),
          ),
        )
      : [],
    // ABOUT: knowledge entities → code nodes
    kgOps
      ? Promise.all(
          entityHitsForAbout.map((hit) =>
            kgOps.getAboutEdgesForEntity(hit.name, (hit.properties.type as string) ?? '', 5)
              .catch(() => [] as { targetValue: string; targetLabel: string; confidence: number }[]),
          ),
        )
      : [],
  ]);

  // Collect graph traversal results
  for (let i = 0; i < codeHitsForGraph.length; i++) {
    for (const n of graphTraversals[i]!) {
      if (options.scope && n.filePath && !n.filePath.startsWith(options.scope)) continue;
      related.push({ ...n, sourceKey: codeHitsForGraph[i]!.key });
      graphExpanded++;
    }
  }

  // Collect ABOUT results: code → entity
  for (let i = 0; i < codeHitsForAbout.length; i++) {
    for (const edge of codeAboutTraversals[i]!) {
      related.push({
        sourceKey: codeHitsForAbout[i]!.key,
        name: edge.entityText,
        nodeType: 'Entity',
        edgeLabel: 'ABOUT',
        direction: 'incoming',
        entityType: edge.entityType,
        aboutConfidence: edge.confidence,
      });
      aboutExpanded++;
    }
  }

  // Collect ABOUT results: entity → code
  for (let i = 0; i < entityHitsForAbout.length; i++) {
    for (const edge of entityAboutTraversals[i]!) {
      related.push({
        sourceKey: entityHitsForAbout[i]!.key,
        name: edge.targetValue,
        nodeType: edge.targetLabel,
        edgeLabel: 'ABOUT',
        direction: 'outgoing',
        aboutConfidence: edge.confidence,
      });
      aboutExpanded++;
    }
  }

  const durationMs = Date.now() - startTime;
  logger.info(
    `Hybrid search "${query}": ${allHits.length} hits ` +
    `(${vectorHitCount} vector, ${textHitCount} text, ${graphExpanded} graph, ${aboutExpanded} about` +
    `${reranked ? `, reranked in ${rerankDurationMs?.toFixed(0)}ms` : ''}) in ${durationMs}ms`,
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
      reranked,
      ...(rerankDurationMs != null ? { rerankDurationMs } : {}),
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

/**
 * Score a text hit based on how well the node name matches the query.
 *
 * Scoring tiers (0-1):
 * - 1.0: Exact match (node name equals query string)
 * - 0.9+: Name contains the full query as a camelCase/PascalCase identifier
 *         with coverage bonus (shorter names = higher score)
 * - 0.5-0.8: Partial match — scored by fraction of search terms found in name
 * - 0.3: Docstring-only match (name doesn't match but node was found via docstring)
 */
function scoreTextHit(name: string, originalQuery: string, searchTerms: string[]): number {
  const nameLower = name.toLowerCase();
  const queryLower = originalQuery.toLowerCase().trim();

  // Exact match — highest score
  if (nameLower === queryLower) return 1.0;

  // Check if the name contains any of the original camelCase/PascalCase terms
  // (these are likely the exact symbol the user is asking about)
  if (searchTerms.length > 0) {
    const firstTerm = searchTerms[0]!;
    const termLower = firstTerm.toLowerCase();
    if (nameLower === termLower) return 0.95;
    if (nameLower.includes(termLower)) {
      // Coverage bonus: prefer shorter names where the query covers more of the name.
      // "inheritance" in "resolveInheritance" (11/18=61%) > in "genericExtractInheritance" (11/25=44%)
      const coverage = termLower.length / nameLower.length;
      return 0.85 + 0.1 * coverage; // Range: 0.85-0.95
    }
  }

  // Count how many search terms appear in the name
  let matchCount = 0;
  for (const term of searchTerms) {
    if (nameLower.includes(term.toLowerCase())) matchCount++;
  }

  if (matchCount > 0) {
    // Score: 0.5 base + 0.3 * fraction of terms matched
    return 0.5 + 0.3 * (matchCount / searchTerms.length);
  }

  // No name match — hit was found via docstring search only
  return 0.3;
}

/** Convert Euclidean distance to a 0-1 score (closer = higher) */
function distanceToScore(distance: number): number {
  // Euclidean distance ≥ 0. For normalized embeddings, max is ~2.0
  // Use inverse mapping: score = 1 / (1 + distance)
  return 1 / (1 + distance);
}

// ============================================================================
// Reciprocal Rank Fusion (FEAT.6)
// ============================================================================

/**
 * A ranked source of search hits for RRF fusion.
 * Hits MUST be pre-sorted by relevance (best first).
 */
export interface RRFSource {
  /** Pre-sorted hits (best first) */
  hits: HybridSearchHit[];
  /** Weight for this source's rank contributions */
  weight: number;
  /** Source name for debugging */
  name: string;
}

/**
 * Reciprocal Rank Fusion — combines ranked lists from multiple sources.
 *
 * For each document d found in any source:
 *   RRF_score(d) = Σ weight_i / (k + rank_i(d))
 *
 * where rank_i is the 1-based rank in source i, k is a smoothing constant.
 * Documents found in multiple sources accumulate contributions from each.
 *
 * Reference: Cormack, Clarke, Büttcher (2009) "Reciprocal Rank Fusion
 * outperforms Condorcet and individual Rank Learning Methods"
 *
 * @param sources - Array of ranked hit lists with their weights
 * @param k - Smoothing constant (default: 60, standard RRF value)
 * @returns Fused hits sorted by RRF score descending, normalized to 0-1
 */
export function rrfFuse(
  sources: RRFSource[],
  k: number = 60,
): HybridSearchHit[] {
  const fusedMap = new Map<string, { hit: HybridSearchHit; rrfScore: number }>();

  for (const source of sources) {
    for (let i = 0; i < source.hits.length; i++) {
      const hit = source.hits[i]!;
      const rank = i + 1; // RRF uses 1-based rank
      const rrfContribution = source.weight / (k + rank);

      const existing = fusedMap.get(hit.key);
      if (existing) {
        existing.rrfScore += rrfContribution;
        // Merge sources
        for (const src of hit.sources) {
          if (!existing.hit.sources.includes(src)) {
            existing.hit.sources.push(src);
          }
        }
        // Keep vector distance from vector source
        if (hit.vectorDistance != null && existing.hit.vectorDistance == null) {
          existing.hit.vectorDistance = hit.vectorDistance;
        }
        // Merge properties (vector source may have richer props)
        Object.assign(existing.hit.properties, hit.properties);
      } else {
        fusedMap.set(hit.key, {
          hit: { ...hit },
          rrfScore: rrfContribution,
        });
      }
    }
  }

  // Sort by RRF score descending
  const results = Array.from(fusedMap.values())
    .sort((a, b) => b.rrfScore - a.rrfScore);

  // Normalize to 0-1 range for compatibility with existing consumers
  const maxScore = results.length > 0 ? results[0]!.rrfScore : 1;
  for (const entry of results) {
    entry.hit.score = maxScore > 0 ? entry.rrfScore / maxScore : 0;
  }

  return results.map((r) => r.hit);
}

// ============================================================================
// Query preprocessing — keyword extraction for NL queries
// ============================================================================

/**
 * Stop words to filter out of NL queries.
 * Inspired by LlamaIndex's simple_extract_keywords.
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'have', 'has', 'had', 'will', 'shall', 'would',
  'should', 'could', 'can', 'may', 'might', 'must', 'need', 'not',
  'and', 'or', 'but', 'if', 'of', 'in', 'on', 'at', 'to', 'for',
  'with', 'from', 'by', 'about', 'into', 'through', 'between',
  'that', 'this', 'it', 'its', 'their', 'these', 'those',
  'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how',
  'all', 'each', 'every', 'both', 'few', 'many', 'much', 'some', 'any',
  'other', 'more', 'most', 'own', 'same', 'such', 'very', 'just', 'also',
  'than', 'then', 'there', 'here', 'only',
  // Imperative verbs common in NL queries about code
  'show', 'find', 'list', 'get', 'tell', 'explain', 'describe', 'give',
  'me', 'my', 'i',
]);

/**
 * Extract search terms from a query string.
 *
 * Handles both direct symbol lookups ("hybridSearch") and NL queries
 * ("What does the hybridSearch function do?").
 *
 * Uses three complementary techniques (all zero-latency, no LLM):
 * 1. camelCase/PascalCase identifier detection (code-specific)
 * 2. Stopword removal (LlamaIndex simple_extract_keywords pattern)
 * 3. Identifier sub-word splitting (code search best practice)
 *
 * @returns Array of search terms, highest-priority first
 */
export function extractSearchTerms(query: string): string[] {
  const trimmed = query.trim();

  // Fast path: if the query is already a single symbol, return it as-is
  if (/^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(trimmed)) {
    return [trimmed];
  }

  const terms: string[] = [];
  const seen = new Set<string>();

  const addTerm = (t: string) => {
    const lower = t.toLowerCase();
    if (lower.length > 1 && !seen.has(lower)) {
      seen.add(lower);
      terms.push(t);
    }
  };

  // 1. Extract camelCase identifiers (e.g., "hybridSearch", "indexProject")
  //    These are highest-priority — likely the exact symbol the user is asking about
  const camelCaseMatches = trimmed.match(/\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b/g) ?? [];
  for (const m of camelCaseMatches) addTerm(m);

  // 2. Extract PascalCase identifiers (e.g., "SearchRegistry", "GraphClient")
  const pascalCaseMatches = trimmed.match(/\b[A-Z][a-z]+(?:[A-Z][a-z0-9]+)+\b/g) ?? [];
  for (const m of pascalCaseMatches) addTerm(m);

  // 3. Extract snake_case identifiers
  const snakeCaseMatches = trimmed.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? [];
  for (const m of snakeCaseMatches) addTerm(m);

  // 4. Split camelCase/PascalCase identifiers into sub-words
  //    "hybridSearch" → ["hybrid", "search"]
  //    This enables fuzzy matching: "hybrid search" in query matches "hybridSearch" node
  for (const m of [...camelCaseMatches, ...pascalCaseMatches]) {
    const subWords = m
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    for (const w of subWords) addTerm(w);
  }

  // 5. Tokenize remaining words, remove stopwords
  const words = trimmed
    .split(/[\s,;:!?.()\[\]{}'"`]+/)
    .map((w) => w.replace(/^[^a-zA-Z]+|[^a-zA-Z0-9]+$/g, ''))
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w.toLowerCase()));
  for (const w of words) addTerm(w);

  return terms;
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

/**
 * Text search using extracted keywords with OR semantics.
 *
 * For each search term, checks:
 *   - n.name CONTAINS term (symbol name matching)
 *   - n.docstring CONTAINS term (documentation matching, for NL queries)
 *
 * Runs a single Cypher query with OR across all terms.
 */
async function textSearchNodes(
  client: GraphClient,
  query: string,
  nodeTypes: readonly string[],
  limit: number,
  scope?: string,
): Promise<TextSearchHit[]> {
  const terms = extractSearchTerms(query);
  if (terms.length === 0) return [];

  const dialect = client.dialect;
  const firstLabel = dialect.firstLabelExpr('n');

  // Build label filter
  const labelClauses = nodeTypes.map(
    (nt) => dialect.labelCheckExpr('n', nt),
  );
  const labelFilter = `(${labelClauses.join(' OR ')})`;

  const scopeFilter = scope ? 'AND n.filePath STARTS WITH $scope' : '';

  // Build OR conditions for each search term:
  // Match against name (primary) and docstring (secondary).
  // filePath is intentionally excluded — it causes false positives (e.g.,
  // searching "hybridSearch" would return RowType just because it lives in
  // hybridSearch.ts). File-scoped queries should use NL_TO_CYPHER instead.
  const termConditions = terms.map((_, i) => {
    const nameMatch = `toLower(n.name) CONTAINS toLower($term${i})`;
    const docMatch = `(n.docstring IS NOT NULL AND toLower(n.docstring) CONTAINS toLower($term${i}))`;
    return `(${nameMatch} OR ${docMatch})`;
  });

  // Any term matching is sufficient (OR semantics)
  const matchFilter = termConditions.length === 1
    ? termConditions[0]
    : `(${termConditions.join(' OR ')})`;

  // Case-insensitive name search with relevance-based ordering.
  // Nodes matching more terms in name rank higher than docstring-only matches.
  // All nodes use `filePath` for their file path property.
  const nameMatchScores = terms.map((_, i) =>
    `CASE WHEN toLower(n.name) CONTAINS toLower($term${i}) THEN 1 ELSE 0 END`,
  );
  const relevanceExpr = nameMatchScores.length === 1
    ? nameMatchScores[0]
    : `(${nameMatchScores.join(' + ')})`;

  const cypher = `
    MATCH (n)
    WHERE ${labelFilter}
      AND ${matchFilter}
      ${scopeFilter}
    RETURN n.name AS name, ${firstLabel} AS nodeType,
           n.filePath AS filePath,
           n.startLine AS startLine
    ORDER BY ${relevanceExpr} DESC, n.name
    LIMIT $limit
  `;

  const params: Record<string, string | number | boolean | null | Array<unknown>> = { limit };
  // Add each search term as a query parameter
  for (let i = 0; i < terms.length; i++) {
    params[`term${i}`] = terms[i]!;
  }
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
