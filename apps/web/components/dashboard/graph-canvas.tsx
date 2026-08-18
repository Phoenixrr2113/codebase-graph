'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import type cytoscape from 'cytoscape'
import { GraphControls } from './graph-controls'
import { cytoscapeStylesheet, LAYOUT_OPTIONS, type LayoutName } from '@/lib/cytoscape-config'

export interface GraphNode {
  id: string
  label: string
  type: string
  properties: Record<string, unknown>
}

interface GraphCanvasProps {
  apiUrl: string
  onNodeSelect: (node: GraphNode | null) => void
  highlightedNames: Set<string>
  hiddenEdgeTypes: Set<string>
  hiddenNodeTypes: Set<string>
  projectId?: string | null
}

export function GraphCanvas({ apiUrl, onNodeSelect, highlightedNames, hiddenEdgeTypes, hiddenNodeTypes, projectId }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nodeCount, setNodeCount] = useState(0)
  const [layout, setLayout] = useState<LayoutName>('cose')

  // Initialize Cytoscape and load data
  useEffect(() => {
    let mounted = true

    async function init() {
      if (!containerRef.current) return

      const cy = (await import('cytoscape')).default

      try {
        const graphUrl = projectId
          ? `${apiUrl}/api/graph/full?limit=300&projectId=${encodeURIComponent(projectId)}`
          : `${apiUrl}/api/graph/full?limit=300`
        const res = await fetch(graphUrl)
        if (!res.ok) throw new Error(`API error: ${res.status}`)
        const data = await res.json()

        if (!mounted) return

        const nodes = (data.nodes ?? []).map((n: Record<string, unknown>) => {
          const nodeData = (typeof n.data === 'object' && n.data != null ? n.data : {}) as Record<string, unknown>
          const displayName = (n.displayName ?? nodeData.name ?? n.id) as string
          const nodeType = (n.label ?? nodeData.type ?? 'Unknown') as string
          return {
            data: {
              id: n.id as string,
              label: displayName,
              type: nodeType,
              filePath: n.filePath as string | undefined,
              ...nodeData,
            },
          }
        })

        // Build valid node ID set to filter orphan edges
        const nodeIds = new Set(nodes.map((n: { data: { id: string } }) => n.data.id))

        const edges = (data.edges ?? [])
          .filter((e: Record<string, unknown>) => nodeIds.has(e.source as string) && nodeIds.has(e.target as string))
          .map((e: Record<string, unknown>, i: number) => ({
            data: {
              id: (e.id ?? `edge-${i}`) as string,
              source: e.source as string,
              target: e.target as string,
              label: (e.label ?? '') as string,
            },
          }))

        setNodeCount(nodes.length)

        const instance = cy({
          container: containerRef.current,
          elements: [...nodes, ...edges],
          style: cytoscapeStylesheet,
          layout: LAYOUT_OPTIONS.cose,
          minZoom: 0.1,
          maxZoom: 5,
        })

        // Node click → select + show detail
        instance.on('tap', 'node', (evt) => {
          const node = evt.target
          onNodeSelect({
            id: node.id(),
            label: node.data('label'),
            type: node.data('type'),
            properties: node.data(),
          })

          // Highlight neighbors
          instance.elements().removeClass('neighbor dimmed')
          const neighborhood = node.neighborhood().add(node)
          instance.elements().not(neighborhood).addClass('dimmed')
          neighborhood.nodes().not(node).addClass('neighbor')
        })

        // Node double-click → focus on neighborhood
        instance.on('dbltap', 'node', (evt) => {
          const node = evt.target
          const neighborhood = node.neighborhood().add(node)
          instance.animate({ fit: { eles: neighborhood, padding: 60 }, duration: 400 })
        })

        // Click on background → deselect
        instance.on('tap', (evt) => {
          if (evt.target === instance) {
            onNodeSelect(null)
            instance.elements().removeClass('neighbor dimmed highlighted')
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
  }, [apiUrl, onNodeSelect, projectId])

  // Handle search highlight changes
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return

    cy.nodes().removeClass('highlighted dimmed')
    cy.edges().removeClass('dimmed')
    if (highlightedNames.size > 0) {
      cy.nodes().forEach((node) => {
        if (highlightedNames.has(node.data('label'))) {
          node.addClass('highlighted')
        } else {
          node.addClass('dimmed')
        }
      })
      cy.edges().addClass('dimmed')
    }
  }, [highlightedNames])

  // Handle edge type filter changes
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return

    cy.edges().forEach((edge) => {
      const edgeType = edge.data('label') as string
      if (hiddenEdgeTypes.has(edgeType)) {
        edge.addClass('hidden')
      } else {
        edge.removeClass('hidden')
      }
    })
  }, [hiddenEdgeTypes])

  // Handle node type filter changes
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return

    cy.nodes().forEach((node) => {
      const nodeType = node.data('type') as string
      if (hiddenNodeTypes.has(nodeType)) {
        node.addClass('hidden')
        // Also hide edges connected to hidden nodes
        node.connectedEdges().addClass('hidden')
      } else {
        node.removeClass('hidden')
        // Restore edges that aren't edge-type-filtered
        node.connectedEdges().forEach((edge) => {
          const edgeType = edge.data('label') as string
          if (!hiddenEdgeTypes.has(edgeType)) {
            // Only show if both source and target are visible
            const src = edge.source()
            const tgt = edge.target()
            if (!hiddenNodeTypes.has(src.data('type')) && !hiddenNodeTypes.has(tgt.data('type'))) {
              edge.removeClass('hidden')
            }
          }
        })
      }
    })
  }, [hiddenNodeTypes, hiddenEdgeTypes])

  const handleZoomIn = useCallback(() => {
    const cy = cyRef.current
    if (!cy) return
    const w = containerRef.current?.clientWidth ?? 600
    const h = containerRef.current?.clientHeight ?? 400
    cy.zoom({ level: cy.zoom() * 1.3, renderedPosition: { x: w / 2, y: h / 2 } })
  }, [])

  const handleZoomOut = useCallback(() => {
    const cy = cyRef.current
    if (!cy) return
    const w = containerRef.current?.clientWidth ?? 600
    const h = containerRef.current?.clientHeight ?? 400
    cy.zoom({ level: cy.zoom() / 1.3, renderedPosition: { x: w / 2, y: h / 2 } })
  }, [])

  const handleFit = useCallback(() => {
    cyRef.current?.fit(undefined, 40)
  }, [])

  const handleRelayout = useCallback((newLayout?: LayoutName) => {
    const l = newLayout ?? layout
    if (newLayout) setLayout(l)
    cyRef.current?.layout(LAYOUT_OPTIONS[l]).run()
  }, [layout])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }} data-testid="graph-canvas" data-loading={loading ? 'true' : 'false'}>
      {loading && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.8)' }}>
          <div className="text-sm text-muted-foreground">Loading graph...</div>
        </div>
      )}
      {error && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, background: 'rgba(0,0,0,0.9)' }}>
          <div className="text-sm text-red-400">{error}</div>
          {error.includes('fetch') && (
            <div className="max-w-sm text-center text-xs text-muted-foreground">
              API server is not running. Start it with:<br />
              <code className="mt-1 inline-block rounded bg-muted px-2 py-1 font-mono text-xs">
                pnpm --filter @codegraph/api dev
              </code>
            </div>
          )}
        </div>
      )}
      {!loading && !error && nodeCount === 0 && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 5, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <div className="text-sm text-muted-foreground">Empty graph</div>
          <div className="text-xs text-muted-foreground/70">Index a codebase to see nodes and edges here.</div>
        </div>
      )}
      <div ref={containerRef} id="cy" className="cytoscape-container" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      <GraphControls
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFit={handleFit}
        onRelayout={handleRelayout}
        nodeCount={nodeCount}
        layout={layout}
      />
    </div>
  )
}
