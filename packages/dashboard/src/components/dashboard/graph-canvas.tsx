import { useEffect, useRef, useState, useCallback } from 'react'
import type cytoscape from 'cytoscape'
import { GraphControls } from './graph-controls'
import { cytoscapeStylesheet, LAYOUT_OPTIONS, type LayoutName } from '@/lib/cytoscape-config'
import {
  fetchGraphWindow,
  fetchGraphInducedEdges,
  fetchNeighbors,
  planGraphPageAppend,
  planInducedEdgeRequests,
  planGraphExpansion,
  resetGraphWindow,
  restoreGraphWindow,
  type GraphEdgeData,
  type GraphExpansionPlan,
  type GraphNodeData,
  type GraphViewMode,
  type GraphWindow,
  type GraphWindowLimit,
} from '@/lib/graph-window'

export type GraphNode = GraphNodeData

type GraphWireEdge = GraphEdgeData

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

export interface CanvasViewport {
  pan: cytoscape.Position
  zoom: number
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

export function applyCanvasExpansion(
  cy: cytoscape.Core,
  plan: GraphExpansionPlan,
  viewport: CanvasViewport = { pan: { ...cy.pan() }, zoom: cy.zoom() },
): void {
  const existingNodes = cy.nodes()
  const previouslyUnlockedNodes = existingNodes.filter((element) => !element.locked())
  existingNodes.lock()
  try {
    cy.batch(() => {
      cy.add([
        ...plan.newNodes.map(({ node, position }) => ({
          ...graphNodeToCanvasElement(node),
          position,
        })),
        ...plan.newEdges.map((edge) => ({ data: edge })),
      ])
    })
  } finally {
    previouslyUnlockedNodes.unlock()
    cy.pan(viewport.pan)
    cy.zoom(viewport.zoom)
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
  mode?: GraphViewMode
  includeExternals?: boolean
  windowLimit?: GraphWindowLimit
  pageOffset?: number
  fileScope?: GraphNode | null
  onModeChange?: (mode: GraphViewMode) => void
  onIncludeExternalsChange?: (value: boolean) => void
  onWindowLimitChange?: (limit: GraphWindowLimit) => void
  onPageChange?: (offset: number) => void
  expansionRequest?: { node: GraphNode; sequence: number } | null
  restoredExpansions?: readonly GraphNode[]
  onExpanded?: (node: GraphNode) => void
  onResetView?: () => void
}

export function GraphCanvas({
  apiUrl,
  onNodeSelect,
  selectedNode,
  highlightedNodeIds,
  referenceNodeIds,
  hiddenEdgeTypes,
  hiddenNodeTypes,
  projectId,
  mode = 'symbols',
  includeExternals = true,
  windowLimit = 300,
  pageOffset = 0,
  fileScope = null,
  onModeChange,
  onIncludeExternalsChange,
  onWindowLimitChange,
  onPageChange,
  expansionRequest = null,
  restoredExpansions = [],
  onExpanded,
  onResetView,
}: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<cytoscape.Core | null>(null)
  const graphWindowRef = useRef<GraphWindow | null>(null)
  const baseWindowRef = useRef<GraphWindow | null>(null)
  const expandNodeRef = useRef<((node: GraphNode) => Promise<void>) | null>(null)
  const handledExpansionSequenceRef = useRef<number | null>(null)
  const expansionAbortRef = useRef<AbortController | null>(null)
  const restorationAbortRef = useRef<AbortController | null>(null)
  const loadMoreAbortRef = useRef<AbortController | null>(null)
  const appliedExpansionIdsRef = useRef<string[]>([])
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nodeCount, setNodeCount] = useState(0)
  const [edgeCount, setEdgeCount] = useState(0)
  const [canvasNodes, setCanvasNodes] = useState<GraphNode[]>([])
  const [graphWindow, setGraphWindow] = useState<GraphWindow | null>(null)
  const [baseWindow, setBaseWindow] = useState<GraphWindow | null>(null)
  const [expandingNodeId, setExpandingNodeId] = useState<string | null>(null)
  const [expansionError, setExpansionError] = useState<string | null>(null)
  const [layout, setLayout] = useState<LayoutName>('cose')
  const [renderRevision, setRenderRevision] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [liveAnnouncement, setLiveAnnouncement] = useState('')

  const expandNode = useCallback(async (node: GraphNode): Promise<void> => {
    if (expansionAbortRef.current !== null) return
    const initialCy = cyRef.current
    const viewport = initialCy && !initialCy.destroyed()
      ? { pan: { ...initialCy.pan() }, zoom: initialCy.zoom() }
      : null
    const controller = new AbortController()
    expansionAbortRef.current = controller
    setExpandingNodeId(node.id)
    setExpansionError(null)
    try {
      const incoming = await fetchNeighbors(apiUrl, node.id, windowLimit, controller.signal)
      const current = graphWindowRef.current
      const cy = cyRef.current
      if (!current || !cy || cy.destroyed()) return

      const target = cy.getElementById(node.id)
      if (target.length === 0) return
      const plan = planGraphExpansion(current, incoming, node.id, target.position())
      const merged = plan.window

      applyCanvasExpansion(cy, plan, viewport ?? undefined)
      graphWindowRef.current = merged
      appliedExpansionIdsRef.current = [...appliedExpansionIdsRef.current, node.id]
      setGraphWindow(merged)
      setCanvasNodes(merged.nodes)
      setNodeCount(merged.nodes.length)
      setEdgeCount(merged.edges.length)
      if (incoming.incomingTruncated || incoming.outgoingTruncated) {
        target.addClass('truncated')
      }
      onExpanded?.(node)
    } catch (error) {
      if (controller.signal.aborted) return
      console.error('Failed to expand graph node', error)
      setExpansionError(error instanceof Error ? error.message : 'Failed to expand node')
    } finally {
      if (expansionAbortRef.current === controller) {
        expansionAbortRef.current = null
        setExpandingNodeId(null)
      }
    }
  }, [apiUrl, onExpanded, windowLimit])
  expandNodeRef.current = expandNode

  // Initialize Cytoscape and load data
  useEffect(() => {
    let mounted = true
    setLoading(true)
    setError(null)
    setExpansionError(null)
    setExpandingNodeId(null)

    async function init() {
      if (!containerRef.current) return

      const cy = (await import('cytoscape')).default

      try {
        const data = await fetchGraphWindow({
          apiUrl,
          mode,
          limit: windowLimit,
          offset: pageOffset,
          includeExternals,
          projectId,
          fileScope,
        })

        if (!mounted) return

        const nodes = data.nodes.map(graphNodeToCanvasElement)

        // Build valid node ID set to filter orphan edges
        const nodeIds = new Set(nodes.map((n: { data: { id: string } }) => n.data.id))
        const loadedEdges = data.edges
        const visibleEdges = loadedEdges
          .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
        const edges: CanvasEdgeElement[] = visibleEdges
          .map((edge) => ({ data: edge }))
        const visibleWindow = { ...data, edges: visibleEdges }

        setNodeCount(nodes.length)
        setEdgeCount(edges.length)
        setCanvasNodes(data.nodes)
        setGraphWindow(visibleWindow)
        setBaseWindow(visibleWindow)
        graphWindowRef.current = visibleWindow
        baseWindowRef.current = visibleWindow
        appliedExpansionIdsRef.current = []

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

        // Node double-click loads direct neighbors before focusing the result.
        instance.on('dbltap', 'node', (evt) => {
          const node = evt.target
          void expandNodeRef.current?.({
            id: node.id(),
            label: node.data('label'),
            type: node.data('type'),
            properties: node.data(),
          })
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
        const rangeStart = data.returned === 0 ? 0 : data.offset + 1
        const rangeEnd = data.offset + data.returned
        setLiveAnnouncement(`Loaded nodes ${rangeStart.toLocaleString()} to ${rangeEnd.toLocaleString()} of ${data.totalNodes.toLocaleString()}.`)
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
      expansionAbortRef.current?.abort()
      expansionAbortRef.current = null
      restorationAbortRef.current?.abort()
      restorationAbortRef.current = null
      loadMoreAbortRef.current?.abort()
      loadMoreAbortRef.current = null
      appliedExpansionIdsRef.current = []
      graphWindowRef.current = null
      baseWindowRef.current = null
    }
  }, [apiUrl, fileScope, includeExternals, mode, onNodeSelect, pageOffset, projectId, windowLimit])

  useEffect(() => {
    if (
      loading
      || !expansionRequest
      || handledExpansionSequenceRef.current === expansionRequest.sequence
    ) return
    handledExpansionSequenceRef.current = expansionRequest.sequence
    void expandNode(expansionRequest.node)
  }, [expandNode, expansionRequest, loading])

  useEffect(() => {
    if (loading) return
    const requestedIds = restoredExpansions.map((node) => node.id)
    if (
      requestedIds.length === appliedExpansionIdsRef.current.length
      && requestedIds.every((id, index) => id === appliedExpansionIdsRef.current[index])
    ) return

    const base = baseWindowRef.current
    const cy = cyRef.current
    if (!base || !cy || cy.destroyed()) return

    restorationAbortRef.current?.abort()
    const controller = new AbortController()
    restorationAbortRef.current = controller
    void restoreGraphWindow(
      base,
      restoredExpansions,
      (node) => fetchNeighbors(apiUrl, node.id, windowLimit, controller.signal),
    ).then((restored) => {
      if (controller.signal.aborted || cy.destroyed()) return
      const nodeIds = new Set(restored.nodes.map((node) => node.id))
      const visibleWindow = {
        ...restored,
        edges: restored.edges.filter(
          (edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target),
        ),
      }
      cy.elements().remove()
      cy.add([
        ...visibleWindow.nodes.map(graphNodeToCanvasElement),
        ...visibleWindow.edges.map((edge) => ({ data: edge })),
      ])
      cy.layout(LAYOUT_OPTIONS[layout]).run()
      graphWindowRef.current = visibleWindow
      appliedExpansionIdsRef.current = requestedIds
      setGraphWindow(visibleWindow)
      setCanvasNodes(visibleWindow.nodes)
      setNodeCount(visibleWindow.nodes.length)
      setEdgeCount(visibleWindow.edges.length)
      setRenderRevision((current) => current + 1)
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      console.error('Failed to restore graph view', error)
      setExpansionError(error instanceof Error ? error.message : 'Failed to restore graph view')
    }).finally(() => {
      if (restorationAbortRef.current === controller) restorationAbortRef.current = null
    })

    return () => controller.abort()
  }, [apiUrl, layout, loading, restoredExpansions, windowLimit])

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
  }, [selectedNode, loading, renderRevision])

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
  }, [highlightedNodeIds, renderRevision])

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
  }, [referenceNodeIds, renderRevision])

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
  }, [hiddenEdgeTypes, renderRevision])

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
  }, [hiddenNodeTypes, hiddenEdgeTypes, renderRevision])

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

  const handleReset = useCallback(() => {
    const cy = cyRef.current
    const base = baseWindowRef.current
    if (!cy || cy.destroyed() || !base) return
    const reset = resetGraphWindow(base)
    cy.elements().remove()
    cy.add([
      ...reset.nodes.map(graphNodeToCanvasElement),
      ...reset.edges.map((edge) => ({ data: edge })),
    ])
    cy.layout(LAYOUT_OPTIONS[layout]).run()
    graphWindowRef.current = reset
    appliedExpansionIdsRef.current = []
    setGraphWindow(reset)
    setCanvasNodes(reset.nodes)
    setNodeCount(reset.nodes.length)
    setEdgeCount(reset.edges.length)
    setExpansionError(null)
    setRenderRevision((current) => current + 1)
    onResetView?.()
  }, [layout, onResetView])

  const handlePreviousPage = useCallback(() => {
    const current = graphWindowRef.current
    if (!current || current.offset === 0 || loadingMore) return
    onPageChange?.(Math.max(0, current.offset - current.limit))
  }, [loadingMore, onPageChange])

  const handleNextPage = useCallback(() => {
    const current = graphWindowRef.current
    if (!current || !current.hasMore || current.nextOffset === null || loadingMore) return
    onPageChange?.(current.nextOffset)
  }, [loadingMore, onPageChange])

  const handleLoadMore = useCallback(async (): Promise<void> => {
    const current = graphWindowRef.current
    const cy = cyRef.current
    if (
      !current
      || !cy
      || cy.destroyed()
      || !current.hasMore
      || current.nextOffset === null
      || loadMoreAbortRef.current !== null
      || fileScope !== null
    ) return

    const viewport = { pan: { ...cy.pan() }, zoom: cy.zoom() }
    const controller = new AbortController()
    loadMoreAbortRef.current = controller
    setLoadingMore(true)
    setExpansionError(null)
    try {
      const incoming = await fetchGraphWindow({
        apiUrl,
        mode,
        limit: windowLimit,
        offset: current.nextOffset,
        includeExternals,
        projectId,
        signal: controller.signal,
      })
      const latest = graphWindowRef.current
      const activeCy = cyRef.current
      if (!latest || !activeCy || activeCy.destroyed() || controller.signal.aborted) return

      const existingIds = latest.nodes.map((node) => node.id)
      const existingIdSet = new Set(existingIds)
      const newIds = incoming.nodes
        .map((node) => node.id)
        .filter((id) => !existingIdSet.has(id))
      const inducedEdges = await fetchGraphInducedEdges(
        apiUrl,
        planInducedEdgeRequests(existingIds, newIds),
        controller.signal,
        undefined,
        projectId,
      )
      if (controller.signal.aborted || activeCy.destroyed()) return

      const bounds = activeCy.nodes().boundingBox({ includeLabels: false, includeOverlays: false })
      const plan = planGraphPageAppend(latest, incoming, inducedEdges, bounds)
      applyCanvasExpansion(activeCy, plan, viewport)
      graphWindowRef.current = plan.window
      setGraphWindow(plan.window)
      setCanvasNodes(plan.window.nodes)
      setNodeCount(plan.window.nodes.length)
      setEdgeCount(plan.window.edges.length)
      setRenderRevision((revision) => revision + 1)
      setLiveAnnouncement(
        `${plan.newNodes.length.toLocaleString()} nodes loaded.${plan.window.hasMore ? '' : ' All nodes loaded.'}`,
      )
    } catch (error) {
      if (controller.signal.aborted) return
      console.error('Failed to load the next graph page', error)
      setExpansionError(error instanceof Error ? error.message : 'Failed to load the next graph page')
    } finally {
      if (loadMoreAbortRef.current === controller) {
        loadMoreAbortRef.current = null
        setLoadingMore(false)
      }
    }
  }, [apiUrl, fileScope, includeExternals, mode, projectId, windowLimit])

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
      {expansionError && !error && (
        <div role="alert" className="absolute bottom-4 right-4 z-20 max-w-sm rounded-lg border border-red-400/60 bg-card px-3 py-2 text-xs text-foreground">
          {expansionError}
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
            <div key={node.id} className="flex items-center gap-1 rounded hover:bg-accent/40">
              <button
                type="button"
                className="min-w-0 flex-1 truncate rounded px-2 py-1.5 text-left text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => handleNodeListSelect(node)}
              >
                {node.label}
                <span className="ml-1 text-subtle">{node.type}</span>
                {typeof node.properties.symbolCount === 'number' && (
                  <span className="ml-1 text-subtle">{node.properties.symbolCount} symbols</span>
                )}
              </button>
              <button
                type="button"
                aria-label={`Expand ${node.label}`}
                title={`Expand ${node.label}`}
                disabled={expandingNodeId !== null}
                onClick={() => void expandNode(node)}
                className="text-subtle mr-1 rounded px-1.5 py-1 text-[10px] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
              >
                Expand
              </button>
            </div>
          ))}
        </div>
      </details>
      <GraphControls
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onFit={handleFit}
        onReset={handleReset}
        onRelayout={handleRelayout}
        nodeCount={nodeCount}
        edgeCount={edgeCount}
        totalNodes={graphWindow?.totalNodes ?? nodeCount}
        totalEdges={graphWindow?.totalEdges ?? edgeCount}
        windowLimit={windowLimit}
        onWindowLimitChange={onWindowLimitChange}
        mode={mode}
        onModeChange={onModeChange}
        includeExternals={includeExternals}
        onIncludeExternalsChange={onIncludeExternalsChange}
        canReset={graphWindow !== null && baseWindow !== null && (graphWindow !== baseWindow || pageOffset > 0)}
        pageOffset={graphWindow?.offset ?? pageOffset}
        pageReturned={graphWindow?.returned ?? nodeCount}
        hasMore={graphWindow?.hasMore ?? false}
        pagingEnabled={fileScope === null}
        isLoadingMore={loadingMore}
        onPreviousPage={handlePreviousPage}
        onNextPage={handleNextPage}
        onLoadMore={() => { void handleLoadMore() }}
        liveAnnouncement={liveAnnouncement}
        truncation={graphWindow?.truncation}
        windowOrder={graphWindow?.windowOrder}
        layout={layout}
      />
    </div>
  )
}
