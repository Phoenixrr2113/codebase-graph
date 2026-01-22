/**
 * useFocusGraph Hook
 * Focus-based graph exploration - starts with Files only, expands on demand
 */

import { useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getNodes, getNeighbors, type NodesResponse } from '@/services/api';
import type { GraphData, GraphNode, GraphEdge, NodeLabel } from '@codegraph/types';

// Query key factory
export const focusGraphKeys = {
  all: ['focusGraph'] as const,
  initial: (projectId: string | null) => [...focusGraphKeys.all, 'initial', projectId] as const,
  neighbors: (nodeId: string) => [...focusGraphKeys.all, 'neighbors', nodeId] as const,
};

export interface UseFocusGraphOptions {
  projectId: string | null;
  initialTypes?: NodeLabel[];
  initialLimit?: number;
  onExpanded?: (nodeId: string) => void;
}

export interface UseFocusGraphResult {
  graphData: GraphData | undefined;
  isLoading: boolean;
  error: Error | null;
  expandedNodes: Set<string>;
  expandNode: (nodeId: string) => Promise<void>;
  isExpandingNode: string | null;
  reset: () => void;
}

/**
 * Focus-based graph loading
 * - Initially loads only File nodes (lightweight overview)
 * - On expandNode(id), fetches neighbors and merges them into the graph
 */
export function useFocusGraph(options: UseFocusGraphOptions): UseFocusGraphResult {
  const { projectId, initialTypes = ['File'], initialLimit = 500, onExpanded } = options;
  const queryClient = useQueryClient();

  // Track which nodes have been expanded
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [isExpandingNode, setIsExpandingNode] = useState<string | null>(null);

  // Accumulated nodes and edges from expansions
  const [additionalNodes, setAdditionalNodes] = useState<GraphNode[]>([]);
  const [additionalEdges, setAdditionalEdges] = useState<GraphEdge[]>([]);

  // Initial query: Load File nodes only
  const { data: initialData, isLoading, error } = useQuery<NodesResponse, Error>({
    queryKey: focusGraphKeys.initial(projectId),
    queryFn: async () => {
      return getNodes({
        types: initialTypes,
        limit: initialLimit,
        projectId: projectId ?? undefined,
      });
    },
    enabled: !!projectId,
    staleTime: 60000, // 1 minute
  });

  // Merge initial nodes with expanded nodes
  const graphData = useMemo<GraphData | undefined>(() => {
    if (!initialData) return undefined;

    const allNodes = [...initialData.nodes, ...additionalNodes];
    const nodeIds = new Set(allNodes.map(n => n.id));

    // Deduplicate nodes
    const uniqueNodes = allNodes.filter((node, index, self) =>
      index === self.findIndex(n => n.id === node.id)
    );

    // Keep only edges where both endpoints exist
    const validEdges = additionalEdges.filter(
      edge => nodeIds.has(edge.source) && nodeIds.has(edge.target)
    );

    // Deduplicate edges
    const uniqueEdges = validEdges.filter((edge, index, self) =>
      index === self.findIndex(e => e.id === edge.id)
    );

    return { nodes: uniqueNodes, edges: uniqueEdges };
  }, [initialData, additionalNodes, additionalEdges]);

  // Expand a node by fetching its neighbors
  const expandNode = useCallback(async (nodeId: string) => {
    if (expandedNodes.has(nodeId) || isExpandingNode) return;

    setIsExpandingNode(nodeId);

    try {
      const neighborsData = await getNeighbors(nodeId, 'both', undefined, 1);

      // Add new nodes (neighbors)
      setAdditionalNodes(prev => {
        const existingIds = new Set(prev.map(n => n.id));
        const newNodes = neighborsData.nodes.filter(n => !existingIds.has(n.id));
        return [...prev, ...newNodes];
      });

      // Add new edges
      setAdditionalEdges(prev => {
        const existingIds = new Set(prev.map(e => e.id));
        const newEdges = neighborsData.edges.filter(e => !existingIds.has(e.id));
        return [...prev, ...newEdges];
      });

      // Mark node as expanded
      setExpandedNodes(prev => new Set([...prev, nodeId]));

      // Notify callback that expansion is complete
      onExpanded?.(nodeId);
    } finally {
      setIsExpandingNode(null);
    }
  }, [expandedNodes, isExpandingNode, onExpanded]);

  // Reset to initial state
  const reset = useCallback(() => {
    setExpandedNodes(new Set());
    setAdditionalNodes([]);
    setAdditionalEdges([]);
    queryClient.invalidateQueries({ queryKey: focusGraphKeys.all });
  }, [queryClient]);

  return {
    graphData,
    isLoading,
    error: error ?? null,
    expandedNodes,
    expandNode,
    isExpandingNode,
    reset,
  };
}
