/**
 * Reranker — cross-encoder reranking for search results.
 *
 * Configurable via environment variables:
 *   CODEGRAPH_RERANK_PROVIDER: 'voyage' (default; auto-detected from VOYAGE_API_KEY)
 *   CODEGRAPH_RERANK_MODEL: model name override (default: 'rerank-2')
 *   CODEGRAPH_RERANK: 'false' to disable reranking entirely
 *   VOYAGE_API_KEY: API key for Voyage
 *
 * On failure (4xx/5xx, network error, missing key) the reranker logs loudly
 * and falls back to vector-search-only ordering. Callers can detect the
 * fallback via `getLastRerankWarning()` and surface it to end users.
 */

import { createLogger, traced } from '@codegraph/logger';

const logger = createLogger({ namespace: 'nlp:reranker' });

// ---------------------------------------------------------------------------
// Warning state — module-level, survives across calls
// ---------------------------------------------------------------------------

let lastRerankWarning: string | null = null;

/**
 * Returns the most recent reranker warning, or null if the last call succeeded.
 * Set whenever the reranker falls back to vector-only order (API error,
 * missing key, deprecated provider, etc).
 */
export function getLastRerankWarning(): string | null {
  return lastRerankWarning;
}

/** Clears the last reranker warning. Caller should clear before each rerank
 *  call when they care about per-call status. */
export function clearLastRerankWarning(): void {
  lastRerankWarning = null;
}

function recordRerankWarning(reason: string): void {
  lastRerankWarning = reason;
  // process.stderr.write is more visible than logger.warn — survives pino transport
  // misconfiguration and shows up in plain `node` invocations.
  process.stderr.write(`[reranker] WARNING: ${reason}\n`);
}



// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RerankProvider = 'voyage';

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
};

// ---------------------------------------------------------------------------
// Provider resolution
// ---------------------------------------------------------------------------

function resolveProvider(override?: RerankProvider): RerankProvider | null {
  // Explicit override
  if (override) return override;

  const envProvider = process.env['CODEGRAPH_RERANK_PROVIDER'];

  // Jina was removed — reject clearly so users know to switch
  if (envProvider === 'jina') {
    recordRerankWarning(
      'CODEGRAPH_RERANK_PROVIDER=jina is not supported. ' +
      'Use voyage instead: set CODEGRAPH_RERANK_PROVIDER=voyage and VOYAGE_API_KEY.',
    );
    return null;
  }

  // Environment variable
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
async function rerankImpl(
  query: string,
  documents: string[],
  options?: RerankOptions,
): Promise<RerankResult[]> {
  if (documents.length === 0) return [];

  // Reset warning at the start of each attempt so callers get per-call status
  lastRerankWarning = null;

  const providerName = resolveProvider(options?.provider);
  if (!providerName) {
    // resolveProvider may have already recorded a warning (e.g. jina rejection).
    // If not (truly no provider configured), record a generic one now.
    if (!lastRerankWarning) {
      recordRerankWarning('Reranker unavailable: no API key configured (set VOYAGE_API_KEY)');
    }
    return fallbackScores(documents.length, options?.topK);
  }

  const provider = PROVIDERS[providerName]!;
  const apiKey = process.env[provider.apiKeyEnv];
  if (!apiKey) {
    recordRerankWarning(`Reranker unavailable: provider ${providerName} has no ${provider.apiKeyEnv} configured`);
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
      recordRerankWarning(`Reranker API error ${response.status}: ${errText.slice(0, 200)}`);
      return fallbackScores(documents.length, topK);
    }

    const json = await response.json();
    const ms = (performance.now() - start).toFixed(0);
    logger.debug(`Reranked ${documents.length} docs in ${ms}ms (${providerName}/${model})`);

    // Success — warning already cleared at top of function
    return provider.parseResponse(json)
      .sort((a, b) => b.relevanceScore - a.relevanceScore);
  } catch (err) {
    recordRerankWarning(`Reranker request failed: ${err instanceof Error ? err.message : err}`);
    return fallbackScores(documents.length, topK);
  }
}

export const rerank = traced('rerank', rerankImpl);

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
