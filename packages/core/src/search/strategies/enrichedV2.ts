/**
 * ENRICHED_V2 Search Strategy — Clean incremental build.
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
  readonly description = 'Enriched V2: clean incremental multi-signal search (no LLM)';
  readonly requiresLLM = false;

  constructor(private signals?: Partial<Record<string, boolean>>) {}

  async search(request: SearchRequest, context: SearchContext): Promise<SearchResponse> {
    const opts: EnrichedV2Options = {
      limit: request.limit ?? 20,
    };

    if (context.embeddings) opts.embeddings = context.embeddings;
    if (request.scope) opts.scope = request.scope;
    if (this.signals) opts.signals = this.signals as any;

    const result = await enrichedSearchV2(request.query, context.client, opts);

    const results: SearchResultItem[] = result.hits.map(hit => {
      const item: SearchResultItem = {
        name: hit.name,
        nodeType: hit.nodeType,
        score: hit.score,
        sources: hit.sources,
        properties: hit.properties,
      };
      if (hit.filePath) item.filePath = hit.filePath;
      if (hit.startLine != null) item.startLine = hit.startLine;
      return item;
    });

    return {
      results,
      total: results.length,
      meta: {
        searchType: 'ENRICHED_V2' as any,
        durationMs: result.meta.durationMs,
        vectorHits: result.meta.vectorHits,
        textHits: result.meta.textHits,
        importanceHits: result.meta.importanceHits,
        signals: result.meta.signals,
      },
    };
  }
}
