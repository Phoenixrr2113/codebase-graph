/**
 * Search Module — Pluggable Search Strategy System
 *
 * Provides a registry-based approach for dispatching queries to
 * different search strategies: HYBRID, GRAPH_ANSWER, NL_TO_CYPHER,
 * SMART_SEARCH, and CONTEXT_WALK.
 *
 * Usage:
 *   import { createDefaultSearchRegistry } from '@codegraph/core/search';
 *   const registry = createDefaultSearchRegistry();
 *   const result = await registry.search({ query: '...', type: 'HYBRID' }, context);
 */

// Types
export type {
  SearchType,
  SearchContext,
  SearchRequest,
  SearchResponse,
  SearchResultItem,
  SearchRelatedItem,
  SearchStrategy,
} from './types';

// Registry
export { SearchRegistry, createSearchRegistry } from './registry';

// Strategies
export { HybridSearchStrategy } from './strategies/hybrid';
export { GraphAnswerStrategy } from './strategies/graphAnswer';
export { NLToCypherStrategy } from './strategies/nlToCypher';
export { SmartSearchStrategy } from './strategies/smartSearch';
export { ContextWalkStrategy } from './strategies/contextWalk';
export { EnrichedSearchStrategy } from './strategies/enriched';
export { EnrichedV2Strategy } from './strategies/enrichedV2';

// Factory — creates a registry with all default strategies
import { SearchRegistry } from './registry';
import { HybridSearchStrategy } from './strategies/hybrid';
import { GraphAnswerStrategy } from './strategies/graphAnswer';
import { NLToCypherStrategy } from './strategies/nlToCypher';
import { SmartSearchStrategy } from './strategies/smartSearch';
import { ContextWalkStrategy } from './strategies/contextWalk';
import { EnrichedSearchStrategy } from './strategies/enriched';
import { EnrichedV2Strategy } from './strategies/enrichedV2';

/**
 * Create a search registry with all built-in strategies registered.
 *
 * SMART_SEARCH gets a reference to the registry so it can dispatch
 * to other strategies after classifying the query.
 */
export function createDefaultSearchRegistry(): SearchRegistry {
  const registry = new SearchRegistry();

  registry.register(new HybridSearchStrategy());
  registry.register(new GraphAnswerStrategy());
  registry.register(new NLToCypherStrategy());
  registry.register(new ContextWalkStrategy());
  registry.register(new EnrichedSearchStrategy());
  registry.register(new EnrichedV2Strategy());

  // SMART_SEARCH needs a reference to the registry for dispatch
  registry.register(new SmartSearchStrategy(registry));

  return registry;
}
