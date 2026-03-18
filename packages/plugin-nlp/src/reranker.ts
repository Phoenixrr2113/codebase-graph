/**
 * Reranker — cross-encoder reranking for search results.
 *
 * Configurable via environment variables:
 *   CODEGRAPH_RERANK_PROVIDER: 'voyage' | 'jina' (default: auto-detect from available API keys)
 *   CODEGRAPH_RERANK_MODEL: model name override (default: provider-specific)
 *   CODEGRAPH_RERANK: 'false' to disable reranking entirely
 *   VOYAGE_API_KEY: API key for Voyage
 *   JINA_API_KEY: API key for Jina
 *
 * Graceful degradation: if no API key is available, returns original order.
 */

import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'nlp:reranker' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RerankProvider = 'voyage' | 'jina';

export interface RerankResult {
  /** Original index in the input documents array */
  index: number;
  /** Relevance score from the reranker (0-1, higher = more relevant) */
  relevanceScore: number;
}

export interface RerankOptions {
  /** Reranker provider override */
  provider?: RerankProvider;
  /** Reranker model override */
  model?: string;
  /** Number of top results to return (default: all) */
  topK?: number;
}

// ---------------------------------------------------------------------------
// Provider config
// ---------------------------------------------------------------------------

interface ProviderConfig {
  apiUrl: string;
  apiKeyEnv: string;
  defaultModel: string;
  /** Map provider response to our format */
  parseResponse: (json: unknown) => RerankResult[];
  /** Build provider-specific request body */
  buildBody: (query: string, documents: string[], model: string, topK: number) => Record<string, unknown>;
}

const PROVIDERS: Record<RerankProvider, ProviderConfig> = {
  voyage: {
    apiUrl: 'https://api.voyageai.com/v1/rerank',
    apiKeyEnv: 'VOYAGE_API_KEY',
    defaultModel: 'rerank-2',
    buildBody: (query, documents, model, topK) => ({
      query, documents, model, top_k: topK,
    }),
    parseResponse: (json) => {
      const res = json as { data: Array<{ index: number; relevance_score: number }> };
      return res.data.map(d => ({
        index: d.index,
        relevanceScore: d.relevance_score,
      }));
    },
  },
  jina: {
    apiUrl: 'https://api.jina.ai/v1/rerank',
    apiKeyEnv: 'JINA_API_KEY',
    defaultModel: 'jina-reranker-v2-base-multilingual',
    buildBody: (query, documents, model, topK) => ({
      query, documents, model, top_n: topK,
    }),
    parseResponse: (json) => {
      const res = json as { results: Array<{ index: number; relevance_score: number }> };
      return res.results.map(d => ({
        index: d.index,
        relevanceScore: d.relevance_score,
      }));
    },
  },
};

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

function resolveProvider(override?: RerankProvider): RerankProvider | null {
  // Explicit override
  if (override) return override;

  // Environment variable
  const envProvider = process.env['CODEGRAPH_RERANK_PROVIDER'];
  if (envProvider && envProvider in PROVIDERS) return envProvider as RerankProvider;

  // Auto-detect from available API keys
  for (const [name, config] of Object.entries(PROVIDERS)) {
    if (process.env[config.apiKeyEnv]) return name as RerankProvider;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check if any reranker provider is available.
 */
export function isRerankAvailable(): boolean {
  if (process.env['CODEGRAPH_RERANK'] === 'false') return false;
  return resolveProvider() !== null;
}

/**
 * Rerank documents by relevance to a query using a cross-encoder.
 *
 * Provider is auto-detected from available API keys, or can be set via
 * CODEGRAPH_RERANK_PROVIDER env var or options.provider.
 *
 * Graceful degradation: if no provider is available or API fails,
 * returns original order with synthetic scores.
 */
export async function rerank(
  query: string,
  documents: string[],
  options?: RerankOptions,
): Promise<RerankResult[]> {
  if (documents.length === 0) return [];

  const providerName = resolveProvider(options?.provider);
  if (!providerName) {
    logger.debug('Reranker unavailable (no API key), returning original order');
    return fallbackScores(documents.length, options?.topK);
  }

  const provider = PROVIDERS[providerName]!;
  const apiKey = process.env[provider.apiKeyEnv];
  if (!apiKey) {
    logger.debug(`Reranker ${providerName} unavailable (no ${provider.apiKeyEnv})`);
    return fallbackScores(documents.length, options?.topK);
  }

  const model = options?.model ?? process.env['CODEGRAPH_RERANK_MODEL'] ?? provider.defaultModel;
  const topK = options?.topK ?? documents.length;

  try {
    const start = performance.now();

    const response = await fetch(provider.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(provider.buildBody(query, documents, model, topK)),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      logger.warn(`Reranker API error ${response.status}: ${errText}`);
      return fallbackScores(documents.length, topK);
    }

    const json = await response.json();
    const ms = (performance.now() - start).toFixed(0);
    logger.debug(`Reranked ${documents.length} docs in ${ms}ms (${providerName}/${model})`);

    return provider.parseResponse(json)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  } catch (err) {
    logger.warn(`Reranker failed: ${err instanceof Error ? err.message : err}`);
    return fallbackScores(documents.length, topK);
  }
}

// ---------------------------------------------------------------------------
// Fallback
// ---------------------------------------------------------------------------

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
