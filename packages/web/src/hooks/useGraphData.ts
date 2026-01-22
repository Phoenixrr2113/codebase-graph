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
  full: (limit?: number, projectId?: string | null) => [...graphKeys.all, 'full', limit, projectId] as const,
  file: (path: string) => [...graphKeys.all, 'file', path] as const,
  entity: (id: string, depth: number) => [...graphKeys.all, 'entity', id, depth] as const,
  stats: ['stats'] as const,
};

/**
 * Fetch the full graph data
 * @param limit - Maximum number of nodes to fetch
 * @param projectId - Project ID to filter by (required - query won't run without it)
 */
export function useGraphData(limit?: number, projectId?: string | null) {
  return useQuery<GraphData>({
    queryKey: graphKeys.full(limit, projectId),
    queryFn: async () => {
      const data = await getFullGraph(limit, projectId ?? undefined);
      // Debug: Log edge types received
      const edgeCounts: Record<string, number> = {};
      for (const edge of data.edges) {
        edgeCounts[edge.label] = (edgeCounts[edge.label] || 0) + 1;
      }
      console.log('[useGraphData] Received graph:', {
        nodes: data.nodes.length,
        edges: data.edges.length,
        edgeCounts
      });
      return data;
    },
    // Only fetch when we have a valid project selected
    enabled: !!projectId,
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

import type { ProjectEntity } from '@codegraph/types';

// Query key for projects
export const projectKeys = {
  all: ['projects'] as const,
};

/**
 * Fetch all projects
 */
export function useProjects() {
  return useQuery<{ projects: ProjectEntity[] }>({
    queryKey: projectKeys.all,
    queryFn: async () => {
      const { getProjects } = await import('@/services/api');
      return getProjects();
    },
  });
}

// ============================================================================
// Focus-based Expansion Hooks
// ============================================================================

export const neighborsKeys = {
  all: ['neighbors'] as const,
  node: (id: string, direction: 'in' | 'out' | 'both', depth: number) =>
    [...neighborsKeys.all, id, direction, depth] as const,
};

/**
 * Fetch neighbors for a specific node (for graph expansion)
 * Used for focus-based exploration: double-click a node to expand its connections
 */
export function useExpandNode(
  nodeId: string | undefined,
  direction: 'in' | 'out' | 'both' = 'both',
  depth = 1
) {
  return useQuery<GraphData>({
    queryKey: neighborsKeys.node(nodeId ?? '', direction, depth),
    queryFn: async () => {
      const { getNeighbors } = await import('@/services/api');
      return getNeighbors(nodeId!, direction, undefined, depth);
    },
    enabled: !!nodeId,
    staleTime: 60000, // Cache for 1 minute
  });
}
