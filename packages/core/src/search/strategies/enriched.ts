/**
 * ENRICHED Search Strategy
 *
 * Standalone multi-signal search with unified scoring.
 * Runs its own vector, text, and graph-importance pipelines in parallel,
 * then scores all signals together (no LLM required).
 */

import type {
  SearchStrategy,
  SearchRequest,
  SearchResponse,
  SearchContext,
  SearchResultItem,
  SearchRelatedItem,
} from '../types';
import { enrichedSearch, type EnrichedSearchOptions } from '../../enrichedSearch';

export class EnrichedSearchStrategy implements SearchStrategy {
  readonly type = 'ENRICHED' as const;
  readonly description = 'Standalone multi-signal search: vector + text + graph-importance + enrichment (no LLM)';
  readonly requiresLLM = false;

  async search(request: SearchRequest, context: SearchContext): Promise<SearchResponse> {
    const opts: EnrichedSearchOptions = {
      limit: request.limit ?? 20,
      expandGraph: true,
      maxHops: 1,
      includeAboutEdges: true,
      includeDocSnippets: true,
      includeVulnerabilityFlags: true,
    };

    if (context.embeddings) opts.embeddings = context.embeddings;
    if (request.scope) opts.scope = request.scope;

    if (request.options?.['maxTokens'] != null) {
      opts.maxTokens = request.options['maxTokens'] as number;
    }

    const result = await enrichedSearch(request.query, context.client, opts);

    const results: SearchResultItem[] = result.hits.map((hit) => {
      const item: SearchResultItem = {
        name: hit.name,
        nodeType: hit.nodeType,
        score: hit.score,
        sources: hit.sources,
        properties: {
          ...hit.properties,
          baseScore: hit.baseScore,
          enrichmentBonus: hit.enrichment.enrichmentBonus,
          importanceScore: hit.enrichment.importanceScore,
          recencyScore: hit.enrichment.recencyScore,
          documentationScore: hit.enrichment.documentationScore,
          callerCount: hit.enrichment.callerCount,
          importerCount: hit.enrichment.importerCount,
          testFileCount: hit.enrichment.testFileCount,
          hasVulnerability: hit.enrichment.hasVulnerability,
        },
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
        searchType: 'ENRICHED' as any,
        durationMs: result.meta.durationMs,
        vectorHits: result.meta.vectorHits,
        textHits: result.meta.textHits,
        importanceHits: result.meta.importanceHits,
        graphExpanded: result.meta.graphExpanded,
        aboutExpanded: result.meta.aboutExpanded,
        embeddingAvailable: result.meta.embeddingAvailable,
        enrichmentDurationMs: result.meta.enrichmentDurationMs,
        hitsEnriched: result.meta.hitsEnriched,
        docSnippetsFound: result.meta.docSnippetsFound,
      },
    };
    if (related.length > 0) response.related = related;

    if (result.docSnippets.length > 0) {
      response.answer = result.docSnippets
        .map((d) => `[${d.sectionName}](${d.docPath}): ${d.preview}`)
        .join('\n');
    }

    return response;
  }
}
