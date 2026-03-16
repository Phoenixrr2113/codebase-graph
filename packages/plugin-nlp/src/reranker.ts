/**
 * Voyage AI Reranker — cross-encoder reranking for search results.
 *
 * Uses Voyage's rerank-2 model to re-score search results based on
 * query-document relevance. Cross-encoder models see query+document together,
 * yielding ~14% accuracy improvement over embedding-only retrieval.
 *
 * Graceful degradation: if VOYAGE_API_KEY is not set or the API fails,
 * returns the original order with synthetic scores.
 */

import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'nlp:reranker' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RerankResult {
  /** Original index in the input documents array */
  index: number;
  /** Relevance score from the reranker (0-1, higher = more relevant) */
  relevanceScore: number;
}

export interface RerankOptions {
  /** Reranker model (default: 'rerank-2') */
  model?: string;
  /** Number of top results to return (default: all) */
  topK?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RERANK_API_URL = 'https://api.voyageai.com/v1/rerank';
const DEFAULT_MODEL = 'rerank-2';

// ---------------------------------------------------------------------------
// API response type
// ---------------------------------------------------------------------------

interface VoyageRerankResponse {
  data: Array<{
    index: number;
    relevance_score: number;
  }>;
  usage: {
    total_tokens: number;
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if the reranker is available (VOYAGE_API_KEY is set).
 */
export function isRerankAvailable(): boolean {
  if (process.env['CODEGRAPH_RERANK'] === 'false') return false;
  return !!process.env['VOYAGE_API_KEY'];
}

/**
 * Rerank documents by relevance to a query using Voyage AI's cross-encoder.
 *
 * @param query - The search query
 * @param documents - Array of document texts to rerank
 * @param options - Reranker options
 * @returns Reranked results sorted by relevance (highest first)
 *
 * Graceful degradation: if API key is missing or API fails, returns
 * original order with linearly decaying synthetic scores.
 */
export async function rerank(
  query: string,
  documents: string[],
  options?: RerankOptions,
): Promise<RerankResult[]> {
  if (documents.length === 0) return [];

  const apiKey = process.env['VOYAGE_API_KEY'];
  if (!apiKey) {
    logger.debug('Reranker unavailable (no VOYAGE_API_KEY), returning original order');
    return fallbackScores(documents.length, options?.topK);
  }

  const model = options?.model ?? DEFAULT_MODEL;
  const topK = options?.topK ?? documents.length;

  try {
    const start = performance.now();

    const response = await fetch(RERANK_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        query,
        documents,
        model,
        top_k: topK,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      logger.warn(`Reranker API error ${response.status}: ${errText}`);
      return fallbackScores(documents.length, topK);
    }

    const json = (await response.json()) as VoyageRerankResponse;
    const ms = (performance.now() - start).toFixed(0);
    logger.debug(`Reranked ${documents.length} docs in ${ms}ms (model: ${model})`);

    return json.data
      .map((d) => ({
        index: d.index,
        relevanceScore: d.relevance_score,
      }))
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  } catch (err) {
    logger.warn(`Reranker failed: ${err instanceof Error ? err.message : err}`);
    return fallbackScores(documents.length, topK);
  }
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

/**
 * Generate synthetic scores preserving original order.
 * Used when the reranker API is unavailable.
 */
function fallbackScores(count: number, topK?: number): RerankResult[] {
  const results: RerankResult[] = [];
  const n = topK ? Math.min(topK, count) : count;
  for (let i = 0; i < n; i++) {
    results.push({
      index: i,
      relevanceScore: 1 - i / Math.max(count, 1),
    });
  }
  return results;
}
