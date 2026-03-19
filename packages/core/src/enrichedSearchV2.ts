/**
 * Enriched Search V2 — Vector retrieval + cross-encoder reranking.
 *
 * Philosophy: use existing tools well instead of writing custom logic.
 * Vector embeddings find candidates, cross-encoder reranker ranks them.
 * No manual NLP, no text scoring, no magic thresholds, no node type biases.
 *
 * Pipeline: query → embed → vector search (wide pool) → reranker → results
 */

import { createLogger } from '@codegraph/logger';
import type { GraphClient } from '@codegraph/graph';
import { createOperations } from '@codegraph/graph';
import {
  generateEmbedding,
  isEmbeddingAvailable,
  rerank,
  type EmbeddingConfig,
} from '@codegraph/plugin-nlp';

const logger = createLogger({ namespace: 'core:enriched-v2' });

// ============================================================================
// Types
// ============================================================================

export interface EnrichedV2Result {
  hits: EnrichedV2Hit[];
  meta: {
    query: string;
    vectorHits: number;
    durationMs: number;
  };
}

export interface EnrichedV2Hit {
  name: string;
  nodeType: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  score: number;
  sources: string[];
  // Node properties (already indexed)
  isExported?: boolean;
  isAsync?: boolean;
  params?: string;
  returnType?: string;
  signature?: string;
  docstring?: string;
  complexity?: number;
  cognitiveComplexity?: number;
  loc?: number;
  // Graph traversal (batch query)
  callerCount?: number;
  callees?: string[];
  importerCount?: number;
  properties: Record<string, unknown>;
}

export interface EnrichedV2Options {
  limit?: number;
  scope?: string;
  embeddings?: EmbeddingConfig;
  /** Disable the reranker (vector-only mode for testing) */
  skipReranker?: boolean;
}

// TODO: Replace with dynamic discovery via `CALL db.indexes()` to find all labels
// with vector indexes. This hardcoded list is JS/TS-specific and misses File, Entity,
// and any language-specific node types (e.g. Struct, Module, Decorator).
const CODE_NODE_TYPES = ['Function', 'Class', 'Interface', 'Component', 'Type', 'Variable'] as const;

// ============================================================================
// Reciprocal Rank Fusion (generic)
//
// For fusing results from *different* retrieval methods (e.g., vector search
// + graph traversal + keyword search). Not currently used — vector + reranker
// is a linear blend because they rank the same candidate pool.
//
// score(item) = Σ weight_i / (k + rank_i)
// k=60 is the standard default (Cormack et al. 2009, Elasticsearch, OpenSearch, Qdrant).
// ============================================================================

export interface RankedList<T> {
  /** Items sorted best-first */
  items: T[];
  /** Weight for this source (default: 1) */
  weight?: number;
}

/**
 * Generic RRF: fuses ranked lists into a single scored ranking.
 * Returns items sorted by fused score descending.
 */
export function rrfFuse<T>(
  lists: RankedList<T>[],
  key: (item: T) => string,
  k: number = 60,
): { item: T; score: number }[] {
  const scores = new Map<string, { item: T; score: number }>();

  for (const list of lists) {
    const weight = list.weight ?? 1;
    for (let i = 0; i < list.items.length; i++) {
      const item = list.items[i]!;
      const id = key(item);
      const contribution = weight / (k + i + 1); // 1-based rank
      const existing = scores.get(id);
      if (existing) {
        existing.score += contribution;
      } else {
        scores.set(id, { item, score: contribution });
      }
    }
  }

  return Array.from(scores.values()).sort((a, b) => b.score - a.score);
}

// ============================================================================
// Graph enrichment — batch fetch relationship data for top hits
// ============================================================================

interface GraphEnrichment {
  callerCount: number;
  callees: string[];
  importerCount: number;
}

async function enrichFromGraph(
  client: GraphClient,
  hits: Candidate[],
): Promise<Map<string, GraphEnrichment>> {
  if (hits.length === 0) return new Map();

  const names = hits.map(h => h.name);

  // Single batch query: for each hit, count callers, callees, importers
  const cypher = `
    UNWIND $names AS symbolName
    OPTIONAL MATCH (n {name: symbolName})<-[:CALLS]-(caller)
    WITH symbolName, n, count(DISTINCT caller) AS callers
    OPTIONAL MATCH (n)-[:CALLS]->(callee)
    WITH symbolName, n, callers, collect(DISTINCT callee.name)[0..5] AS calleeNames
    OPTIONAL MATCH (n)<-[:IMPORTS]-(importer)
    RETURN symbolName, callers, calleeNames, count(DISTINCT importer) AS importers
  `;

  try {
    const result = await client.roQuery<Record<string, unknown>>(cypher, {
      params: { names },
    });

    const map = new Map<string, GraphEnrichment>();
    for (const row of result.data) {
      map.set(row['symbolName'] as string, {
        callerCount: (row['callers'] as number) ?? 0,
        callees: (row['calleeNames'] as string[]) ?? [],
        importerCount: (row['importers'] as number) ?? 0,
      });
    }
    return map;
  } catch (err) {
    logger.warn(`Graph enrichment failed: ${err}`);
    return new Map();
  }
}

// ============================================================================
// Vector search — candidate retrieval
// ============================================================================

function distanceToScore(distance: number): number {
  return Math.max(0, 1 - distance / 2);
}

interface Candidate {
  name: string;
  nodeType: string;
  filePath?: string | undefined;
  startLine?: number | undefined;
  properties: Record<string, unknown>;
  vectorScore: number;
  score: number;
}

/** Key function for rrfFuse when combining retrieval sources */
export function candidateKey(c: Candidate): string {
  return `${c.nodeType}:${c.filePath}:${c.name}`;
}

async function retrieveCandidates(
  client: GraphClient,
  query: string,
  limit: number,
  scope: string | undefined,
  embeddings?: EmbeddingConfig,
): Promise<Candidate[]> {
  if (!isEmbeddingAvailable(embeddings)) return [];

  let queryEmbedding: number[];
  try {
    const result = await generateEmbedding(query, { ...embeddings, inputType: 'query' });
    queryEmbedding = result.embedding;
  } catch (err) {
    logger.warn(`Failed to embed query: ${err}`);
    return [];
  }

  const ops = createOperations(client);
  // Wider pool = more candidates for the reranker to choose from.
  // With 6 types and limit=20: ceil(20*3/6) = 10 per type = ~60 total candidates.
  const perTypeLimit = Math.max(20, Math.ceil(limit * 5 / CODE_NODE_TYPES.length));

  const allResults = await Promise.all(
    CODE_NODE_TYPES.map(nt => ops.searchByVector(nt, queryEmbedding, perTypeLimit)),
  );

  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  for (const results of allResults) {
    for (const r of results) {
      if (scope && r.filePath && !r.filePath.startsWith(scope)) continue;

      const key = `${r.nodeType}:${r.filePath}:${r.name}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const vScore = distanceToScore(r.distance);
      // r.properties contains the full row from searchByVector (all node fields)
      const props = r.properties ?? {};
      candidates.push({
        name: r.name,
        nodeType: r.nodeType,
        filePath: r.filePath,
        startLine: r.startLine,
        properties: props,
        vectorScore: vScore,
        score: vScore,
      });
    }
  }

  return candidates;
}

// ============================================================================
// Main search function
// ============================================================================

export async function enrichedSearchV2(
  query: string,
  client: GraphClient,
  options: EnrichedV2Options = {},
): Promise<EnrichedV2Result> {
  const start = Date.now();
  const limit = options.limit ?? 20;
  const scope = options.scope;

  const candidates = await retrieveCandidates(client, query, limit, scope, options.embeddings);

  if (candidates.length === 0) {
    return { hits: [], meta: { query, vectorHits: 0, durationMs: Date.now() - start } };
  }

  // Sort by vector score for reranker pool selection
  candidates.sort((a, b) => b.score - a.score);

  // Reranker: cross-encoder re-scores top candidates
  if (!options.skipReranker && candidates.length >= 3) {
    const rerankPool = candidates.slice(0, Math.max(limit * 2, 30));
    const docs = rerankPool.map(c => {
      const parts: string[] = [`${c.nodeType}: ${c.name}`];
      if (c.filePath) {
        const relPath = c.filePath.replace(/^.*\/packages\//, 'packages/');
        parts.push(`File: ${relPath}`);
      }
      if (c.properties.signature) parts.push(`Signature: ${String(c.properties.signature).slice(0, 200)}`);
      if (c.properties.docstring) parts.push(String(c.properties.docstring).slice(0, 300));
      return parts.join('\n');
    });

    try {
      const rerankResults = await rerank(query, docs, { topK: rerankPool.length });

      // Reranker score is the final score — it's a cross-encoder that sees
      // both query and document, strictly more informed than our retrieval scores.
      for (const rr of rerankResults) {
        rerankPool[rr.index]!.score = rr.relevanceScore;
      }

      rerankPool.sort((a, b) => b.score - a.score);
      candidates.splice(0, rerankPool.length, ...rerankPool);
    } catch (err) {
      logger.warn(`Reranker failed, using vector scores: ${err}`);
    }
  }

  const topHits = candidates.slice(0, limit);

  // Enrich top hits with graph relationship data (single batch query)
  const enrichments = await enrichFromGraph(client, topHits);

  const durationMs = Date.now() - start;

  logger.info(
    `Enriched V2 search "${query.slice(0, 60)}": ${topHits.length} hits ` +
    `(${candidates.length} vector) in ${durationMs}ms`,
  );

  return {
    hits: topHits.map(c => {
      const graphData = enrichments.get(c.name);
      const props = c.properties;
      return {
        name: c.name,
        nodeType: c.nodeType,
        score: c.score,
        sources: ['vector'],
        properties: props,
        ...(c.filePath && { filePath: c.filePath }),
        ...(c.startLine != null && { startLine: c.startLine }),
        // Node properties (already fetched, just surface them)
        ...(props.endLine != null ? { endLine: props.endLine as number } : {}),
        ...(props.isExported != null ? { isExported: props.isExported as boolean } : {}),
        ...(props.isAsync != null ? { isAsync: props.isAsync as boolean } : {}),
        ...(props.params ? { params: props.params as string } : {}),
        ...(props.returnType ? { returnType: props.returnType as string } : {}),
        ...(props.signature ? { signature: props.signature as string } : {}),
        ...(props.docstring ? { docstring: props.docstring as string } : {}),
        ...(props.complexity != null ? { complexity: props.complexity as number } : {}),
        ...(props.cognitiveComplexity != null ? { cognitiveComplexity: props.cognitiveComplexity as number } : {}),
        ...(props.loc != null ? { loc: props.loc as number } : {}),
        // Graph enrichment (batch query)
        ...(graphData && {
          callerCount: graphData.callerCount,
          callees: graphData.callees,
          importerCount: graphData.importerCount,
        }),
      };
    }),
    meta: {
      query,
      vectorHits: candidates.length,
      durationMs,
    },
  };
}
