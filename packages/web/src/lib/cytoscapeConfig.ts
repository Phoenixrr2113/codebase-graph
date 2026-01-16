/**
 * Cytoscape.js Configuration
 * Node/edge styling per CodeGraph MVP Specification Section 7.3
 */

import type { LayoutOptions } from 'cytoscape';
import type { NodeLabel, EdgeLabel } from '@codegraph/types';

// ============================================================================
// Node Colors (per specification)
// ============================================================================

export const NODE_COLORS: Record<NodeLabel, string> = {
  File: '#6366f1',      // Indigo
  Class: '#f59e0b',     // Amber
  Interface: '#f59e0b', // Amber (dashed border)
  Function: '#10b981',  // Emerald
  Component: '#06b6d4', // Cyan
  Variable: '#8b5cf6',  // Violet
  Type: '#ec4899',      // Pink
  Import: '#94a3b8',    // Slate (not in spec, using muted)
};

// ============================================================================
// Node Shapes
// ============================================================================

export const NODE_SHAPES: Record<NodeLabel, string> = {
  File: 'round-rectangle',
  Class: 'diamond',
  Interface: 'diamond',
  Function: 'ellipse',
  Component: 'round-rectangle',
  Variable: 'ellipse',
  Type: 'hexagon',
  Import: 'rectangle',
};

// ============================================================================
// Node Sizes
// ============================================================================

export const NODE_SIZES: Record<NodeLabel, { width: number; height: number }> = {
  File: { width: 40, height: 40 },
  Class: { width: 35, height: 35 },
  Interface: { width: 35, height: 35 },
  Function: { width: 30, height: 30 },
  Component: { width: 35, height: 35 },
  Variable: { width: 20, height: 20 },
  Type: { width: 25, height: 25 },
  Import: { width: 25, height: 20 },
};

// ============================================================================
// Edge Colors
// ============================================================================

export const EDGE_COLORS: Record<EdgeLabel, string> = {
  CALLS: '#10b981',        // Emerald
  IMPORTS: '#6366f1',      // Indigo
  IMPORTS_SYMBOL: '#6366f1',
  EXTENDS: '#f59e0b',      // Amber
  IMPLEMENTS: '#f59e0b',   // Amber
  RENDERS: '#06b6d4',      // Cyan
  CONTAINS: '#cbd5e1',     // Slate (muted)
  USES_TYPE: '#ec4899',    // Pink
  RETURNS: '#ec4899',
  HAS_PARAM: '#8b5cf6',    // Violet
  HAS_METHOD: '#f59e0b',
  HAS_PROPERTY: '#f59e0b',
  USES_HOOK: '#06b6d4',
};

// ============================================================================
// Cytoscape Stylesheet
// ============================================================================

export const cytoscapeStylesheet = [
  // Base node style
  {
    selector: 'node',
    style: {
      'background-color': '#64748b',
      'label': 'data(displayName)',
      'text-valign': 'bottom',
      'text-halign': 'center',
      'font-size': '10px',
      'color': '#e2e8f0',
      'text-margin-y': 5,
      'min-zoomed-font-size': 8,
    },
  },
  // File nodes
  {
    selector: 'node[label="File"]',
    style: {
      'background-color': NODE_COLORS.File,
      'shape': 'round-rectangle',
      'width': NODE_SIZES.File.width,
      'height': NODE_SIZES.File.height,
    },
  },
  // Class nodes
  {
    selector: 'node[label="Class"]',
    style: {
      'background-color': NODE_COLORS.Class,
      'shape': 'diamond',
      'width': NODE_SIZES.Class.width,
      'height': NODE_SIZES.Class.height,
    },
  },
  // Interface nodes
  {
    selector: 'node[label="Interface"]',
    style: {
      'background-color': NODE_COLORS.Interface,
      'shape': 'diamond',
      'width': NODE_SIZES.Interface.width,
      'height': NODE_SIZES.Interface.height,
      'border-width': 2,
      'border-style': 'dashed',
      'border-color': '#fbbf24',
    },
  },
  // Function nodes
  {
    selector: 'node[label="Function"]',
    style: {
      'background-color': NODE_COLORS.Function,
      'shape': 'ellipse',
      'width': NODE_SIZES.Function.width,
      'height': NODE_SIZES.Function.height,
    },
  },
  // Component nodes
  {
    selector: 'node[label="Component"]',
    style: {
      'background-color': NODE_COLORS.Component,
      'shape': 'round-rectangle',
      'width': NODE_SIZES.Component.width,
      'height': NODE_SIZES.Component.height,
    },
  },
  // Variable nodes
  {
    selector: 'node[label="Variable"]',
    style: {
      'background-color': NODE_COLORS.Variable,
      'shape': 'ellipse',
      'width': NODE_SIZES.Variable.width,
      'height': NODE_SIZES.Variable.height,
    },
  },
  // Type nodes
  {
    selector: 'node[label="Type"]',
    style: {
      'background-color': NODE_COLORS.Type,
      'shape': 'hexagon',
      'width': NODE_SIZES.Type.width,
      'height': NODE_SIZES.Type.height,
    },
  },
  // Import nodes
  {
    selector: 'node[label="Import"]',
    style: {
      'background-color': NODE_COLORS.Import,
      'shape': 'rectangle',
      'width': NODE_SIZES.Import.width,
      'height': NODE_SIZES.Import.height,
    },
  },
  // Selected node
  {
    selector: 'node:selected',
    style: {
      'border-width': 3,
      'border-color': '#ffffff',
      'border-opacity': 1,
    },
  },
  // Hover state
  {
    selector: 'node:active',
    style: {
      'overlay-color': '#ffffff',
      'overlay-padding': 4,
      'overlay-opacity': 0.2,
    },
  },

  // Base edge style
  {
    selector: 'edge',
    style: {
      'width': 1.5,
      'line-color': '#64748b',
      'target-arrow-color': '#64748b',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      'arrow-scale': 0.8,
    },
  },
  // CALLS edges
  {
    selector: 'edge[label="CALLS"]',
    style: {
      'line-color': EDGE_COLORS.CALLS,
      'target-arrow-color': EDGE_COLORS.CALLS,
      'width': 2,
    },
  },
  // IMPORTS edges
  {
    selector: 'edge[label="IMPORTS"]',
    style: {
      'line-color': EDGE_COLORS.IMPORTS,
      'target-arrow-color': EDGE_COLORS.IMPORTS,
      'line-style': 'dashed',
    },
  },
  // IMPORTS_SYMBOL edges
  {
    selector: 'edge[label="IMPORTS_SYMBOL"]',
    style: {
      'line-color': EDGE_COLORS.IMPORTS_SYMBOL,
      'target-arrow-color': EDGE_COLORS.IMPORTS_SYMBOL,
      'line-style': 'dashed',
      'width': 1,
    },
  },
  // EXTENDS edges
  {
    selector: 'edge[label="EXTENDS"]',
    style: {
      'line-color': EDGE_COLORS.EXTENDS,
      'target-arrow-color': EDGE_COLORS.EXTENDS,
      'width': 3,
    },
  },
  // IMPLEMENTS edges
  {
    selector: 'edge[label="IMPLEMENTS"]',
    style: {
      'line-color': EDGE_COLORS.IMPLEMENTS,
      'target-arrow-color': EDGE_COLORS.IMPLEMENTS,
      'line-style': 'dashed',
      'width': 2,
    },
  },
  // RENDERS edges
  {
    selector: 'edge[label="RENDERS"]',
    style: {
      'line-color': EDGE_COLORS.RENDERS,
      'target-arrow-color': EDGE_COLORS.RENDERS,
    },
  },
  // CONTAINS edges
  {
    selector: 'edge[label="CONTAINS"]',
    style: {
      'line-color': EDGE_COLORS.CONTAINS,
      'target-arrow-color': EDGE_COLORS.CONTAINS,
      'opacity': 0.3,
    },
  },
  // Selected edge
  {
    selector: 'edge:selected',
    style: {
      'width': 3,
      'line-color': '#ffffff',
      'target-arrow-color': '#ffffff',
    },
  },
];

// ============================================================================
// Layout Configurations
// ============================================================================

export type LayoutName = 'cose-bilkent' | 'dagre' | 'concentric' | 'breadthfirst';

export const LAYOUT_OPTIONS: Record<LayoutName, LayoutOptions> = {
  'cose-bilkent': {
    name: 'cose-bilkent',
    quality: 'default',
    nodeDimensionsIncludeLabels: true,
    fit: true,
    padding: 50,
    randomize: true,
    nodeRepulsion: 4500,
    idealEdgeLength: 100,
    edgeElasticity: 0.45,
    nestingFactor: 0.1,
    gravity: 0.25,
    numIter: 2500,
    tile: true,
    animate: 'end',
    animationDuration: 500,
  } as LayoutOptions,
  'dagre': {
    name: 'dagre',
    rankDir: 'TB',
    nodeSep: 50,
    rankSep: 80,
    fit: true,
    padding: 50,
    animate: true,
    animationDuration: 500,
  } as LayoutOptions,
  'concentric': {
    name: 'concentric',
    fit: true,
    padding: 50,
    minNodeSpacing: 50,
    concentric: (node: cytoscape.NodeSingular) => node.degree(),
    levelWidth: () => 2,
    animate: true,
    animationDuration: 500,
  } as LayoutOptions,
  'breadthfirst': {
    name: 'breadthfirst',
    directed: true,
    fit: true,
    padding: 50,
    spacingFactor: 1.5,
    animate: true,
    animationDuration: 500,
  } as LayoutOptions,
};

export const DEFAULT_LAYOUT: LayoutName = 'cose-bilkent';
