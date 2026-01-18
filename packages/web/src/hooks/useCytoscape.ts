'use client';

/**
 * useCytoscape Hook
 * Manages Cytoscape.js instance lifecycle, events, and layout switching
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import cytoscape, { Core, ElementDefinition } from 'cytoscape';
import coseBilkent from 'cytoscape-cose-bilkent';
import dagre from 'cytoscape-dagre';
import type { GraphData, GraphNode } from '@codegraph/types';
import {
  cytoscapeStylesheet,
  LAYOUT_OPTIONS,
  DEFAULT_LAYOUT,
  type LayoutName,
} from '@/lib/cytoscapeConfig';

// Register layout plugins once
let pluginsRegistered = false;
function registerPlugins() {
  if (pluginsRegistered) return;
  cytoscape.use(coseBilkent);
  cytoscape.use(dagre);
  pluginsRegistered = true;
}

// ============================================================================
// Types
// ============================================================================

export interface UseCytoscapeOptions {
  onNodeSelect?: ((node: GraphNode | null) => void) | undefined;
  onNodeDoubleClick?: ((node: GraphNode) => void) | undefined;
}

export interface UseCytoscapeReturn {
  containerRef: React.RefObject<HTMLDivElement | null>;
  cy: Core | null;
  layout: LayoutName;
  setLayout: (layout: LayoutName) => void;
  runLayout: () => void;
  fit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  setData: (data: GraphData) => void;
  selectNode: (nodeId: string | null) => void;
  highlightNeighbors: (nodeId: string) => void;
  clearHighlight: () => void;
}

// ============================================================================
// Convert GraphData to Cytoscape elements
// ============================================================================

function graphDataToElements(data: GraphData): ElementDefinition[] {
  // Build set of valid node IDs to filter edges
  const nodeIds = new Set(data.nodes.map((node) => node.id));

  const nodes: ElementDefinition[] = data.nodes.map((node) => ({
    group: 'nodes' as const,
    data: {
      id: node.id,
      label: node.label,
      displayName: node.displayName,
      filePath: node.filePath,
    },
  }));

  // Only include edges where both source and target nodes exist
  const validEdges = data.edges.filter(
    (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target)
  );

  // Log filtered edges for debugging
  const droppedEdges = data.edges.filter(
    (edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target)
  );
  if (droppedEdges.length > 0) {
    const droppedByType: Record<string, number> = {};
    for (const edge of droppedEdges) {
      droppedByType[edge.label] = (droppedByType[edge.label] || 0) + 1;
    }
    console.log('[useCytoscape] Dropped edges (missing source/target nodes):', {
      total: droppedEdges.length,
      byType: droppedByType,
      samples: droppedEdges.slice(0, 5).map(e => ({
        type: e.label,
        source: e.source.substring(0, 50),
        target: e.target.substring(0, 50),
        sourceExists: nodeIds.has(e.source),
        targetExists: nodeIds.has(e.target),
      })),
    });
  }

  const edges: ElementDefinition[] = validEdges.map((edge) => ({
    group: 'edges' as const,
    data: {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
    },
  }));

  console.log('[useCytoscape] graphDataToElements:', {
    inputNodes: data.nodes.length,
    inputEdges: data.edges.length,
    outputNodes: nodes.length,
    outputEdges: edges.length,
  });

  return [...nodes, ...edges];
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useCytoscape(options: UseCytoscapeOptions = {}): UseCytoscapeReturn {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const [layout, setLayoutState] = useState<LayoutName>(DEFAULT_LAYOUT);

  // Store original graph data so we can look up full nodes on click
  const graphDataRef = useRef<GraphData | null>(null);

  // Store callbacks in refs to prevent re-initialization
  const onNodeSelectRef = useRef(options.onNodeSelect);
  const onNodeDoubleClickRef = useRef(options.onNodeDoubleClick);

  // Keep refs updated without causing re-renders
  useEffect(() => {
    onNodeSelectRef.current = options.onNodeSelect;
    onNodeDoubleClickRef.current = options.onNodeDoubleClick;
  });

  // Initialize Cytoscape - only once
  useEffect(() => {
    if (!containerRef.current) return;

    registerPlugins();

    const cy = cytoscape({
      container: containerRef.current,
      style: cytoscapeStylesheet as unknown as cytoscape.StylesheetJsonBlock[],
      minZoom: 0.1,
      maxZoom: 4,
      wheelSensitivity: 0.3,
      boxSelectionEnabled: true,
      selectionType: 'single',
    });

    cyRef.current = cy;

    // Node selection handler - uses ref for stable callback
    // Look up full node from stored graph data to preserve startLine/endLine
    cy.on('tap', 'node', (evt) => {
      const nodeId = evt.target.id();
      if (onNodeSelectRef.current && graphDataRef.current) {
        const fullNode = graphDataRef.current.nodes.find(n => n.id === nodeId);
        if (fullNode) {
          onNodeSelectRef.current(fullNode);
        }
      }
    });

    // Background click - deselect
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        onNodeSelectRef.current?.(null);
      }
    });

    // Double-click handler - also looks up full node from stored graph data
    cy.on('dbltap', 'node', (evt) => {
      const nodeId = evt.target.id();
      if (onNodeDoubleClickRef.current && graphDataRef.current) {
        const fullNode = graphDataRef.current.nodes.find(n => n.id === nodeId);
        if (fullNode) {
          onNodeDoubleClickRef.current(fullNode);
        }
      }
    });

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, []); // Empty deps - initialize only once

  // Set graph data - preserve positions when possible
  const setData = useCallback((data: GraphData) => {
    const cy = cyRef.current;
    if (!cy) return;

    // Store full graph data for node lookups on click
    graphDataRef.current = data;

    const elements = graphDataToElements(data);
    const hadElements = cy.elements().length > 0;

    // Batch update: remove old, add new
    cy.batch(() => {
      cy.elements().remove();
      cy.add(elements);
    });
    
    // Run layout after updating elements
    if (elements.length > 0) {
      const layoutOptions = LAYOUT_OPTIONS[layout];

      // For initial load or when many nodes are added: run full layout
      // Use animate: false for faster updates on filter changes
      const opts = hadElements
        ? { ...layoutOptions, animate: false, fit: false }  // Quick layout, don't fit
        : layoutOptions;  // Full animated layout for initial load

      cy.layout(opts).run();
    }
  }, [layout]);

  // Change layout
  const setLayout = useCallback((newLayout: LayoutName) => {
    setLayoutState(newLayout);
    const cy = cyRef.current;
    if (!cy || cy.elements().length === 0) return;

    const layoutOptions = LAYOUT_OPTIONS[newLayout];
    cy.layout(layoutOptions).run();
  }, []);

  // Run current layout
  const runLayout = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const layoutOptions = LAYOUT_OPTIONS[layout];
    cy.layout(layoutOptions).run();
  }, [layout]);

  // Fit to viewport
  const fit = useCallback(() => {
    cyRef.current?.fit(undefined, 50);
  }, []);

  // Zoom controls
  const zoomIn = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom(cy.zoom() * 1.3);
    cy.center();
  }, []);

  const zoomOut = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.zoom(cy.zoom() / 1.3);
    cy.center();
  }, []);

  // Select node programmatically
  const selectNode = useCallback((nodeId: string | null) => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.$(':selected').unselect();
    if (nodeId) {
      const node = cy.$id(nodeId);
      if (node.length > 0) {
        node.select();
        cy.animate({
          center: { eles: node },
          zoom: cy.zoom(),
          duration: 300,
        });
      }
    }
  }, []);

  // Highlight neighbors
  const highlightNeighbors = useCallback((nodeId: string) => {
    const cy = cyRef.current;
    if (!cy) return;

    const node = cy.$id(nodeId);
    const neighborhood = node.neighborhood().add(node);
    
    cy.elements().addClass('faded');
    neighborhood.removeClass('faded');
  }, []);

  // Clear highlight
  const clearHighlight = useCallback(() => {
    cyRef.current?.elements().removeClass('faded');
  }, []);

  return {
    containerRef,
    cy: cyRef.current,
    layout,
    setLayout,
    runLayout,
    fit,
    zoomIn,
    zoomOut,
    setData,
    selectNode,
    highlightNeighbors,
    clearHighlight,
  };
}
