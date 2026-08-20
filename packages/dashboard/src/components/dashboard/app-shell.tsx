import { useState, useCallback, useEffect } from 'react'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { GraphCanvas, type GraphNode } from './graph-canvas'
import { GraphLegend } from './graph-legend'
import { SearchPanel } from './search-panel'
import { EntityDetail } from './entity-detail'
import { QueryPanel } from './query-panel'
import { API_URL } from '@/lib/api'
import {
  fetchReferences,
  isReferenceable,
  referenceKey,
  type SymbolReferences,
} from '@/lib/references'


export function AppShell({ projectId }: { projectId?: string | null }) {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [highlightedNames, setHighlightedNames] = useState<Set<string>>(new Set())
  const [hiddenEdgeTypes, setHiddenEdgeTypes] = useState<Set<string>>(new Set())
  const [hiddenNodeTypes, setHiddenNodeTypes] = useState<Set<string>>(new Set())
  const [showQuery, setShowQuery] = useState(false)
  const [references, setReferences] = useState<SymbolReferences | null>(null)
  const [referencesLoading, setReferencesLoading] = useState(false)

  const handleNodeSelect = useCallback((node: GraphNode | null) => {
    setSelectedNode(node)
  }, [])

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
      name,
      selectedNode.properties?.filePath as string | undefined,
      selectedNode.properties?.startLine as number | undefined,
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

  const referenceKeys = new Set(
    (references?.references ?? []).map((r) => referenceKey(r.filePath, r.name)),
  )

  const handleSearchHighlight = useCallback((names: string[]) => {
    setHighlightedNames(new Set(names))
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
            setHighlightedNames(new Set([result.name]))
            // Open the detail panel too. The search payload already carries
            // filePath and line numbers, which is everything the panel needs.
            setSelectedNode({
              id: `${result.nodeType}:${result.filePath ?? ''}:${result.name}`,
              label: result.name,
              type: result.nodeType,
              properties: result,
            })
          }}
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
                highlightedNames={highlightedNames}
                hiddenEdgeTypes={hiddenEdgeTypes}
                hiddenNodeTypes={hiddenNodeTypes}
                projectId={projectId}
                referenceKeys={referenceKeys}
              />
              {/* Toolbar: Query toggle + Legend */}
              <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 10, display: 'flex', alignItems: 'start', gap: 8 }}>
                <button
                  onClick={() => setShowQuery(!showQuery)}
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
          </ResizablePanel>

          {showQuery && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={35} minSize={20} maxSize={60}>
                <QueryPanel apiUrl={API_URL} />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* Right: Detail Panel */}
      <ResizablePanel defaultSize={25} minSize={15} maxSize={35}>
        <EntityDetail
          node={selectedNode}
          references={references}
          referencesLoading={referencesLoading}
          onSelectReference={handleNodeSelect}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
