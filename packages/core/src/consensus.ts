/**
 * Dual-Path Consensus Scoring (DRCE Phase 0)
 *
 * Compares what the graph path (knowledge graph traversal) and vector path
 * (enrichedSearchV2) independently return for the same query. Measures agreement
 * as a signal for retrieval confidence.
 *
 * When both paths agree, confidence is high. When they disagree, that's a
 * valuable signal — both result sets are returned so the consumer can decide.
 *
 * Pure function — no side effects, easily testable.
 */

import { createLogger } from '@codegraph/logger';
import type { GraphClient } from '@codegraph/graph';
import { enrichedSearchV2, type EnrichedV2Options } from './enrichedSearchV2';
import { getKnowledgeOps } from './knowledgeClient';
import { generateEmbedding, isEmbeddingAvailable } from '@codegraph/plugin-nlp';

const logger = createLogger({ namespace: 'core:consensus' });

// ============================================================================
// Types
// ============================================================================

export interface ConsensusResult {
  /** Overall consensus score (0.0–1.0). Higher = more agreement. */
  consensusScore: number;
  /** Per-path results */
  vectorPath: {
    results: Array<{ name: string; type: string; filePath?: string | undefined }>;
    count: number;
  };
  graphPath: {
    results: Array<{ name: string; type: string; confidence: number }>;
    count: number;
  };
  /** Names that appear in BOTH paths */
  overlap: string[];
  /** Names only in vector path */
  vectorOnly: string[];
  /** Names only in graph path */
  graphOnly: string[];
  /** Total duration */
  durationMs: number;
}

export interface ConsensusOptions extends EnrichedV2Options {
  /** Number of results per path (default: 10) */
  topK?: number;
}

// ============================================================================
// Consensus Scoring
// ============================================================================

/**
 * Compute consensus score from two name sets.
 * Uses Jaccard similarity: |intersection| / |union|
 */
export function computeConsensus(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 1.0; // both empty = agreement
  if (setA.size === 0 || setB.size === 0) return 0.0; // one empty = no agreement

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

/**
 * Run both retrieval paths independently and compute agreement.
 *
 * - Vector path: enrichedSearchV2 (vector + cross-encoder reranking)
 * - Graph path: knowledge graph entity search (vector search on Entity nodes)
 *
 * Returns results from both paths plus consensus metrics.
 */
export async function dualRetrieve(
  query: string,
  client: GraphClient,
  options: ConsensusOptions = {},
): Promise<ConsensusResult> {
  const start = Date.now();
  const topK = options.topK ?? 10;

  // Run both paths in parallel
  const [vectorResults, graphResults] = await Promise.all([
    // Vector path: code search via enrichedSearchV2
    enrichedSearchV2(query, client, { ...options, limit: topK }),

    // Graph path: knowledge entity search
    (async () => {
      if (!isEmbeddingAvailable()) return [];
      try {
        const { embedding } = await generateEmbedding(query);
        const ops = await getKnowledgeOps();
        return await ops.searchEntitiesByVector(embedding, topK);
      } catch {
        return [];
      }
    })(),
  ]);

  // Extract names for comparison
  const vectorNames = new Set(vectorResults.hits.map(h => h.name.toLowerCase()));
  const graphNames = new Set(graphResults.map(e => e.text.toLowerCase()));

  // Compute consensus
  const consensusScore = computeConsensus(vectorNames, graphNames);

  // Compute overlap/differences
  const overlap: string[] = [];
  const vectorOnly: string[] = [];
  const graphOnly: string[] = [];

  for (const name of vectorNames) {
    if (graphNames.has(name)) {
      overlap.push(name);
    } else {
      vectorOnly.push(name);
    }
  }
  for (const name of graphNames) {
    if (!vectorNames.has(name)) {
      graphOnly.push(name);
    }
  }

  const durationMs = Date.now() - start;

  logger.info(
    `Consensus "${query.slice(0, 40)}": score=${consensusScore.toFixed(2)}, ` +
    `overlap=${overlap.length}, vectorOnly=${vectorOnly.length}, graphOnly=${graphOnly.length} (${durationMs}ms)`
  );

  return {
    consensusScore,
    vectorPath: {
      results: vectorResults.hits.map(h => ({
        name: h.name,
        type: h.nodeType,
        filePath: h.filePath,
      })),
      count: vectorResults.hits.length,
    },
    graphPath: {
      results: graphResults.map(e => ({
        name: e.text,
        type: e.type,
        confidence: e.confidence,
      })),
      count: graphResults.length,
    },
    overlap,
    vectorOnly,
    graphOnly,
    durationMs,
  };
}
