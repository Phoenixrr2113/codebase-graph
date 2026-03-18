/**
 * Search Module — Pluggable Search Strategy System
 *
 * Two strategies:
 * - ENRICHED_V2: Vector retrieval + cross-encoder reranking (primary)
 * - HYBRID: Vector + text + graph traversal (fallback)
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
export { EnrichedV2Strategy } from './strategies/enrichedV2';

// Factory — creates a registry with all built-in strategies registered.
import { SearchRegistry } from './registry';
import { HybridSearchStrategy } from './strategies/hybrid';
import { EnrichedV2Strategy } from './strategies/enrichedV2';

export function createDefaultSearchRegistry(): SearchRegistry {
  const registry = new SearchRegistry();
  registry.register(new HybridSearchStrategy());
  registry.register(new EnrichedV2Strategy());
  return registry;
}
