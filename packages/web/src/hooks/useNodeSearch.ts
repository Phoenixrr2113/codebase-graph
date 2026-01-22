/**
 * useNodeSearch Hook
 * Server-side node search with infinite scroll using TanStack Query
 */

import { useInfiniteQuery } from '@tanstack/react-query';
import { useMemo, useState, useEffect } from 'react';
import { getNodes, type NodesResponse, type GetNodesOptions } from '@/services/api';
import type { NodeLabel, GraphNode } from '@codegraph/types';

// Query key factory
export const nodeSearchKeys = {
  all: ['nodeSearch'] as const,
  search: (query: string, types: NodeLabel[], projectId: string | null) =>
    [...nodeSearchKeys.all, query, types.sort().join(','), projectId] as const,
};

export interface UseNodeSearchOptions {
  query: string;
  types?: NodeLabel[];
  projectId: string | null;
  limit?: number;
  debounceMs?: number;
  enabled?: boolean;
}

export interface UseNodeSearchResult {
  nodes: GraphNode[];
  totalCount: number;
  isLoading: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  error: Error | null;
}

/**
 * Custom hook for server-side node search with pagination
 * Supports debouncing search queries and infinite scroll
 */
export function useNodeSearch(options: UseNodeSearchOptions): UseNodeSearchResult {
  const {
    query: rawQuery,
    types = [],
    projectId,
    limit = 50,
    debounceMs = 300,
    enabled = true,
  } = options;

  // Debounced query state
  const [debouncedQuery, setDebouncedQuery] = useState(rawQuery);

  // Debounce the search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(rawQuery);
    }, debounceMs);

    return () => clearTimeout(timer);
  }, [rawQuery, debounceMs]);

  const queryKey = nodeSearchKeys.search(debouncedQuery, types, projectId);

  const {
    data,
    isLoading,
    isFetching,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
    error,
  } = useInfiniteQuery<NodesResponse, Error>({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const opts: GetNodesOptions = {
        page: pageParam as number,
        limit,
        q: debouncedQuery || undefined,
        types: types.length > 0 ? types : undefined,
        projectId: projectId ?? undefined,
      };
      return getNodes(opts);
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      if (lastPage.pagination.hasMore) {
        return lastPage.pagination.page + 1;
      }
      return undefined;
    },
    enabled: enabled && !!projectId,
    staleTime: 30000, // 30 seconds
  });

  // Flatten all pages into a single nodes array
  const nodes = useMemo(() => {
    if (!data?.pages) return [];
    return data.pages.flatMap(page => page.nodes);
  }, [data]);

  // Get total count from the first page
  const totalCount = data?.pages[0]?.pagination.totalCount ?? 0;

  return {
    nodes,
    totalCount,
    isLoading,
    isFetching,
    isFetchingNextPage,
    hasNextPage: hasNextPage ?? false,
    fetchNextPage,
    error: error ?? null,
  };
}
