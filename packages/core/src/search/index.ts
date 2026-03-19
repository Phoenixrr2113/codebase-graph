/**
 * Search Module — Types only.
 * The actual search is enrichedSearchV2, called via codeGraphService.search().
 */

// Types (kept for API/benchmark compatibility during transition)
export type {
  SearchType,
  SearchContext,
  SearchRequest,
  SearchResponse,
  SearchResultItem,
  SearchRelatedItem,
  SearchStrategy,
} from './types';
