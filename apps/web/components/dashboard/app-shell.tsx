'use client'

import { useState, useCallback } from 'react'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { GraphCanvas, type GraphNode } from './graph-canvas'
import { SearchPanel } from './search-panel'
import { EntityDetail } from './entity-detail'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export function AppShell() {
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [highlightedNames, setHighlightedNames] = useState<Set<string>>(new Set())

  const handleNodeSelect = useCallback((node: GraphNode | null) => {
    setSelectedNode(node)
  }, [])

  const handleSearchHighlight = useCallback((names: string[]) => {
    setHighlightedNames(new Set(names))
  }, [])

  return (
    <ResizablePanelGroup direction="horizontal" className="h-full">
      {/* Left: Search Panel */}
      <ResizablePanel defaultSize={20} minSize={15} maxSize={35}>
        <SearchPanel
          apiUrl={API_URL}
          onHighlight={handleSearchHighlight}
          onSelectResult={(name) => {
            setHighlightedNames(new Set([name]))
          }}
        />
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* Center: Graph */}
      <ResizablePanel defaultSize={55}>
        <GraphCanvas
          apiUrl={API_URL}
          onNodeSelect={handleNodeSelect}
          highlightedNames={highlightedNames}
        />
      </ResizablePanel>

      <ResizableHandle withHandle />

      {/* Right: Detail Panel */}
      <ResizablePanel defaultSize={25} minSize={15} maxSize={40}>
        <EntityDetail node={selectedNode} />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
