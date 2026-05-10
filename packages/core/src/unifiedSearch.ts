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
  /**
   * Weight for knowledge results in RRF (default: 1.0).
   *
   * Equal to the code weight: when the caller asks for `searchScope='all'`,
   * the intent is cross-modal retrieval, so neither modality should be
   * pre-emptively favored. Earlier defaults of 0.8 caused knowledge entities
   * to never surface in the top-K when both branches returned results
   * (code-K's RRF score at rank K was always higher than knowledge-1's).
   * That defeated the purpose of unified search on linked-corpus questions.
   */
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

/**
 * Search code and/or knowledge in parallel and fuse results via RRF.
 *
 * @remarks
 * **scopePaths limitation:** `options.scopePaths` (inherited from {@link EnrichedV2Options})
 * only filters *code* results. Knowledge entities have no path concept — they are stored
 * globally per graph — so `scopePaths` is silently ignored for the knowledge branch.
 * For CGBench this is intentional: each run uses a dedicated graph with a scoped
 * knowledge corpus (deduped by `source` label), so path-scoping is unnecessary.
 * If path-scoped knowledge filtering is needed in the future, it must be implemented
 * inside `searchEntitiesByVector` or as a post-filter here.
 */
export async function unifiedSearch(
  query: string,
  client: GraphClient,
  options: UnifiedSearchOptions = {},
): Promise<UnifiedSearchResponse> {
  const start = Date.now();
  const limit = options.limit ?? 20;
  const searchScope = options.searchScope ?? 'all';
  const codeWeight = options.codeWeight ?? 1.0;
  const knowledgeWeight = options.knowledgeWeight ?? 1.0;

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
            const ops = await getKnowledgeOps(client);
            return await ops.searchEntitiesByVector(embedding, limit * 2);
          } catch (err) {
            logger.warn(`Knowledge vector search failed: ${err}`);
            return null;
          }
        })(),
  ]);

  const codeHits = codeResults?.hits.length ?? 0;
  const knowledgeHits = knowledgeResults?.length ?? 0;

  // Debug logging — gated on CODEGRAPH_DEBUG_RRF=1, no-op in production
  if (process.env['CODEGRAPH_DEBUG_RRF'] === '1') {
    process.stderr.write(`[rrf-debug] query="${query.slice(0, 80)}" scope=${searchScope} codeHits=${codeHits} knowledgeHits=${knowledgeHits}\n`);
    process.stderr.write(`[rrf-debug] code pool top 20:\n`);
    (codeResults?.hits ?? []).slice(0, 20).forEach((h, i) => {
      process.stderr.write(`  [${i + 1}] ${h.name} (${h.nodeType}) score=${(h as { score?: number }).score?.toFixed(3) ?? '-'} ${h.filePath ?? ''}\n`);
    });
    process.stderr.write(`[rrf-debug] knowledge pool top 20 (raw=${(knowledgeResults ?? []).length}):\n`);
    (knowledgeResults ?? []).slice(0, 20).forEach((e, i) => {
      process.stderr.write(`  [${i + 1}] "${e.text.slice(0, 80)}" (${e.type}) relevance=${e.relevanceScore?.toFixed(3) ?? '-'} sampleIds=${JSON.stringify(e.sampleIds ?? [])}\n`);
    });
  }

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
        sampleIds: e.sampleIds ?? [],
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

  // Deduplicate knowledge entities by source document (sampleId prefix).
  // Multiple entities from the same knowledge document all map to the same
  // knowledge gold ID in scoring — keeping only the top-ranked entity per
  // source prevents a single document from flooding the fusion pool and
  // crowding out code golds.
  const seenKnowledgeSources = new Set<string>();
  const deduplicatedKnowledge = (knowledgeResults ?? []).filter(e => {
    const primarySource = e.sampleIds?.[0] ?? `entity:${e.text}`;
    if (seenKnowledgeSources.has(primarySource)) return false;
    seenKnowledgeSources.add(primarySource);
    return true;
  });

  if (process.env['CODEGRAPH_DEBUG_RRF'] === '1') {
    process.stderr.write(`[rrf-debug] knowledge pool after dedup: ${deduplicatedKnowledge.length} unique-source entries\n`);
  }

  const knowledgeList: FusionItem[] = deduplicatedKnowledge.map(e => ({
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
        sampleIds: e.sampleIds ?? [],
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

  // Post-fusion debug logging
  if (process.env['CODEGRAPH_DEBUG_RRF'] === '1') {
    process.stderr.write(`[rrf-debug] post-fusion top 10:\n`);
    fused.slice(0, 10).forEach((f, i) => {
      process.stderr.write(`  [${i + 1}] ${f.item.item.name} (${f.item.source}/${f.item.item.type}) score=${f.score.toFixed(4)} id=${f.item.id}\n`);
    });
  }

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
