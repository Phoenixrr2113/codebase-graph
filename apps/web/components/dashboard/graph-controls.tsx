'use client'

import { Button } from '@/components/ui/button'

interface GraphControlsProps {
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  onRelayout: () => void
  nodeCount: number
}

export function GraphControls({ onZoomIn, onZoomOut, onFit, onRelayout, nodeCount }: GraphControlsProps) {
  return (
    <div className="graph-controls absolute bottom-4 right-4 z-10 flex items-center gap-1 rounded-lg border border-border bg-card/90 p-1 backdrop-blur-sm" data-testid="graph-controls">
      <Button variant="ghost" size="sm" onClick={onZoomIn} data-testid="zoom-in" aria-label="Zoom in" className="h-7 w-7 p-0 text-xs">
        +
      </Button>
      <Button variant="ghost" size="sm" onClick={onZoomOut} data-testid="zoom-out" aria-label="Zoom out" className="h-7 w-7 p-0 text-xs">
        -
      </Button>
      <Button variant="ghost" size="sm" onClick={onFit} aria-label="Fit to screen" className="h-7 px-2 text-xs">
        Fit
      </Button>
      <Button variant="ghost" size="sm" onClick={onRelayout} aria-label="Re-layout" className="h-7 px-2 text-xs">
        Layout
      </Button>
      {nodeCount > 0 && (
        <span className="px-2 text-xs text-muted-foreground">{nodeCount} nodes</span>
      )}
    </div>
  )
}
