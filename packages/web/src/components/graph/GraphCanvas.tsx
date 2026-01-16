'use client';

/**
 * GraphCanvas Component
 * Main Cytoscape.js container for graph visualization
 */

import { useEffect } from 'react';
import type { GraphData, GraphNode } from '@codegraph/types';
import { useCytoscape, type UseCytoscapeReturn } from '@/hooks/useCytoscape';
import { cn } from '@/lib/utils';

export interface GraphCanvasProps {
  data?: GraphData;
  onNodeSelect?: (node: GraphNode | null) => void;
  onNodeDoubleClick?: (node: GraphNode) => void;
  className?: string;
}

export interface GraphCanvasRef extends UseCytoscapeReturn {}

export function GraphCanvas({
  data,
  onNodeSelect,
  onNodeDoubleClick,
  className,
}: GraphCanvasProps) {
  const {
    containerRef,
    setData,
    layout,
    setLayout,
    runLayout,
    fit,
    zoomIn,
    zoomOut,
  } = useCytoscape({
    onNodeSelect,
    onNodeDoubleClick,
  });

  // Update graph data when it changes
  useEffect(() => {
    if (data) {
      setData(data);
    }
  }, [data, setData]);

  return (
    <div className={cn('relative w-full h-full', className)}>
      <div
        ref={containerRef}
        className="w-full h-full bg-slate-950 rounded-lg"
        style={{ minHeight: '400px' }}
      />
      {/* Controls overlay */}
      <GraphControlsOverlay
        layout={layout}
        setLayout={setLayout}
        runLayout={runLayout}
        fit={fit}
        zoomIn={zoomIn}
        zoomOut={zoomOut}
      />
    </div>
  );
}

// Internal controls overlay
interface GraphControlsOverlayProps {
  layout: string;
  setLayout: (layout: 'cose-bilkent' | 'dagre' | 'concentric' | 'breadthfirst') => void;
  runLayout: () => void;
  fit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

function GraphControlsOverlay({
  layout,
  setLayout,
  runLayout,
  fit,
  zoomIn,
  zoomOut,
}: GraphControlsOverlayProps) {
  return (
    <div className="absolute top-3 right-3 flex flex-col gap-2 z-10">
      {/* Zoom controls */}
      <div className="flex flex-col bg-slate-900/90 rounded-lg border border-slate-800 overflow-hidden">
        <button
          onClick={zoomIn}
          className="p-2 hover:bg-slate-800 transition-colors text-slate-400 hover:text-white"
          title="Zoom in"
        >
          <ZoomInIcon />
        </button>
        <div className="h-px bg-slate-800" />
        <button
          onClick={zoomOut}
          className="p-2 hover:bg-slate-800 transition-colors text-slate-400 hover:text-white"
          title="Zoom out"
        >
          <ZoomOutIcon />
        </button>
        <div className="h-px bg-slate-800" />
        <button
          onClick={fit}
          className="p-2 hover:bg-slate-800 transition-colors text-slate-400 hover:text-white"
          title="Fit to view"
        >
          <FitIcon />
        </button>
      </div>

      {/* Layout controls */}
      <div className="flex flex-col bg-slate-900/90 rounded-lg border border-slate-800 overflow-hidden">
        <button
          onClick={() => setLayout('cose-bilkent')}
          className={cn(
            'p-2 transition-colors text-xs font-medium',
            layout === 'cose-bilkent'
              ? 'bg-indigo-600 text-white'
              : 'hover:bg-slate-800 text-slate-400 hover:text-white'
          )}
          title="Force-directed layout"
        >
          Force
        </button>
        <div className="h-px bg-slate-800" />
        <button
          onClick={() => setLayout('dagre')}
          className={cn(
            'p-2 transition-colors text-xs font-medium',
            layout === 'dagre'
              ? 'bg-indigo-600 text-white'
              : 'hover:bg-slate-800 text-slate-400 hover:text-white'
          )}
          title="Hierarchical layout"
        >
          Hier
        </button>
        <div className="h-px bg-slate-800" />
        <button
          onClick={runLayout}
          className="p-2 hover:bg-slate-800 transition-colors text-slate-400 hover:text-white"
          title="Re-run layout"
        >
          <RefreshIcon />
        </button>
      </div>
    </div>
  );
}

// Simple SVG icons
function ZoomInIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="7" cy="7" r="5" />
      <line x1="11" y1="11" x2="14" y2="14" />
      <line x1="5" y1="7" x2="9" y2="7" />
      <line x1="7" y1="5" x2="7" y2="9" />
    </svg>
  );
}

function ZoomOutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="7" cy="7" r="5" />
      <line x1="11" y1="11" x2="14" y2="14" />
      <line x1="5" y1="7" x2="9" y2="7" />
    </svg>
  );
}

function FitIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="12" height="12" rx="1" />
      <polyline points="6,4 4,4 4,6" />
      <polyline points="10,4 12,4 12,6" />
      <polyline points="6,12 4,12 4,10" />
      <polyline points="10,12 12,12 12,10" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M14 8a6 6 0 1 1-1.5-4" />
      <polyline points="14,2 14,5 11,5" />
    </svg>
  );
}

export default GraphCanvas;
