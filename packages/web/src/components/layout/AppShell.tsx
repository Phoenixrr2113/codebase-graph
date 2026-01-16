'use client';

/**
 * AppShell Component
 * Main layout with three resizable panels
 */

import {
  Group,
  Panel,
  Separator,
} from 'react-resizable-panels';
import { useUIStore, useGraphStore } from '@/stores';
import { GraphCanvas, GraphLegend } from '@/components/graph';
import { EntityDetail } from '@/components/panels/EntityDetail';
import { SearchPanel } from '@/components/panels/SearchPanel';

export function AppShell() {
  const { leftPanel, rightPanel, legendCollapsed, toggleLegend } = useUIStore();
  const { nodes, edges, selectedNode, selectNode, loading, error } = useGraphStore();

  const graphData = { nodes, edges };

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-950">
      {/* Header */}
      <header className="h-12 shrink-0 flex items-center justify-between px-4 border-b border-slate-800 bg-slate-900/50">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold bg-gradient-to-r from-indigo-400 via-emerald-400 to-cyan-400 bg-clip-text text-transparent">
            CodeGraph
          </h1>
          {loading && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <LoadingSpinner />
              <span>Loading...</span>
            </div>
          )}
          {error && (
            <div className="text-sm text-red-400">
              Error: {error}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">
            {nodes.length} nodes · {edges.length} edges
          </span>
        </div>
      </header>

      {/* Main content */}
      <Group orientation="horizontal" className="flex-1">
        {/* Left panel - Search/FileTree */}
        {leftPanel.visible && (
          <>
            <Panel
              defaultSize={leftPanel.size}
              minSize={15}
              maxSize={35}
              className="bg-slate-900/30"
            >
              <SearchPanel />
            </Panel>
            <Separator className="w-1 bg-slate-800 hover:bg-indigo-500 transition-colors" />
          </>
        )}

        {/* Center panel - Graph */}
        <Panel minSize={30} className="relative">
          <GraphCanvas
            data={graphData}
            onNodeSelect={selectNode}
            className="h-full"
          />
          {/* Legend overlay */}
          <div className="absolute bottom-3 left-3 z-10">
            <GraphLegend
              collapsed={legendCollapsed}
              onToggle={toggleLegend}
            />
          </div>
        </Panel>

        {/* Right panel - Entity Detail */}
        {rightPanel.visible && (
          <>
            <Separator className="w-1 bg-slate-800 hover:bg-indigo-500 transition-colors" />
            <Panel
              defaultSize={rightPanel.size}
              minSize={20}
              maxSize={45}
              className="bg-slate-900/30"
            >
              <EntityDetail node={selectedNode} />
            </Panel>
          </>
        )}
      </Group>
    </div>
  );
}

function LoadingSpinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 text-indigo-500"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

export default AppShell;
