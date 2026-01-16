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
  const nodes: ElementDefinition[] = data.nodes.map((node) => ({
    group: 'nodes' as const,
    data: {
      id: node.id,
      label: node.label,
      displayName: node.displayName,
      filePath: node.filePath,
    },
  }));

  const edges: ElementDefinition[] = data.edges.map((edge) => ({
    group: 'edges' as const,
    data: {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
    },
  }));

  return [...nodes, ...edges];
}

// ============================================================================
// Hook Implementation
// ============================================================================

export function useCytoscape(options: UseCytoscapeOptions = {}): UseCytoscapeReturn {
  const { onNodeSelect, onNodeDoubleClick } = options;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const [layout, setLayoutState] = useState<LayoutName>(DEFAULT_LAYOUT);

  // Initialize Cytoscape
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

    // Node selection handler
    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      if (onNodeSelect) {
        const graphNode: GraphNode = {
          id: node.id(),
          label: node.data('label'),
          displayName: node.data('displayName'),
          filePath: node.data('filePath'),
          data: node.data(),
        } as GraphNode;
        onNodeSelect(graphNode);
      }
    });

    // Background click - deselect
    cy.on('tap', (evt) => {
      if (evt.target === cy) {
        onNodeSelect?.(null);
      }
    });

    // Double-click handler
    cy.on('dbltap', 'node', (evt) => {
      const node = evt.target;
      if (onNodeDoubleClick) {
        const graphNode: GraphNode = {
          id: node.id(),
          label: node.data('label'),
          displayName: node.data('displayName'),
          filePath: node.data('filePath'),
          data: node.data(),
        } as GraphNode;
        onNodeDoubleClick(graphNode);
      }
    });

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [onNodeSelect, onNodeDoubleClick]);

  // Set graph data
  const setData = useCallback((data: GraphData) => {
    const cy = cyRef.current;
    if (!cy) return;

    cy.elements().remove();
    const elements = graphDataToElements(data);
    cy.add(elements);
    
    // Run layout after adding elements
    const layoutOptions = LAYOUT_OPTIONS[layout];
    cy.layout(layoutOptions).run();
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
