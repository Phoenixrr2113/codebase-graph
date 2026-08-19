/**
 * Cytoscape.js Configuration
 * Node/edge styling, shapes, sizes, and layout presets.
 * Ported from old packages/web with adaptations for current dashboard.
 */

import type cytoscape from 'cytoscape'

// ============================================================================
// Node Colors
// ============================================================================

export const NODE_COLORS: Record<string, string> = {
  File: '#6366f1',           // Indigo
  Class: '#f59e0b',          // Amber
  Interface: '#f59e0b',      // Amber (dashed border)
  Function: '#10b981',       // Emerald
  Component: '#06b6d4',      // Cyan
  Variable: '#8b5cf6',       // Violet
  Type: '#ec4899',           // Pink
  Import: '#94a3b8',         // Slate
  Commit: '#22c55e',         // Green
  MarkdownDocument: '#3b82f6', // Blue
  Section: '#60a5fa',        // Light blue
  CodeBlock: '#a78bfa',      // Light violet
  Link: '#2dd4bf',           // Teal
  Entity: '#f97316',         // Orange (knowledge)
}

// ============================================================================
// Node Shapes
// ============================================================================

export const NODE_SHAPES: Record<string, cytoscape.Css.NodeShape> = {
  File: 'round-rectangle',
  Class: 'diamond',
  Interface: 'diamond',
  Function: 'ellipse',
  Component: 'round-rectangle',
  Variable: 'ellipse',
  Type: 'hexagon',
  Import: 'rectangle',
  Commit: 'tag',
  MarkdownDocument: 'round-rectangle',
  Section: 'rectangle',
  CodeBlock: 'round-rectangle',
  Link: 'ellipse',
  Entity: 'round-rectangle',
}

// ============================================================================
// Node Sizes
// ============================================================================

export const NODE_SIZES: Record<string, { width: number; height: number }> = {
  File: { width: 40, height: 40 },
  Class: { width: 35, height: 35 },
  Interface: { width: 35, height: 35 },
  Function: { width: 30, height: 30 },
  Component: { width: 35, height: 35 },
  Variable: { width: 20, height: 20 },
  Type: { width: 25, height: 25 },
  Import: { width: 25, height: 20 },
  Commit: { width: 30, height: 25 },
  MarkdownDocument: { width: 40, height: 40 },
  Section: { width: 30, height: 25 },
  CodeBlock: { width: 25, height: 25 },
  Link: { width: 20, height: 20 },
  Entity: { width: 30, height: 30 },
}

// ============================================================================
// Edge Colors
// ============================================================================

export const EDGE_COLORS: Record<string, string> = {
  CALLS: '#10b981',
  IMPORTS: '#6366f1',
  IMPORTS_SYMBOL: '#6366f1',
  EXTENDS: '#f59e0b',
  IMPLEMENTS: '#f59e0b',
  RENDERS: '#06b6d4',
  CONTAINS: '#cbd5e1',
  ABOUT: '#f472b6',
  RELATES_TO: '#f97316',
  SAID: '#a78bfa',
  INTRODUCED_IN: '#22c55e',
  MODIFIED_IN: '#eab308',
  DELETED_IN: '#ef4444',
}

// ============================================================================
// Cytoscape Stylesheet
// ============================================================================

function nodeStyle(label: string): cytoscape.StylesheetJsonBlock {
  const color = NODE_COLORS[label] ?? '#64748b'
  const shape = NODE_SHAPES[label] ?? 'ellipse'
  const size = NODE_SIZES[label] ?? { width: 25, height: 25 }
  const style: cytoscape.Css.Node = {
    'background-color': color,
    shape,
    width: size.width,
    height: size.height,
    ...(label === 'Interface' ? { 'border-width': 2, 'border-style': 'dashed' as const, 'border-color': '#fbbf24' } : {}),
  }

  return {
    selector: `node[type="${label}"]`,
    style,
  }
}

function edgeStyle(label: string, extra: cytoscape.Css.Edge = {}): cytoscape.StylesheetJsonBlock {
  const color = EDGE_COLORS[label] ?? '#64748b'
  const style: cytoscape.Css.Edge = {
    'line-color': color,
    'target-arrow-color': color,
    ...extra,
  }

  return {
    selector: `edge[label="${label}"]`,
    style,
  }
}

export const cytoscapeStylesheet: cytoscape.StylesheetJson = [
  // Base node
  {
    selector: 'node',
    style: {
      'background-color': '#64748b',
      label: 'data(label)',
      'text-valign': 'bottom' as const,
      'text-halign': 'center' as const,
      'font-size': '10px',
      color: '#e2e8f0',
      'text-margin-y': 5,
      'min-zoomed-font-size': 8,
      width: 25,
      height: 25,
    },
  },
  // Per-type node styles
  ...Object.keys(NODE_COLORS).map(label => nodeStyle(label)),
  // Selected
  {
    selector: 'node:selected',
    style: { 'border-width': 3, 'border-color': '#ffffff' },
  },
  // Highlighted (search results)
  {
    selector: 'node.highlighted',
    style: { 'border-width': 3, 'border-color': '#fbbf24', width: 40, height: 40 },
  },
  // Neighbor highlight
  {
    selector: 'node.neighbor',
    style: { 'border-width': 2, 'border-color': '#60a5fa' },
  },
  // Dimmed (when something is highlighted, dim the rest)
  {
    selector: 'node.dimmed',
    style: { opacity: 0.2 },
  },
  {
    selector: 'edge.dimmed',
    style: { opacity: 0.1 },
  },
  // Base edge
  {
    selector: 'edge',
    style: {
      width: 1.5,
      'line-color': '#64748b',
      'target-arrow-color': '#64748b',
      'target-arrow-shape': 'triangle' as const,
      'curve-style': 'bezier' as const,
      'arrow-scale': 0.8,
    },
  },
  // Per-type edge styles
  edgeStyle('CALLS', { width: 2 }),
  edgeStyle('IMPORTS', { 'line-style': 'dashed' }),
  edgeStyle('EXTENDS', { width: 3 }),
  edgeStyle('IMPLEMENTS', { 'line-style': 'dashed', width: 2 }),
  edgeStyle('RENDERS'),
  edgeStyle('CONTAINS', { opacity: 0.3 }),
  edgeStyle('ABOUT', { 'line-style': 'dotted', width: 2 }),
  edgeStyle('RELATES_TO', { 'line-style': 'dotted' }),
  // Selected edge
  {
    selector: 'edge:selected',
    style: { width: 3, 'line-color': '#ffffff', 'target-arrow-color': '#ffffff' },
  },
  // Hidden elements (via type filters)
  {
    selector: 'node.hidden',
    style: { display: 'none' as const },
  },
  {
    selector: 'edge.hidden',
    style: { display: 'none' as const },
  },
]

// ============================================================================
// Layout Presets
// ============================================================================

export type LayoutName = 'cose' | 'concentric' | 'breadthfirst'

export const LAYOUT_OPTIONS: Record<LayoutName, cytoscape.LayoutOptions> = {
  cose: {
    name: 'cose',
    animate: true,
    animationDuration: 500,
    nodeRepulsion: () => 8000,
    idealEdgeLength: () => 80,
    gravity: 0.3,
    fit: true,
    padding: 40,
  },
  concentric: {
    name: 'concentric',
    fit: true,
    padding: 50,
    minNodeSpacing: 50,
    animate: true,
    animationDuration: 500,
  },
  breadthfirst: {
    name: 'breadthfirst',
    directed: true,
    fit: true,
    padding: 50,
    spacingFactor: 1.5,
    animate: true,
    animationDuration: 500,
  },
}
