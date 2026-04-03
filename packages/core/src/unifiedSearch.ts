/**
 * Unified Search — Code + Knowledge via Reciprocal Rank Fusion (RRF)
 *
 * Runs enrichedSearchV2 (code) and searchEntitiesByVector (knowledge) in parallel.
 * Merges results using RRF. Each result is labeled with its source.
 */

import { createLogger } from '@codegraph/logger';
import type { GraphClient } from '@codegraph/graph';
import { enrichedSearchV2, rrfFuse, type EnrichedV2Options } from './enrichedSearchV2';
import { getKnowledgeOps } from './knowledgeClient';
import { generateEmbedding, isEmbeddingAvailable } from '@codegraph/plugin-nlp';

const logger = createLogger({ namespace: 'core:unified-search' });

// ============================================================================
// Types
// ============================================================================

export interface UnifiedSearchResult {
  /** Source: 'code' or 'knowledge' */
  source: 'code' | 'knowledge';
  /** Display name */
  name: string;
  /** Type label (nodeType for code, entityType for knowledge) */
  type: string;
  /** RRF-fused relevance score */
  score: number;
  /** File path (code results only) */
  filePath?: string | undefined;
  /** Additional properties depending on source */
  properties: Record<string, unknown>;
}

export interface UnifiedSearchOptions extends EnrichedV2Options {
  /** Which sources to search: 'all', 'code', or 'knowledge' (default: 'all') */
  searchScope?: 'all' | 'code' | 'knowledge';
  /** Weight for code results in RRF (default: 1.0) */
  codeWeight?: number;
  /** Weight for knowledge results in RRF (default: 0.8) */
  knowledgeWeight?: number;
}

export interface UnifiedSearchResponse {
  results: UnifiedSearchResult[];
  meta: {
    query: string;
    codeHits: number;
    knowledgeHits: number;
    durationMs: number;
  };
}

// ============================================================================
// Unified Search
// ============================================================================

export async function unifiedSearch(
  query: string,
  client: GraphClient,
  options: UnifiedSearchOptions = {},
): Promise<UnifiedSearchResponse> {
  const start = Date.now();
  const limit = options.limit ?? 20;
  const searchScope = options.searchScope ?? 'all';
  const codeWeight = options.codeWeight ?? 1.0;
  const knowledgeWeight = options.knowledgeWeight ?? 0.8;

  // Run both searches in parallel
  const [codeResults, knowledgeResults] = await Promise.all([
    // Code search
    (searchScope === 'knowledge')
      ? Promise.resolve(null)
      : enrichedSearchV2(query, client, { ...options, limit: limit * 2 }),
    // Knowledge search
    (searchScope === 'code' || !isEmbeddingAvailable())
      ? Promise.resolve(null)
      : (async () => {
          try {
            const { embedding } = await generateEmbedding(query);
            const ops = await getKnowledgeOps();
            return await ops.searchEntitiesByVector(embedding, limit * 2);
          } catch (err) {
            logger.warn(`Knowledge vector search failed: ${err}`);
            return null;
          }
        })(),
  ]);

  const codeHits = codeResults?.hits.length ?? 0;
  const knowledgeHits = knowledgeResults?.length ?? 0;

  // If only one source, return directly without RRF
  if (searchScope === 'code' || knowledgeHits === 0) {
    const results: UnifiedSearchResult[] = (codeResults?.hits ?? []).slice(0, limit).map((h, i) => ({
      source: 'code' as const,
      name: h.name,
      type: h.nodeType,
      score: 1.0 / (60 + i + 1),
      filePath: h.filePath,
      properties: { ...h },
    }));
    return {
      results,
      meta: { query, codeHits, knowledgeHits: 0, durationMs: Date.now() - start },
    };
  }

  if (searchScope === 'knowledge' || codeHits === 0) {
    const results: UnifiedSearchResult[] = (knowledgeResults ?? []).slice(0, limit).map((e, i) => ({
      source: 'knowledge' as const,
      name: e.text,
      type: e.type,
      score: 1.0 / (60 + i + 1),
      properties: {
        confidence: e.confidence,
        relevance: e.relevanceScore,
        createdAt: new Date(e.createdAt).toISOString(),
      },
    }));
    return {
      results,
      meta: { query, codeHits: 0, knowledgeHits, durationMs: Date.now() - start },
    };
  }

  // RRF fusion of both sources
  type FusionItem = { source: 'code' | 'knowledge'; id: string; item: UnifiedSearchResult };

  const codeList: FusionItem[] = (codeResults?.hits ?? []).map(h => ({
    source: 'code' as const,
    id: `code:${h.name}:${h.filePath ?? ''}`,
    item: {
      source: 'code' as const,
      name: h.name,
      type: h.nodeType,
      score: 0,
      filePath: h.filePath,
      properties: { ...h },
    },
  }));

  const knowledgeList: FusionItem[] = (knowledgeResults ?? []).map(e => ({
    source: 'knowledge' as const,
    id: `knowledge:${e.text}:${e.type}`,
    item: {
      source: 'knowledge' as const,
      name: e.text,
      type: e.type,
      score: 0,
      properties: {
        confidence: e.confidence,
        relevance: e.relevanceScore,
        createdAt: new Date(e.createdAt).toISOString(),
      },
    },
  }));

  const fused = rrfFuse<FusionItem>(
    [
      { items: codeList, weight: codeWeight },
      { items: knowledgeList, weight: knowledgeWeight },
    ],
    (item) => item.id,
  );

  const results = fused.slice(0, limit).map(f => ({
    ...f.item.item,
    score: f.score,
  }));

  const durationMs = Date.now() - start;
  logger.info(`Unified search "${query.slice(0, 60)}": ${results.length} results (${codeHits} code, ${knowledgeHits} knowledge) in ${durationMs}ms`);

  return {
    results,
    meta: { query, codeHits, knowledgeHits, durationMs },
  };
}
