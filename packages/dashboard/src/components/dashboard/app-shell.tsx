import { useState, useCallback, useEffect, useRef } from 'react'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { GraphCanvas, type GraphNode } from './graph-canvas'
import { GraphLegend } from './graph-legend'
import { SearchPanel, type SearchResult, type SearchWorkspace } from './search-panel'
import { EntityDetail } from './entity-detail'
import { QueryPanel, type QueryWorkspaces } from './query-panel'
import { API_URL } from '@/lib/api'
import {
  fetchFileRelationships,
  fetchReferences,
  isReferenceable,
  type SymbolReferences,
} from '@/lib/references'
import type { FileRelationshipsState } from './entity-detail'
import {
  appendGraphExpansion,
  DEFAULT_GRAPH_VIEW,
  fetchGraphNodeDetail,
  persistGraphViewState,
  readGraphViewState,
  resetGraphExpansions,
  type GraphCanvasViewState,
  type GraphViewMode,
  type GraphWindowLimit,
} from '@/lib/graph-window'

export interface SelectionHistoryEntry {
  node: GraphNode | null
  view: GraphCanvasViewState
}

export interface SelectionHistory {
  entries: SelectionHistoryEntry[]
  index: number
}

export const EMPTY_SELECTION_HISTORY: SelectionHistory = { entries: [], index: -1 }

function selectionIdentity(node: GraphNode | null): string | null {
  return node?.id ?? null
}

function currentHistoryNode(history: SelectionHistory): GraphNode | null {
  return history.index >= 0 ? history.entries[history.index]?.node ?? null : null
}

export function pushSelectionHistory(
  history: SelectionHistory,
  node: GraphNode | null,
  view: GraphCanvasViewState,
  options: { force?: boolean } = {},
): SelectionHistory {
  const current = history.index >= 0 ? history.entries[history.index] : undefined
  if (!options.force && current !== undefined && selectionIdentity(current.node) === selectionIdentity(node)) return history

  const entries = [...history.entries.slice(0, history.index + 1), { node, view }]
  return { entries, index: entries.length - 1 }
}

export function moveSelectionHistory(
  history: SelectionHistory,
  offset: -1 | 1,
): SelectionHistory {
  if (history.entries.length === 0) return history
  const index = Math.max(0, Math.min(history.entries.length - 1, history.index + offset))
  return index === history.index ? history : { ...history, index }
}

interface ExplorerBreadcrumb {
  level: 'project' | 'file' | 'symbol'
  label: string
  node: GraphNode | null
}

function basename(filePath: string): string {
  return filePath.split('/').filter(Boolean).at(-1) ?? filePath
}

export function deriveBreadcrumbs(
  projectName: string | undefined,
  selectedNode: GraphNode | null,
): ExplorerBreadcrumb[] {
  const crumbs: ExplorerBreadcrumb[] = []
  if (projectName) crumbs.push({ level: 'project', label: projectName, node: null })
  if (!selectedNode) return crumbs

  const filePath = typeof selectedNode.properties.filePath === 'string'
    ? selectedNode.properties.filePath
    : undefined
  if (filePath) {
    crumbs.push({
      level: 'file',
      label: basename(filePath),
      node: selectedNode.type === 'File'
        ? selectedNode
        : null,
    })
  }
  if (selectedNode.type !== 'File') {
    crumbs.push({ level: 'symbol', label: selectedNode.label, node: selectedNode })
  }
  return crumbs
}

export function searchResultToGraphNode(result: SearchResult): GraphNode {
  if (typeof result.id === 'string' && result.nodeType === 'File' && /^File:.+/.test(result.id)) {
    const filePath = typeof result.filePath === 'string' && result.filePath.length > 0
      ? result.filePath
      : result.id.slice('File:'.length)
    return {
      id: result.id,
      label: result.name,
      type: 'File',
      properties: { ...result, filePath },
    }
  }
  if (typeof result.id !== 'string' || !/^sym:v1:[a-f0-9]{64}$/.test(result.id)) {
    throw new Error('Search result is missing a persisted id')
  }
  return {
    id: result.id,
    label: result.name,
    type: result.nodeType,
    properties: result,
  }
}

export function ExplorerNavigation({
  projectName,
  selectedNode,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onSelect,
}: {
  projectName?: string
  selectedNode: GraphNode | null
  canGoBack: boolean
  canGoForward: boolean
  onBack: () => void
  onForward: () => void
  onSelect: (node: GraphNode | null) => void
}) {
  const breadcrumbs = deriveBreadcrumbs(projectName, selectedNode)

  return (
    <nav aria-label="Explorer navigation" className="flex max-w-[min(70vw,720px)] items-center gap-1 rounded-lg border border-border bg-card/90 p-1 text-xs backdrop-blur-sm">
      <button
        type="button"
        aria-label="Back"
        title="Back (Alt+Left Arrow)"
        disabled={!canGoBack}
        onClick={onBack}
        className="h-7 rounded px-2 text-muted-foreground hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
      >
        ←
      </button>
      <button
        type="button"
        aria-label="Forward"
        title="Forward (Alt+Right Arrow)"
        disabled={!canGoForward}
        onClick={onForward}
        className="h-7 rounded px-2 text-muted-foreground hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
      >
        →
      </button>
      {breadcrumbs.length > 0 && <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />}
      <ol className="flex min-w-0 items-center gap-1 overflow-hidden">
        {breadcrumbs.map((crumb, index) => (
          <li key={`${crumb.level}:${crumb.node?.id ?? crumb.label}`} className="flex min-w-0 items-center gap-1">
            {index > 0 && <span aria-hidden="true" className="text-subtle">/</span>}
            <button
              type="button"
              onClick={() => onSelect(crumb.node)}
              className="max-w-48 truncate rounded px-1.5 py-1 text-muted-foreground hover:bg-accent/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {crumb.label}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}

export function AppShell({
  projectId,
  projectName,
  externalSelection,
  searchWorkspace,
  onSearchWorkspaceChange,
  queryWorkspaces,
  onQueryWorkspacesChange,
}: {
  projectId?: string | null
  projectName?: string
  externalSelection?: GraphNode | null
  searchWorkspace?: SearchWorkspace
  onSearchWorkspaceChange?: (updater: (current: SearchWorkspace) => SearchWorkspace) => void
  queryWorkspaces?: QueryWorkspaces
  onQueryWorkspacesChange?: (updater: (current: QueryWorkspaces) => QueryWorkspaces) => void
}) {
  const [canvasView, setCanvasView] = useState<GraphCanvasViewState>(() => {
    if (typeof window === 'undefined') {
      return { ...DEFAULT_GRAPH_VIEW, fileScope: null, expansions: [] }
    }
    try {
      return {
        ...readGraphViewState(window.location, window.localStorage),
        fileScope: null,
        expansions: [],
      }
    } catch (error) {
      console.warn('Unable to read the saved graph view', error)
      return { ...DEFAULT_GRAPH_VIEW, fileScope: null, expansions: [] }
    }
  })
  const [expansionRequest, setExpansionRequest] = useState<{ node: GraphNode; sequence: number } | null>(null)
  const [selectionHistory, setSelectionHistory] = useState<SelectionHistory>(EMPTY_SELECTION_HISTORY)
  const canvasViewRef = useRef(canvasView)
  canvasViewRef.current = canvasView
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<Set<string>>(new Set())
  const [hiddenEdgeTypes, setHiddenEdgeTypes] = useState<Set<string>>(new Set())
  const [hiddenNodeTypes, setHiddenNodeTypes] = useState<Set<string>>(new Set())
  const [showQuery, setShowQuery] = useState(false)
  const [references, setReferences] = useState<SymbolReferences | null>(null)
  const [detailedSelectedNode, setDetailedSelectedNode] = useState<GraphNode | null>(null)
  const [referencesLoading, setReferencesLoading] = useState(false)
  const [fileRelationshipsState, setFileRelationshipsState] = useState<FileRelationshipsState>({ status: 'idle' })

  const selectedNode = selectionHistory.index >= 0
    ? selectionHistory.entries[selectionHistory.index]?.node ?? null
    : null

  useEffect(() => {
    try {
      persistGraphViewState(canvasView, window.location, window.history, window.localStorage)
    } catch (error) {
      console.warn('Unable to persist the graph view', error)
    }
  }, [canvasView])

  const handleNodeSelect = useCallback((node: GraphNode | null) => {
    setSelectionHistory((history) => pushSelectionHistory(history, node, canvasViewRef.current))
  }, [])

  useEffect(() => {
    if (externalSelection) handleNodeSelect(externalSelection)
  }, [externalSelection, handleNodeSelect])

  useEffect(() => {
    setDetailedSelectedNode(selectedNode)
    if (!selectedNode || typeof selectedNode.properties.filePath !== 'string') return

    const controller = new AbortController()
    fetchGraphNodeDetail(API_URL, selectedNode, controller.signal)
      .then((detail) => setDetailedSelectedNode(detail))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        console.error('Failed to load graph node detail', error)
        setDetailedSelectedNode(selectedNode)
      })

    return () => controller.abort()
  }, [selectedNode])

  const handleBack = useCallback(() => {
    const moved = moveSelectionHistory(selectionHistory, -1)
    const entry = moved.entries[moved.index]
    if (moved === selectionHistory || !entry) return
    setSelectionHistory(moved)
    setCanvasView(entry.view)
  }, [selectionHistory])

  const handleForward = useCallback(() => {
    const moved = moveSelectionHistory(selectionHistory, 1)
    const entry = moved.entries[moved.index]
    if (moved === selectionHistory || !entry) return
    setSelectionHistory(moved)
    setCanvasView(entry.view)
  }, [selectionHistory])

  const recordCanvasView = useCallback((view: GraphCanvasViewState, node?: GraphNode | null) => {
    setCanvasView(view)
    setSelectionHistory((history) => pushSelectionHistory(
      history,
      node === undefined ? currentHistoryNode(history) : node,
      view,
      { force: true },
    ))
  }, [])

  const handleModeChange = useCallback((mode: GraphViewMode) => {
    recordCanvasView({ ...canvasView, mode, fileScope: null, expansions: [] })
  }, [canvasView, recordCanvasView])

  const handleWindowLimitChange = useCallback((limit: GraphWindowLimit) => {
    recordCanvasView({ ...canvasView, limit })
  }, [canvasView, recordCanvasView])

  const handleOpenSymbols = useCallback((node: GraphNode) => {
    recordCanvasView({
      ...canvasView,
      mode: 'symbols',
      fileScope: node,
      expansions: [],
    }, node)
  }, [canvasView, recordCanvasView])

  const handleExpandRequest = useCallback((node: GraphNode) => {
    setExpansionRequest((current) => ({ node, sequence: (current?.sequence ?? 0) + 1 }))
  }, [])

  const handleExpanded = useCallback((node: GraphNode) => {
    recordCanvasView(appendGraphExpansion(canvasViewRef.current, node), node)
  }, [recordCanvasView])

  const handleResetView = useCallback(() => {
    recordCanvasView(resetGraphExpansions(canvasViewRef.current))
  }, [recordCanvasView])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        handleBack()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        handleForward()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleBack, handleForward])

  // One lookup serves both surfaces: the panel lists every reference, the canvas
  // highlights the ones it happens to have loaded.
  useEffect(() => {
    const name = selectedNode?.label
    if (!selectedNode || !name || !isReferenceable(selectedNode.type)) {
      setReferences(null)
      setReferencesLoading(false)
      return
    }

    const controller = new AbortController()
    setReferencesLoading(true)
    fetchReferences(
      selectedNode.id,
      controller.signal,
    )
      .then((result) => {
        setReferences(result)
        setReferencesLoading(false)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        console.error('Failed to load references', error)
        setReferences(null)
        setReferencesLoading(false)
      })

    return () => controller.abort()
  }, [selectedNode])

  useEffect(() => {
    const filePath = selectedNode?.type === 'File'
      && typeof selectedNode.properties.filePath === 'string'
      ? selectedNode.properties.filePath
      : undefined
    if (!filePath) {
      setFileRelationshipsState({ status: 'idle' })
      return
    }

    const controller = new AbortController()
    setFileRelationshipsState({ status: 'loading' })
    fetchFileRelationships(filePath, controller.signal)
      .then((data) => setFileRelationshipsState({ status: 'success', data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        console.error('Failed to load file relationships', error)
        setFileRelationshipsState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Failed to load file relationships',
        })
      })

    return () => controller.abort()
  }, [selectedNode])

  const referenceNodeIds = new Set(
    (references?.references ?? []).map((reference) => reference.id),
  )

  const handleSearchHighlight = useCallback((nodeIds: string[]) => {
    setHighlightedNodeIds(new Set(nodeIds.filter((id) => id.startsWith('sym:v1:'))))
  }, [])

  const handleToggleEdgeType = useCallback((edgeType: string) => {
    setHiddenEdgeTypes(prev => {
      const next = new Set(prev)
      if (next.has(edgeType)) next.delete(edgeType)
      else next.add(edgeType)
      return next
    })
  }, [])

  const handleToggleNodeType = useCallback((nodeType: string) => {
    setHiddenNodeTypes(prev => {
      const next = new Set(prev)
      if (next.has(nodeType)) next.delete(nodeType)
      else next.add(nodeType)
      return next
    })
  }, [])

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full min-h-0">
      {/* Left: Search Panel */}
      <ResizablePanel defaultSize={18} minSize={12} maxSize={30}>
        <SearchPanel
          apiUrl={API_URL}
          onHighlight={handleSearchHighlight}
          onSelectResult={(result) => {
            const node = searchResultToGraphNode(result)
            setHighlightedNodeIds(new Set([node.id]))
            // Open the detail panel too. The search payload already carries
            // filePath and line numbers, which is everything the panel needs.
            handleNodeSelect(node)
          }}
          workspace={searchWorkspace}
          onWorkspaceChange={onSearchWorkspaceChange}
        />
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* Center: Graph + optional Query Panel */}
      <ResizablePanel defaultSize={57}>
        <ResizablePanelGroup direction="vertical">
          <ResizablePanel defaultSize={showQuery ? 65 : 100} minSize={30}>
            <div style={{ position: 'relative', width: '100%', height: '100%' }}>
              <GraphCanvas
                apiUrl={API_URL}
                onNodeSelect={handleNodeSelect}
                selectedNode={selectedNode}
                highlightedNodeIds={highlightedNodeIds}
                hiddenEdgeTypes={hiddenEdgeTypes}
                hiddenNodeTypes={hiddenNodeTypes}
                projectId={projectId}
                referenceNodeIds={referenceNodeIds}
                mode={canvasView.mode}
                windowLimit={canvasView.limit}
                fileScope={canvasView.fileScope}
                restoredExpansions={canvasView.expansions}
                onModeChange={handleModeChange}
                onWindowLimitChange={handleWindowLimitChange}
                expansionRequest={expansionRequest}
                onExpanded={handleExpanded}
                onResetView={handleResetView}
              />
              {/* Toolbar: Query toggle + Legend */}
              <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'start', gap: 8 }}>
                <ExplorerNavigation
                  projectName={projectName}
                  selectedNode={selectedNode}
                  canGoBack={selectionHistory.index > 0}
                  canGoForward={selectionHistory.index >= 0 && selectionHistory.index < selectionHistory.entries.length - 1}
                  onBack={handleBack}
                  onForward={handleForward}
                  onSelect={handleNodeSelect}
                />
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => setShowQuery(!showQuery)}
                    aria-expanded={showQuery}
                    aria-controls="query-panel"
                    className={`rounded-lg border border-border px-3 py-1.5 text-xs font-medium backdrop-blur-sm transition-colors ${
                      showQuery ? 'bg-primary/20 text-primary border-primary/40' : 'bg-card/90 text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Query
                  </button>
                  <GraphLegend
                    hiddenEdgeTypes={hiddenEdgeTypes}
                    onToggleEdgeType={handleToggleEdgeType}
                    hiddenNodeTypes={hiddenNodeTypes}
                    onToggleNodeType={handleToggleNodeType}
                  />
                </div>
              </div>
            </div>
          </ResizablePanel>

          {showQuery && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={35} minSize={20} maxSize={60}>
                <div id="query-panel" className="h-full">
                  <QueryPanel
                    apiUrl={API_URL}
                    workspaces={queryWorkspaces}
                    onWorkspacesChange={onQueryWorkspacesChange}
                  />
                </div>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* Right: Detail Panel */}
      <ResizablePanel defaultSize={25} minSize={15} maxSize={35}>
        <EntityDetail
          node={detailedSelectedNode}
          references={references}
          referencesLoading={referencesLoading}
          onSelectReference={handleNodeSelect}
          fileRelationshipsState={fileRelationshipsState}
          onOpenSymbols={handleOpenSymbols}
          onExpand={handleExpandRequest}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
