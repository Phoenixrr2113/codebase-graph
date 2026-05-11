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

  // RRF fusion of both sources (FusionItem hoisted to module scope below)
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

  // Cross-modal expansion: when a knowledge document ranks highly (via any of
  // its extracted entities), every code symbol that ANY of that document's
  // entities ABOUT-link to becomes a candidate. Example: knowledge-002 is the
  // "validation layer spec" document. It contains entities ZodObject, ZodString,
  // ZodError, plus non-code entities like ValidationLayer. Bridge linker created
  // ABOUT edges from all the code-typed entities to their corresponding code
  // nodes. So when knowledge-002 surfaces (via any of its entities), all those
  // code nodes get a cross-modal RRF contribution. Code nodes that ALSO appear
  // in the vector code pool get summed contributions and rise; code nodes only
  // reachable via knowledge surface from a query-text mismatch.
  const topSampleIds = collectTopSampleIds(knowledgeResults ?? [], 10);
  const crossModalCodeList: FusionItem[] = await expandKnowledgeToCode(
    client,
    topSampleIds,
  );

  if (process.env['CODEGRAPH_DEBUG_RRF'] === '1') {
    process.stderr.write(`[rrf-debug] cross-modal expansion: ${crossModalCodeList.length} code nodes from ABOUT edges\n`);
    crossModalCodeList.slice(0, 10).forEach((f, i) => {
      const ces = f.crossEncoderScore !== undefined ? ` ce=${f.crossEncoderScore.toFixed(2)}` : '';
      process.stderr.write(`  [${i + 1}] ${f.item.name} (${f.item.type}) ${f.item.filePath ?? ''}${ces}\n`);
    });
  }

  const fused = rrfFuse<FusionItem>(
    [
      { items: codeList, weight: codeWeight },
      { items: knowledgeList, weight: knowledgeWeight },
      {
        items: crossModalCodeList,
        weight: codeWeight,
        scoreOf: (f) => f.crossEncoderScore ?? 1.0,
      },
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

// ============================================================================
// Cross-modal expansion via ABOUT edges
// ============================================================================

type FusionItem = {
  source: 'code' | 'knowledge';
  id: string;
  item: UnifiedSearchResult;
  /** Cross-encoder boost (cross-modal expansion items only). Default 1.0. */
  crossEncoderScore?: number;
};

interface SampleIdRanked {
  sampleId: string;
  /** Best (lowest, 0-indexed) position this sampleId held in the knowledge result list */
  bestRank: number;
}

/**
 * Walk the ranked knowledge results and collect distinct source documents
 * (`sampleIds[0]`), preserving the best rank each one achieved. Limit to topN
 * unique sources to bound the expansion query cost.
 */
function collectTopSampleIds(
  knowledgeResults: ReadonlyArray<{ sampleIds?: string[] | undefined }>,
  topN: number,
): SampleIdRanked[] {
  const seen = new Map<string, number>();
  for (let i = 0; i < knowledgeResults.length; i++) {
    const sid = knowledgeResults[i]?.sampleIds?.[0];
    if (!sid) continue;
    if (!seen.has(sid)) {
      seen.set(sid, i);
      if (seen.size >= topN) break;
    }
  }
  return Array.from(seen.entries()).map(([sampleId, bestRank]) => ({ sampleId, bestRank }));
}

/**
 * For each top-ranked knowledge source document, find all code nodes that any
 * of that document's extracted entities ABOUT-link to. Returns FusionItems
 * sorted by the source document's rank in the knowledge pool — best-ranked
 * sources contribute their code nodes earliest (which translates to higher
 * RRF position weight). De-duplicates code nodes across sources.
 */
async function expandKnowledgeToCode(
  client: GraphClient,
  rankedSources: SampleIdRanked[],
): Promise<FusionItem[]> {
  if (rankedSources.length === 0) return [];

  const cypher = `
    UNWIND $sources AS src
    MATCH (e:Entity)-[r:ABOUT]->(t)
    WHERE src.sampleId IN coalesce(e.sampleIds, [])
    RETURN src.bestRank AS srcRank,
           t.name AS name,
           labels(t)[0] AS nodeType,
           t.filePath AS filePath,
           r.confidence AS confidence,
           r.crossEncoderScore AS crossEncoderScore
    ORDER BY srcRank, coalesce(r.crossEncoderScore, r.confidence) DESC
    LIMIT 100
  `;

  try {
    const result = await client.roQuery<{
      srcRank: number;
      name: string;
      nodeType: string;
      filePath: string | null;
      confidence: number | null;
      crossEncoderScore: number | null;
    }>(cypher, { params: { sources: rankedSources } });

    const seen = new Set<string>();
    const items: FusionItem[] = [];
    for (const row of result.data) {
      const id = `code:${row.name}:${row.filePath ?? ''}`;
      if (seen.has(id)) continue;
      seen.add(id);
      items.push({
        source: 'code',
        id,
        crossEncoderScore: row.crossEncoderScore ?? 1.0,
        item: {
          source: 'code',
          name: row.name,
          type: row.nodeType,
          score: 0,
          ...(row.filePath ? { filePath: row.filePath } : {}),
          properties: {
            crossModalSource: 'ABOUT-edge',
            crossModalConfidence: row.confidence ?? null,
            crossEncoderScore: row.crossEncoderScore ?? null,
          },
        },
      });
    }
    return items;
  } catch (err) {
    logger.debug(`Cross-modal expansion failed (non-fatal): ${err}`);
    return [];
  }
}
