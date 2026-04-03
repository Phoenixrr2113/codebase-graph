'use client'

import { useState, useCallback } from 'react'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { GraphCanvas, type GraphNode } from './graph-canvas'
import { GraphLegend } from './graph-legend'
import { SearchPanel } from './search-panel'
import { EntityDetail } from './entity-detail'
import { QueryPanel } from './query-panel'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export function AppShell() {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [highlightedNames, setHighlightedNames] = useState<Set<string>>(new Set())
  const [hiddenEdgeTypes, setHiddenEdgeTypes] = useState<Set<string>>(new Set())
  const [hiddenNodeTypes, setHiddenNodeTypes] = useState<Set<string>>(new Set())
  const [showQuery, setShowQuery] = useState(false)

  const handleNodeSelect = useCallback((node: GraphNode | null) => {
    setSelectedNode(node)
  }, [])

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
          onSelectResult={(name) => setHighlightedNames(new Set([name]))}
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
        <EntityDetail node={selectedNode} />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
