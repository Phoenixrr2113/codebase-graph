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
  spreadOut: () => void;
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

  // Set graph data - incrementally add/remove nodes, preserving positions
  const setData = useCallback((data: GraphData) => {
    const cy = cyRef.current;
    if (!cy) return;

    // Store full graph data for node lookups on click
    graphDataRef.current = data;

    const newElements = graphDataToElements(data);
    const existingNodeIds = new Set(cy.nodes().map(n => n.id()));
    const existingEdgeIds = new Set(cy.edges().map(e => e.id()));
    const newNodeIds = new Set(data.nodes.map(n => n.id));
    const newEdgeIds = new Set(data.edges.map(e => e.id));

    // Find nodes/edges to add and remove
    const nodesToAdd = newElements.filter(el => el.group === 'nodes' && !existingNodeIds.has(el.data.id as string));
    const edgesToAdd = newElements.filter(el => el.group === 'edges' && !existingEdgeIds.has(el.data.id as string));
    const nodesToRemove = cy.nodes().filter(n => !newNodeIds.has(n.id()));
    const edgesToRemove = cy.edges().filter(e => !newEdgeIds.has(e.id()));

    const isInitialLoad = existingNodeIds.size === 0;
    const hasNewNodes = nodesToAdd.length > 0;

    cy.batch(() => {
      // Remove stale elements
      nodesToRemove.remove();
      edgesToRemove.remove();

      // Add new elements
      if (nodesToAdd.length > 0 || edgesToAdd.length > 0) {
        // For new nodes, position them near their connected existing node
        for (const nodeEl of nodesToAdd) {
          const nodeId = nodeEl.data.id as string;

          // Find an edge connecting this new node to an existing node
          const connectedEdge = edgesToAdd.find(e => {
            const src = e.data.source as string;
            const tgt = e.data.target as string;
            return (src === nodeId && existingNodeIds.has(tgt)) ||
              (tgt === nodeId && existingNodeIds.has(src));
          });

          if (connectedEdge) {
            // Get parent node position
            const parentId = connectedEdge.data.source === nodeId
              ? connectedEdge.data.target as string
              : connectedEdge.data.source as string;
            const parentNode = cy.$id(parentId);

            if (parentNode.length > 0) {
              const pos = parentNode.position();
              // Random offset around parent (70-120px away)
              const angle = Math.random() * 2 * Math.PI;
              const distance = 70 + Math.random() * 50;
              nodeEl.position = {
                x: pos.x + Math.cos(angle) * distance,
                y: pos.y + Math.sin(angle) * distance,
              };
            }
          }
        }

        cy.add([...nodesToAdd, ...edgesToAdd]);
      }
    });

    // Run layout
    if (isInitialLoad && cy.elements().length > 0) {
      // Full layout for initial load
      cy.layout(LAYOUT_OPTIONS[layout]).run();
    } else if (hasNewNodes) {
      // For incremental updates, just run a quick local layout on new nodes only
      const newNodeSelector = nodesToAdd.map(n => `#${CSS.escape(n.data.id as string)}`).join(',');
      if (newNodeSelector) {
        const newNodes = cy.$(newNodeSelector);
        // Use a simple concentric layout just for the new nodes
        newNodes.layout({
          name: 'concentric',
          animate: false,
          fit: false,
          boundingBox: newNodes.boundingBox(),
        }).run();
      }
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

  // Spread out nodes - runs layout with increased spacing to disperse clusters
  const spreadOut = useCallback(() => {
    const cy = cyRef.current;
    if (!cy) return;

    // Use current layout but with increased spacing
    // Cast to unknown first to allow property access
    const baseOptions = LAYOUT_OPTIONS[layout] as unknown as Record<string, number | string | boolean | undefined>;
    const spreadOptions = {
      ...LAYOUT_OPTIONS[layout],
      // Increase spacing for cose-bilkent
      nodeRepulsion: (baseOptions['nodeRepulsion'] ?? 4500) as number * 2,
      idealEdgeLength: (baseOptions['idealEdgeLength'] ?? 100) as number * 1.5,
      gravity: (baseOptions['gravity'] ?? 0.25) as number * 0.5,
      // Increase spacing for dagre
      nodeSep: (baseOptions['nodeSep'] ?? 50) as number * 2,
      rankSep: (baseOptions['rankSep'] ?? 80) as number * 1.5,
      // Increase spacing for others
      spacingFactor: (baseOptions['spacingFactor'] ?? 1.5) as number * 1.5,
      minNodeSpacing: (baseOptions['minNodeSpacing'] ?? 50) as number * 2,
    };
    cy.layout(spreadOptions).run();
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
    spreadOut,
    fit,
    zoomIn,
    zoomOut,
    setData,
    selectNode,
    highlightNeighbors,
    clearHighlight,
  };
}
