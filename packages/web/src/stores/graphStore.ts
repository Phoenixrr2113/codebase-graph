/**
 * Graph Store
 * Zustand store for graph data, selection, and loading state
 */

import { create } from 'zustand';
import type { GraphData, GraphNode, GraphEdge, GraphStats } from '@codegraph/types';

interface GraphState {
  // Data
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats | null;

  // Selection
  selectedNodeId: string | null;
  selectedNode: GraphNode | null;

  // Loading states
  loading: boolean;
  error: string | null;

  // Actions
  setGraphData: (data: GraphData) => void;
  setStats: (stats: GraphStats) => void;
  selectNode: (node: GraphNode | null) => void;
  selectNodeById: (nodeId: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearGraph: () => void;
}

export const useGraphStore = create<GraphState>((set, get) => ({
  // Initial state
  nodes: [],
  edges: [],
  stats: null,
  selectedNodeId: null,
  selectedNode: null,
  loading: false,
  error: null,

  // Actions
  setGraphData: (data) =>
    set({
      nodes: data.nodes,
      edges: data.edges,
      loading: false,
      error: null,
    }),

  setStats: (stats) => set({ stats }),

  selectNode: (node) =>
    set({
      selectedNodeId: node?.id ?? null,
      selectedNode: node,
    }),

  selectNodeById: (nodeId) => {
    if (!nodeId) {
      set({ selectedNodeId: null, selectedNode: null });
      return;
    }
    const node = get().nodes.find((n) => n.id === nodeId) ?? null;
    set({
      selectedNodeId: nodeId,
      selectedNode: node,
    });
  },

  setLoading: (loading) => set({ loading }),

  setError: (error) => set({ error, loading: false }),

  clearGraph: () =>
    set({
      nodes: [],
      edges: [],
      stats: null,
      selectedNodeId: null,
      selectedNode: null,
      error: null,
    }),
}));
