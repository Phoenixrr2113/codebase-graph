/**
 * Search Registry — Strategy Pattern for Search Types
 *
 * Manages registered search strategies and dispatches queries
 * to the appropriate strategy based on SearchRequest.type.
 */

import { createLogger } from '@codegraph/logger';
import type {
  SearchType,
  SearchStrategy,
  SearchRequest,
  SearchResponse,
  SearchContext,
} from './types';

const logger = createLogger({ namespace: 'core:search-registry' });

export class SearchRegistry {
  private strategies = new Map<SearchType, SearchStrategy>();

  /**
   * Register a search strategy.
   * Replaces any existing strategy with the same type.
   */
  register(strategy: SearchStrategy): void {
    logger.debug(`Registering search strategy: ${strategy.type} — ${strategy.description}`);
    this.strategies.set(strategy.type, strategy);
  }

  /**
   * Get a registered strategy by type.
   */
  get(type: SearchType): SearchStrategy | undefined {
    return this.strategies.get(type);
  }

  /**
   * Check if a strategy is registered.
   */
  has(type: SearchType): boolean {
    return this.strategies.has(type);
  }

  /**
   * List all registered strategy types.
   */
  listTypes(): SearchType[] {
    return Array.from(this.strategies.keys());
  }

  /**
   * List all registered strategies with metadata.
   */
  listStrategies(): Array<{
    type: SearchType;
    description: string;
    requiresLLM: boolean;
  }> {
    return Array.from(this.strategies.values()).map((s) => ({
      type: s.type,
      description: s.description,
      requiresLLM: s.requiresLLM,
    }));
  }

  /**
   * Execute a search by dispatching to the appropriate strategy.
   *
   * @param request - The search request (includes type, query, options)
   * @param context - Shared dependencies (client, llm, embeddings)
   * @returns Search response
   * @throws Error if the requested strategy is not registered
   */
  async search(
    request: SearchRequest,
    context: SearchContext,
  ): Promise<SearchResponse> {
    const strategy = this.strategies.get(request.type);

    if (!strategy) {
      const available = this.listTypes().join(', ');
      throw new Error(
        `Search strategy "${request.type}" is not registered. Available: ${available}`,
      );
    }

    if (strategy.requiresLLM && !context.llm) {
      throw new Error(
        `Search strategy "${request.type}" requires an LLM but none was provided in the search context.`,
      );
    }

    const startMs = performance.now();

    logger.info(`Executing ${request.type} search: "${request.query.slice(0, 100)}"`);

    try {
      const response = await strategy.search(request, context);
      const durationMs = Math.round(performance.now() - startMs);

      // Ensure meta.searchType and durationMs are set
      response.meta = {
        ...response.meta,
        searchType: request.type,
        durationMs,
      };

      logger.info(
        `${request.type} search completed: ${response.total} results in ${durationMs}ms` +
        (response.answer ? ' (with answer)' : ''),
      );

      return response;
    } catch (error) {
      const durationMs = Math.round(performance.now() - startMs);
      logger.error(`${request.type} search failed after ${durationMs}ms`, error);
      throw error;
    }
  }
}

/**
 * Create a search registry with the default strategies registered.
 * Call this once and reuse the registry across the application.
 */
export function createSearchRegistry(): SearchRegistry {
  return new SearchRegistry();
}
