/**
 * Graph Store
 * Zustand store for graph data, selection, and loading state
 * Includes incremental update methods for real-time WebSocket updates
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

  // Live update indicator
  lastUpdateTimestamp: number | null;

  // Actions - Full graph operations
  setGraphData: (data: GraphData) => void;
  setStats: (stats: GraphStats) => void;
  selectNode: (node: GraphNode | null) => void;
  selectNodeById: (nodeId: string | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearGraph: () => void;

  // Actions - Incremental updates (for WebSocket events)
  addNode: (node: GraphNode) => void;
  updateNode: (node: GraphNode) => void;
  removeNode: (nodeId: string) => void;
  removeNodesByFilePath: (filePath: string) => void;
  addEdge: (edge: GraphEdge) => void;
  removeEdge: (edgeId: string) => void;
  markUpdated: () => void;
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
  lastUpdateTimestamp: null,

  // Actions - Full graph operations
  setGraphData: (data) =>
    set({
      nodes: data.nodes,
      edges: data.edges,
      loading: false,
      error: null,
      lastUpdateTimestamp: Date.now(),
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
      lastUpdateTimestamp: null,
    }),

  // Actions - Incremental updates
  addNode: (node) =>
    set((state) => ({
      nodes: [...state.nodes.filter((n) => n.id !== node.id), node],
      lastUpdateTimestamp: Date.now(),
    })),

  updateNode: (node) =>
    set((state) => {
      const nodes = state.nodes.map((n) => (n.id === node.id ? node : n));
      const selectedNode =
        state.selectedNodeId === node.id ? node : state.selectedNode;
      return { nodes, selectedNode, lastUpdateTimestamp: Date.now() };
    }),

  removeNode: (nodeId) =>
    set((state) => {
      // Remove the node and any edges connected to it
      const nodes = state.nodes.filter((n) => n.id !== nodeId);
      const edges = state.edges.filter(
        (e) => e.source !== nodeId && e.target !== nodeId
      );
      const selectedNodeId = state.selectedNodeId === nodeId ? null : state.selectedNodeId;
      const selectedNode = state.selectedNodeId === nodeId ? null : state.selectedNode;
      return { nodes, edges, selectedNodeId, selectedNode, lastUpdateTimestamp: Date.now() };
    }),

  removeNodesByFilePath: (filePath) =>
    set((state) => {
      // Find all nodes with this filePath
      const nodeIdsToRemove = new Set(
        state.nodes.filter((n) => n.filePath === filePath).map((n) => n.id)
      );

      // Remove nodes and edges connected to them
      const nodes = state.nodes.filter((n) => !nodeIdsToRemove.has(n.id));
      const edges = state.edges.filter(
        (e) => !nodeIdsToRemove.has(e.source) && !nodeIdsToRemove.has(e.target)
      );

      // Clear selection if selected node was removed
      const selectedNodeId = nodeIdsToRemove.has(state.selectedNodeId ?? '')
        ? null
        : state.selectedNodeId;
      const selectedNode = nodeIdsToRemove.has(state.selectedNode?.id ?? '')
        ? null
        : state.selectedNode;

      return { nodes, edges, selectedNodeId, selectedNode, lastUpdateTimestamp: Date.now() };
    }),

  addEdge: (edge) =>
    set((state) => ({
      edges: [...state.edges.filter((e) => e.id !== edge.id), edge],
      lastUpdateTimestamp: Date.now(),
    })),

  removeEdge: (edgeId) =>
    set((state) => ({
      edges: state.edges.filter((e) => e.id !== edgeId),
      lastUpdateTimestamp: Date.now(),
    })),

  markUpdated: () => set({ lastUpdateTimestamp: Date.now() }),
}));

