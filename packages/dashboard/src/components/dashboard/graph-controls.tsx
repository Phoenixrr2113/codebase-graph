import { Button } from '@/components/ui/button'
import type { LayoutName } from '@/lib/cytoscape-config'

interface GraphControlsProps {
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  onRelayout: (layout?: LayoutName) => void
  nodeCount: number
  layout: LayoutName
}

const LAYOUTS: { value: LayoutName; label: string }[] = [
  { value: 'cose', label: 'Force' },
  { value: 'breadthfirst', label: 'Tree' },
  { value: 'concentric', label: 'Ring' },
]

export function GraphControls({ onZoomIn, onZoomOut, onFit, onRelayout, nodeCount, layout }: GraphControlsProps) {
  return (
    <div className="graph-controls flex items-center gap-1 rounded-lg border border-border bg-card/90 p-1 backdrop-blur-sm" style={{ position: 'absolute', top: 16, right: 16, zIndex: 10 }} data-testid="graph-controls">
      <Button variant="ghost" size="sm" onClick={onZoomIn} data-testid="zoom-in" aria-label="Zoom in" className="h-7 w-7 p-0 text-xs">
        +
      </Button>
      <Button variant="ghost" size="sm" onClick={onZoomOut} data-testid="zoom-out" aria-label="Zoom out" className="h-7 w-7 p-0 text-xs">
        -
      </Button>
      <Button variant="ghost" size="sm" onClick={onFit} aria-label="Fit to screen" className="h-7 px-2 text-xs">
        Fit
      </Button>
      <div className="mx-1 h-4 w-px bg-border" />
      {LAYOUTS.map((l) => (
        <Button
          key={l.value}
          variant={layout === l.value ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => onRelayout(l.value)}
          className="h-7 px-2 text-xs"
        >
          {l.label}
        </Button>
      ))}
      {nodeCount > 0 && (
        <>
          <div className="mx-1 h-4 w-px bg-border" />
          <span className="px-1 text-xs text-muted-foreground">{nodeCount}</span>
        </>
      )}
    </div>
  )
}
