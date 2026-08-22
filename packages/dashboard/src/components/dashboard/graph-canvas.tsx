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

interface GraphWireEdge {
  id: string
  source: string
  target: string
  label: string
}

interface CanvasNodeElement {
  data: {
    id: string
    label: string
    type: string
    filePath?: string
    [key: string]: unknown
  }
}

interface CanvasEdgeElement {
  data: GraphWireEdge
}

export interface CanvasSelectionPlan {
  nodeId: string
  nodeToAdd: CanvasNodeElement | null
}

function graphNodeToCanvasElement(node: GraphNode): CanvasNodeElement {
  const filePath = typeof node.properties.filePath === 'string'
    ? node.properties.filePath
    : undefined
  return {
    data: {
      ...node.properties,
      id: node.id,
      label: node.label,
      type: node.type,
      ...(filePath !== undefined ? { filePath } : {}),
    },
  }
}

export function planCanvasSelection(
  loadedNodes: readonly GraphNode[],
  requestedNode: GraphNode,
): CanvasSelectionPlan {
  const existingNode = loadedNodes.find((node) => node.id === requestedNode.id)
  const nodeId = existingNode?.id ?? requestedNode.id

  return {
    nodeId,
    nodeToAdd: existingNode ? null : graphNodeToCanvasElement(requestedNode),
  }
}

interface GraphCanvasProps {
  apiUrl: string
  onNodeSelect: (node: GraphNode | null) => void
  selectedNode?: GraphNode | null
  highlightedNodeIds: Set<string>
  /** Persisted ids of every symbol that uses the selected one. */
  referenceNodeIds?: Set<string>
  hiddenEdgeTypes: Set<string>
  hiddenNodeTypes: Set<string>
  projectId?: string | null
}

export function GraphCanvas({ apiUrl, onNodeSelect, selectedNode, highlightedNodeIds, referenceNodeIds, hiddenEdgeTypes, hiddenNodeTypes, projectId }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nodeCount, setNodeCount] = useState(0)
  const [canvasNodes, setCanvasNodes] = useState<GraphNode[]>([])
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

        const nodes: CanvasNodeElement[] = (data.nodes ?? []).map((n: Record<string, unknown>) => {
          const nodeData = (typeof n.data === 'object' && n.data != null ? n.data : {}) as Record<string, unknown>
          const displayName = (n.displayName ?? nodeData.name ?? n.id) as string
          const nodeType = (n.label ?? nodeData.type ?? 'Unknown') as string
          return {
            data: {
              // Spread first: the graph payload carries its own internal "id",
              // and spreading it last replaced the cytoscape node id. Every edge
              // referencing the real id was then treated as an orphan and
              // dropped, so functions, classes and interfaces rendered with no
              // edges at all while files, which carry no inner id, looked fine.
              ...nodeData,
              id: n.id as string,
              label: displayName,
              type: nodeType,
              filePath: n.filePath as string | undefined,
            },
          }
        })

        const graphNodes: GraphNode[] = nodes.map((node) => ({
          id: node.data.id,
          label: node.data.label,
          type: node.data.type,
          properties: node.data,
        }))

        // Build valid node ID set to filter orphan edges
        const nodeIds = new Set(nodes.map((n: { data: { id: string } }) => n.data.id))

        const loadedEdges: GraphWireEdge[] = (data.edges ?? [])
          .flatMap((edge: Record<string, unknown>, index: number) => {
            if (typeof edge.source !== 'string' || typeof edge.target !== 'string') return []
            return [{
              id: typeof edge.id === 'string' ? edge.id : `edge-${index}`,
              source: edge.source,
              target: edge.target,
              label: typeof edge.label === 'string' ? edge.label : '',
            }]
          })
        const edges: CanvasEdgeElement[] = loadedEdges
          .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
          .map((edge) => ({ data: edge }))

        setNodeCount(nodes.length)
        setCanvasNodes(graphNodes)

        const instance = cy({
          container: containerRef.current,
          elements: [...nodes, ...edges],
          style: cytoscapeStylesheet,
          layout: LAYOUT_OPTIONS.cose,
          // Low enough that Fit can always reach the whole graph. The tree
          // layout of a few hundred nodes is wide enough that a 0.1 floor
          // clipped it, and a Fit button that does not fit is worse than a
          // small graph.
          minZoom: 0.02,
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
            instance.elements().removeClass('neighbor dimmed highlighted reference')
          }
        })

        cyRef.current = instance

        // The canvas lives inside a resizable panel, so at construction time the
        // container can still be zero-sized. Cytoscape cannot fit to a viewport
        // it cannot measure, and silently leaves the graph at zoom 1, which on a
        // 235-node graph put roughly half of it off screen until the user found
        // the Fit button. Watch the element instead and fit once it has real
        // dimensions, then keep the canvas in step as the panel is dragged.
        if (containerRef.current) {
          let fitted = false
          const observer = new ResizeObserver(() => {
            const target = cyRef.current
            if (!target || target.destroyed()) return
            const { clientWidth, clientHeight } = containerRef.current!
            if (clientWidth === 0 || clientHeight === 0) return
            target.resize()
            if (!fitted) {
              fitted = true
              target.fit(undefined, 40)
            }
          })
          observer.observe(containerRef.current)
          resizeObserverRef.current = observer
        }

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
      resizeObserverRef.current?.disconnect()
      resizeObserverRef.current = null
      cyRef.current?.destroy()
    }
  }, [apiUrl, onNodeSelect, projectId])

  // Search, breadcrumb, reference, and File relationship selections can point
  // outside the initial graph window. Add that node before centering it. Direct
  // relationship and reference responses do not carry edge records, so there
  // is no honest way for the dashboard to invent missing connections.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy || !selectedNode) return

    const plan = planCanvasSelection(canvasNodes, selectedNode)
    if (plan.nodeToAdd) {
      cy.add(plan.nodeToAdd)
      setCanvasNodes((current) => [...current, selectedNode])
      setNodeCount((current) => current + 1)
    }

    const target = cy.getElementById(plan.nodeId)
    if (target.length === 0) return
    cy.nodes().unselect()
    target.select()
    cy.animate({ center: { eles: target }, duration: 250 })
  }, [selectedNode, loading])

  // Handle search highlight changes
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return

    cy.nodes().removeClass('highlighted dimmed')
    cy.edges().removeClass('dimmed')
    if (highlightedNodeIds.size > 0) {
      cy.nodes().forEach((node) => {
        if (highlightedNodeIds.has(node.id())) {
          node.addClass('highlighted')
        } else {
          node.addClass('dimmed')
        }
      })
      cy.edges().addClass('dimmed')
    }
  }, [highlightedNodeIds])

  // Mark the symbols that use the selected one.
  //
  // Only the references that happen to be loaded can be drawn: the canvas holds
  // a window onto the graph, and a caller in an unloaded file has no node here.
  // The detail panel lists the full set, so nothing is lost by that.
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return

    cy.nodes().removeClass('reference')
    if (!referenceNodeIds || referenceNodeIds.size === 0) return

    cy.nodes().forEach((node) => {
      if (referenceNodeIds.has(node.id())) node.addClass('reference')
    })
  }, [referenceNodeIds])

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

  const handleNodeListSelect = useCallback((node: GraphNode) => {
    const cy = cyRef.current
    const target = cy?.getElementById(node.id)
    if (cy && target && target.length > 0) {
      cy.nodes().unselect()
      target.select()
      cy.animate({ center: { eles: target }, duration: 250 })
    }
    onNodeSelect(node)
  }, [onNodeSelect])

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
          <div className="text-xs text-subtle">Index a codebase to see nodes and edges here.</div>
        </div>
      )}
      <div
        ref={containerRef}
        id="cy"
        role="region"
        aria-label="Code graph visualization"
        className="cytoscape-container"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <details className="absolute bottom-4 left-4 z-10 max-h-56 w-56 overflow-hidden rounded-lg border border-border bg-card/95 text-xs shadow-lg backdrop-blur-sm">
        <summary className="cursor-pointer px-3 py-2 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          Nodes ({nodeCount})
        </summary>
        <div aria-label="Graph nodes" className="max-h-44 overflow-y-auto border-t border-border p-1">
          {canvasNodes.length === 0 ? (
            <p className="px-2 py-1.5 text-subtle">No nodes loaded</p>
          ) : canvasNodes.map((node) => (
            <button
              key={node.id}
              type="button"
              className="block w-full truncate rounded px-2 py-1.5 text-left text-muted-foreground hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => handleNodeListSelect(node)}
            >
              {node.label}
              <span className="ml-1 text-subtle">{node.type}</span>
            </button>
          ))}
        </div>
      </details>
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
