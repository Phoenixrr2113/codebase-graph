'use client';

/**
 * AppShell Component
 * Main layout with three resizable panels using Shadcn resizable
 */

import { useMemo, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from '@/components/ui/resizable';
import { useUIStore, useGraphStore } from '@/stores';
import { GraphCanvas, GraphLegend } from '@/components/graph';
import { EntityDetail } from '@/components/panels/EntityDetail';
import { SearchPanel } from '@/components/panels/SearchPanel';
import { ParseProjectDialog } from '@/components/ParseProjectDialog';
import { ProjectSelector } from '@/components/ProjectSelector';
import { projectKeys, graphKeys } from '@/hooks/useGraphData';
import { useFocusGraph } from '@/hooks/useFocusGraph';
import type { GraphData, GraphNode, EdgeLabel } from '@codegraph/types';
import type { GraphCanvasControls } from '@/components/graph/GraphCanvas';

export function AppShell() {
  const { leftPanel, rightPanel, legendCollapsed, toggleLegend, nodeTypeFilters, edgeTypeFilters, selectedProjectId, setSelectedProjectId } = useUIStore();
  const { selectedNode, selectNode: setSelectedNode } = useGraphStore();

  // Store graph controls to focus on nodes and show connections
  const graphControlsRef = useRef<GraphCanvasControls | null>(null);

  // Combined handler: select in store (no auto-pan to allow double-click)
  // Use Focus button in EntityDetail to pan to node
  const handleNodeSelect = useCallback((node: GraphNode | null) => {
    setSelectedNode(node);
  }, [setSelectedNode]);

  const handleGraphReady = useCallback((controls: GraphCanvasControls) => {
    graphControlsRef.current = controls;
  }, []);

  // Callbacks for EntityDetail buttons
  const handleFocusNode = useCallback((nodeId: string) => {
    graphControlsRef.current?.selectNode(nodeId);
  }, []);

  const handleShowConnections = useCallback((nodeId: string) => {
    graphControlsRef.current?.highlightNeighbors(nodeId);
  }, []);

  const queryClient = useQueryClient();

  // Handle when a project is parsed - fetch fresh project list and select it
  const handleProjectParsed = useCallback(async (projectPath: string) => {
    // Small delay to let the backend finish persisting
    await new Promise(resolve => setTimeout(resolve, 300));

    // Fetch fresh project list (invalidation was already triggered by ParseProjectDialog)
    const data = await queryClient.fetchQuery({
      queryKey: projectKeys.all,
      staleTime: 0, // Force fresh fetch
    });

    const projects = (data as { projects: Array<{ id: string; rootPath: string }> })?.projects ?? [];
    const newProject = projects.find(p => p.rootPath === projectPath);
    if (newProject) {
      setSelectedProjectId(newProject.id);
      // Invalidate graph data to load the new project's graph
      queryClient.invalidateQueries({ queryKey: graphKeys.all });
    }
  }, [queryClient, setSelectedProjectId]);

  // Auto-pan to expanded node after neighbors load
  const handleExpanded = useCallback((nodeId: string) => {
    // Small delay to let layout settle before panning
    setTimeout(() => {
      graphControlsRef.current?.selectNode(nodeId);
    }, 100);
  }, []);

  // Focus-based graph loading: starts with Files only, expands on double-click
  const {
    graphData,
    isLoading: loading,
    error,
    expandNode,
    expandedNodes,
    isExpandingNode,
  } = useFocusGraph({
    projectId: selectedProjectId,
    onExpanded: handleExpanded,
  });

  // Handle node double-click: expand its neighbors
  const handleNodeDoubleClick = useCallback((node: GraphNode) => {
    expandNode(node.id);
  }, [expandNode]);

  // Apply node type filters to graph data
  const filteredGraphData = useMemo<GraphData | undefined>(() => {
    if (!graphData) return undefined;

    // Filter nodes by selected types
    const filteredNodes = graphData.nodes.filter(node => nodeTypeFilters.has(node.label));
    const filteredNodeIds = new Set(filteredNodes.map(n => n.id));

    // Keep edges where both endpoints exist and edge type is enabled
    const filteredEdges = graphData.edges.filter(
      edge => filteredNodeIds.has(edge.source) &&
        filteredNodeIds.has(edge.target) &&
        edgeTypeFilters.has(edge.label as EdgeLabel)
    );

    return { nodes: filteredNodes, edges: filteredEdges };
  }, [graphData, nodeTypeFilters, edgeTypeFilters]);

  const nodes = filteredGraphData?.nodes ?? [];
  const edges = filteredGraphData?.edges ?? [];

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
              Error: {error instanceof Error ? error.message : 'Failed to load graph'}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <ProjectSelector
            selectedProjectId={selectedProjectId}
            onSelectProject={setSelectedProjectId}
          />
          <span className="text-xs text-slate-500">
            {nodes.length} nodes · {edges.length} edges
          </span>
          <ParseProjectDialog onProjectParsed={handleProjectParsed} />
        </div>
      </header>

      {/* Main content */}
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Left panel - Search/FileTree */}
        {leftPanel.visible && (
          <>
            <ResizablePanel
              defaultSize={leftPanel.size}
              minSize={15}
              maxSize={35}
              className="bg-slate-900/30"
            >
              <SearchPanel onNodeSelect={handleNodeSelect} selectedProjectId={selectedProjectId} />
            </ResizablePanel>
            <ResizableHandle className="w-1 bg-slate-800 hover:bg-indigo-500 transition-colors" />
          </>
        )}

        {/* Center panel - Graph */}
        <ResizablePanel defaultSize={55} minSize={30} className="relative">
          <GraphCanvas
            data={filteredGraphData}
            onNodeSelect={handleNodeSelect}
            onNodeDoubleClick={handleNodeDoubleClick}
            onReady={handleGraphReady}
            className="h-full"
          />
          {/* Expanding indicator */}
          {isExpandingNode && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 bg-indigo-600 text-white text-xs px-3 py-1 rounded-full animate-pulse">
              Expanding node...
            </div>
          )}
          {/* Legend overlay */}
          <div className="absolute bottom-3 left-3 z-10">
            <GraphLegend
              collapsed={legendCollapsed}
              onToggle={toggleLegend}
            />
          </div>
          {/* Expanded nodes indicator */}
          {expandedNodes.size > 0 && (
            <div className="absolute bottom-3 right-3 z-10 text-xs text-slate-500 bg-slate-900/80 px-2 py-1 rounded">
              {expandedNodes.size} nodes expanded
            </div>
          )}
        </ResizablePanel>

        {/* Right panel - Entity Detail */}
        {rightPanel.visible && (
          <>
            <ResizableHandle className="w-1 bg-slate-800 hover:bg-indigo-500 transition-colors" />
            <ResizablePanel
              defaultSize={rightPanel.size}
              minSize={20}
              maxSize={45}
              className="bg-slate-900/30"
            >
              <EntityDetail
                node={selectedNode}
                graphData={filteredGraphData}
                onFocusNode={handleFocusNode}
                onShowConnections={handleShowConnections}
                onNodeSelect={handleNodeSelect}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
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

