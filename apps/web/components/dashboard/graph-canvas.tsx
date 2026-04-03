'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type cytoscape from 'cytoscape'
import { GraphControls } from './graph-controls'

export interface GraphNode {
  id: string
  label: string
  type: string
  properties: Record<string, unknown>
}

interface GraphEdge {
  id: string
  source: string
  target: string
  label: string
}

interface GraphCanvasProps {
  apiUrl: string
  onNodeSelect: (node: GraphNode | null) => void
  highlightedNames: Set<string>
}

/** Color map for node types */
const NODE_COLORS: Record<string, string> = {
  File: '#6366f1',        // indigo
  Function: '#22c55e',    // green
  Class: '#f59e0b',       // amber
  Interface: '#06b6d4',   // cyan
  Component: '#ec4899',   // pink
  Variable: '#8b5cf6',    // violet
  Type: '#14b8a6',        // teal
  Entity: '#f97316',      // orange (knowledge)
}

export function GraphCanvas({ apiUrl, onNodeSelect, highlightedNames }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nodeCount, setNodeCount] = useState(0)

  // Initialize Cytoscape and load data
  useEffect(() => {
    let mounted = true

    async function init() {
      if (!containerRef.current) return

      // Dynamic import to avoid SSR issues
      const cy = (await import('cytoscape')).default

      try {
        const res = await fetch(`${apiUrl}/api/graph/full?limit=200`)
        if (!res.ok) throw new Error(`API error: ${res.status}`)
        const data = await res.json()

        if (!mounted) return

        const nodes = (data.nodes ?? []).map((n: GraphNode) => ({
          data: {
            id: n.id ?? n.label,
            label: n.label ?? n.id,
            type: n.type,
            ...n.properties,
          },
        }))

        const edges = (data.edges ?? []).map((e: GraphEdge, i: number) => ({
          data: {
            id: e.id ?? `edge-${i}`,
            source: e.source,
            target: e.target,
            label: e.label ?? '',
          },
        }))

        setNodeCount(nodes.length)

        const instance = cy({
          container: containerRef.current,
          elements: [...nodes, ...edges],
          style: [
            {
              selector: 'node',
              style: {
                label: 'data(label)',
                'font-size': '10px',
                'text-valign': 'bottom',
                'text-margin-y': 4,
                color: '#a1a1aa',
                'background-color': (ele: cytoscape.NodeSingular) => {
                  const type = ele.data('type') as string
                  return NODE_COLORS[type] ?? '#71717a'
                },
                width: 24,
                height: 24,
                'border-width': 0,
              } as cytoscape.Css.Node,
            },
            {
              selector: 'node.highlighted',
              style: {
                'border-width': 3,
                'border-color': '#fbbf24',
                width: 32,
                height: 32,
              } as cytoscape.Css.Node,
            },
            {
              selector: 'node:selected',
              style: {
                'border-width': 3,
                'border-color': '#3b82f6',
              } as cytoscape.Css.Node,
            },
            {
              selector: 'edge',
              style: {
                width: 1,
                'line-color': '#3f3f46',
                'target-arrow-color': '#3f3f46',
                'target-arrow-shape': 'triangle',
                'arrow-scale': 0.6,
                'curve-style': 'bezier',
                label: 'data(label)',
                'font-size': '8px',
                color: '#52525b',
                'text-rotation': 'autorotate',
              } as cytoscape.Css.Edge,
            },
          ],
          layout: {
            name: 'cose',
            animate: false,
            nodeRepulsion: () => 8000,
            idealEdgeLength: () => 80,
            gravity: 0.3,
          } as cytoscape.LayoutOptions,
          minZoom: 0.1,
          maxZoom: 5,
        })

        instance.on('tap', 'node', (evt) => {
          const node = evt.target
          onNodeSelect({
            id: node.id(),
            label: node.data('label'),
            type: node.data('type'),
            properties: node.data(),
          })
        })

        instance.on('tap', (evt) => {
          if (evt.target === instance) {
            onNodeSelect(null)
          }
        })

        cyRef.current = instance
        setLoading(false)
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load graph')
          setLoading(false)
        }
      }
    }

    init()

    return () => {
      mounted = false
      cyRef.current?.destroy()
    }
  }, [apiUrl, onNodeSelect])

  // Handle highlight changes
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return

    cy.nodes().removeClass('highlighted')
    if (highlightedNames.size > 0) {
      cy.nodes().forEach((node) => {
        if (highlightedNames.has(node.data('label'))) {
          node.addClass('highlighted')
        }
      })
    }
  }, [highlightedNames])

  const handleZoomIn = useCallback(() => {
    cyRef.current?.zoom({ level: (cyRef.current.zoom() ?? 1) * 1.3, renderedPosition: { x: containerRef.current?.clientWidth ?? 0 / 2, y: containerRef.current?.clientHeight ?? 0 / 2 } })
  }, [])

  const handleZoomOut = useCallback(() => {
    cyRef.current?.zoom({ level: (cyRef.current.zoom() ?? 1) / 1.3, renderedPosition: { x: containerRef.current?.clientWidth ?? 0 / 2, y: containerRef.current?.clientHeight ?? 0 / 2 } })
  }, [])

  const handleFit = useCallback(() => {
    cyRef.current?.fit(undefined, 40)
  }, [])

  const handleRelayout = useCallback(() => {
    cyRef.current?.layout({ name: 'cose', animate: true, animationDuration: 500, nodeRepulsion: () => 8000, idealEdgeLength: () => 80, gravity: 0.3 } as cytoscape.LayoutOptions).run()
  }, [])

  return (
    <div className="relative h-full min-h-0 w-full" data-testid="graph-canvas" data-loading={loading ? 'true' : 'false'}>
      {loading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80">
          <div className="text-sm text-muted-foreground">Loading graph...</div>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/90">
          <div className="text-sm text-red-400">{error}</div>
          {error.includes('fetch') && (
            <div className="max-w-sm text-center text-xs text-muted-foreground">
              API server is not running. Start it with:<br />
              <code className="mt-1 inline-block rounded bg-muted px-2 py-1 font-mono text-xs">
                pnpm --filter @codegraph/api dev
              </code>
            </div>
          )}
          {!error.includes('fetch') && nodeCount === 0 && (
            <div className="max-w-sm text-center text-xs text-muted-foreground">
              No graph data found. Index a codebase first via MCP or CLI.
            </div>
          )}
        </div>
      )}
      {!loading && !error && nodeCount === 0 && (
        <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-2">
          <div className="text-sm text-muted-foreground">Empty graph</div>
          <div className="text-xs text-muted-foreground/70">Index a codebase to see nodes and edges here.</div>
        </div>
      )}
      <div ref={containerRef} id="cy" className="cytoscape-container absolute inset-0" />
      <GraphControls
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFit={handleFit}
        onRelayout={handleRelayout}
        nodeCount={nodeCount}
      />
    </div>
  )
}
