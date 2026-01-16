/**
 * UI Store
 * Zustand store for panel states, filters, and search
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { NodeLabel, EdgeLabel } from '@codegraph/types';

interface PanelState {
  visible: boolean;
  size: number;
}

interface UIState {
  // Panels
  leftPanel: PanelState;
  rightPanel: PanelState;
  
  // Search
  searchQuery: string;
  
  // Filters
  nodeTypeFilters: Set<NodeLabel>;
  edgeTypeFilters: Set<EdgeLabel>;
  
  // Legend
  legendCollapsed: boolean;
  
  // Theme
  theme: 'dark' | 'light';
  
  // Actions
  toggleLeftPanel: () => void;
  toggleRightPanel: () => void;
  setLeftPanelSize: (size: number) => void;
  setRightPanelSize: (size: number) => void;
  setSearchQuery: (query: string) => void;
  toggleNodeTypeFilter: (type: NodeLabel) => void;
  toggleEdgeTypeFilter: (type: EdgeLabel) => void;
  clearFilters: () => void;
  setLegendCollapsed: (collapsed: boolean) => void;
  toggleLegend: () => void;
}

const ALL_NODE_TYPES: NodeLabel[] = [
  'File', 'Class', 'Interface', 'Function', 'Variable', 'Import', 'Type', 'Component'
];

const ALL_EDGE_TYPES: EdgeLabel[] = [
  'CONTAINS', 'IMPORTS', 'IMPORTS_SYMBOL', 'CALLS', 'EXTENDS', 'IMPLEMENTS',
  'USES_TYPE', 'RETURNS', 'HAS_PARAM', 'HAS_METHOD', 'HAS_PROPERTY', 'RENDERS', 'USES_HOOK'
];

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      // Initial state
      leftPanel: { visible: true, size: 20 },
      rightPanel: { visible: true, size: 25 },
      searchQuery: '',
      nodeTypeFilters: new Set<NodeLabel>(ALL_NODE_TYPES),
      edgeTypeFilters: new Set<EdgeLabel>(ALL_EDGE_TYPES),
      legendCollapsed: false,
      theme: 'dark',

      // Actions
      toggleLeftPanel: () =>
        set((state) => ({
          leftPanel: { ...state.leftPanel, visible: !state.leftPanel.visible },
        })),

      toggleRightPanel: () =>
        set((state) => ({
          rightPanel: { ...state.rightPanel, visible: !state.rightPanel.visible },
        })),

      setLeftPanelSize: (size) =>
        set((state) => ({
          leftPanel: { ...state.leftPanel, size },
        })),

      setRightPanelSize: (size) =>
        set((state) => ({
          rightPanel: { ...state.rightPanel, size },
        })),

      setSearchQuery: (query) => set({ searchQuery: query }),

      toggleNodeTypeFilter: (type) =>
        set((state) => {
          const newFilters = new Set(state.nodeTypeFilters);
          if (newFilters.has(type)) {
            newFilters.delete(type);
          } else {
            newFilters.add(type);
          }
          return { nodeTypeFilters: newFilters };
        }),

      toggleEdgeTypeFilter: (type) =>
        set((state) => {
          const newFilters = new Set(state.edgeTypeFilters);
          if (newFilters.has(type)) {
            newFilters.delete(type);
          } else {
            newFilters.add(type);
          }
          return { edgeTypeFilters: newFilters };
        }),

      clearFilters: () =>
        set({
          nodeTypeFilters: new Set(ALL_NODE_TYPES),
          edgeTypeFilters: new Set(ALL_EDGE_TYPES),
        }),

      setLegendCollapsed: (collapsed) => set({ legendCollapsed: collapsed }),

      toggleLegend: () =>
        set((state) => ({ legendCollapsed: !state.legendCollapsed })),
    }),
    {
      name: 'codegraph-ui-store',
      partialize: (state) => ({
        leftPanel: state.leftPanel,
        rightPanel: state.rightPanel,
        legendCollapsed: state.legendCollapsed,
      }),
    }
  )
);
