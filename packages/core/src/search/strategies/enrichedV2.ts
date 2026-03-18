/**
 * ENRICHED_V2 Search Strategy — Vector retrieval + cross-encoder reranking.
 */

import type {
  SearchStrategy,
  SearchRequest,
  SearchResponse,
  SearchContext,
  SearchResultItem,
} from '../types';
import { enrichedSearchV2, type EnrichedV2Options } from '../../enrichedSearchV2';

export class EnrichedV2Strategy implements SearchStrategy {
  readonly type = 'ENRICHED_V2' as const;
  readonly description = 'Enriched V2: vector retrieval + cross-encoder reranking (no LLM)';
  readonly requiresLLM = false;

  async search(request: SearchRequest, context: SearchContext): Promise<SearchResponse> {
    const opts: EnrichedV2Options = {
      limit: request.limit ?? 20,
    };

    if (context.embeddings) opts.embeddings = context.embeddings;
    if (request.scope) opts.scope = request.scope;

    const result = await enrichedSearchV2(request.query, context.client, opts);

    const results: SearchResultItem[] = result.hits.map(hit => ({
      name: hit.name,
      nodeType: hit.nodeType,
      score: hit.score,
      sources: hit.sources,
      properties: hit.properties,
      ...(hit.filePath && { filePath: hit.filePath }),
      ...(hit.startLine != null && { startLine: hit.startLine }),
    }));

    return {
      results,
      total: results.length,
      meta: {
        searchType: 'ENRICHED_V2' as any,
        durationMs: result.meta.durationMs,
        vectorHits: result.meta.vectorHits,
      },
    };
  }
}
