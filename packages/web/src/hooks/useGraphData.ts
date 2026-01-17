/**
 * Graph Data Hooks
 * TanStack Query hooks for graph data with stable query keys
 */

import { useQuery } from '@tanstack/react-query';
import { getFullGraph, getStats, getFileSubgraph, getEntityWithConnections } from '@/services/api';
import type { GraphData, GraphStats } from '@codegraph/types';

// Query key factory for type-safe, consistent keys
export const graphKeys = {
  all: ['graph'] as const,
  full: (limit?: number) => [...graphKeys.all, 'full', limit] as const,
  file: (path: string) => [...graphKeys.all, 'file', path] as const,
  entity: (id: string, depth: number) => [...graphKeys.all, 'entity', id, depth] as const,
  stats: ['stats'] as const,
};

/**
 * Fetch the full graph data
 */
export function useGraphData(limit?: number) {
  return useQuery<GraphData>({
    queryKey: graphKeys.full(limit),
    queryFn: () => getFullGraph(limit),
  });
}

/**
 * Fetch graph stats
 */
export function useGraphStats() {
  return useQuery<GraphStats>({
    queryKey: graphKeys.stats,
    queryFn: getStats,
  });
}

/**
 * Fetch subgraph for a specific file
 */
export function useFileSubgraph(filePath: string | undefined) {
  return useQuery<GraphData>({
    queryKey: graphKeys.file(filePath ?? ''),
    queryFn: () => getFileSubgraph(filePath!),
    enabled: !!filePath,
  });
}

/**
 * Fetch entity with connections
 */
export function useEntityGraph(entityId: string | undefined, depth = 1) {
  return useQuery<GraphData>({
    queryKey: graphKeys.entity(entityId ?? '', depth),
    queryFn: () => getEntityWithConnections(entityId!, depth),
    enabled: !!entityId,
  });
}

/**
 * Fetch source code for a file
 */
export function useSourceCode(
  filePath: string | undefined,
  startLine?: number,
  endLine?: number
) {
  return useQuery({
    queryKey: ['source', filePath, startLine, endLine] as const,
    queryFn: async () => {
      const { getSourceCode } = await import('@/services/api');
      return getSourceCode(filePath!, startLine, endLine);
    },
    enabled: !!filePath,
  });
}

