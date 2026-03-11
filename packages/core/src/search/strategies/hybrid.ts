/**
 * HYBRID Search Strategy
 *
 * Wraps the existing hybridSearch() function as a SearchStrategy.
 * This is the default search strategy: vector + text + graph traversal.
 */

import type {
  SearchStrategy,
  SearchRequest,
  SearchResponse,
  SearchContext,
  SearchResultItem,
  SearchRelatedItem,
} from '../types';
import { hybridSearch, type HybridSearchOptions } from '../../hybridSearch';

export class HybridSearchStrategy implements SearchStrategy {
  readonly type = 'HYBRID' as const;
  readonly description = 'Vector similarity + text matching + graph traversal + knowledge graph';
  readonly requiresLLM = false;

  async search(request: SearchRequest, context: SearchContext): Promise<SearchResponse> {
    const opts: HybridSearchOptions = {
      limit: request.limit ?? 20,
      includeKnowledge: true,
      expandGraph: true,
      maxHops: 1,
      includeAboutEdges: true,
    };

    if (context.embeddings) opts.embeddings = context.embeddings;
    if (request.scope) opts.scope = request.scope;

    // Allow extra options to override defaults
    if (request.options?.['vectorWeight'] != null) {
      opts.vectorWeight = request.options['vectorWeight'] as number;
    }
    if (request.options?.['textWeight'] != null) {
      opts.textWeight = request.options['textWeight'] as number;
    }

    const result = await hybridSearch(request.query, context.client, opts);

    const results: SearchResultItem[] = result.hits.map((hit) => {
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

    const related: SearchRelatedItem[] = result.related.map((r) => {
      const item: SearchRelatedItem = {
        name: r.name,
        nodeType: r.nodeType,
        edgeLabel: r.edgeLabel,
        direction: r.direction,
        sourceHit: r.sourceKey,
      };
      if (r.filePath) item.filePath = r.filePath;
      return item;
    });

    const response: SearchResponse = {
      results,
      total: results.length,
      meta: {
        searchType: 'HYBRID',
        durationMs: result.meta.durationMs,
        vectorHits: result.meta.vectorHits,
        textHits: result.meta.textHits,
        graphExpanded: result.meta.graphExpanded,
        aboutExpanded: result.meta.aboutExpanded,
        embeddingAvailable: result.meta.embeddingAvailable,
      },
    };
    if (related.length > 0) response.related = related;
    return response;
  }
}
