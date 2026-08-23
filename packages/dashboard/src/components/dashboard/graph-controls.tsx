import { Button } from '@/components/ui/button'
import type { LayoutName } from '@/lib/cytoscape-config'
import type { GraphTruncation, GraphViewMode, GraphWindowLimit } from '@/lib/graph-window'

interface GraphControlsProps {
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  onRelayout: (layout?: LayoutName) => void
  onReset?: () => void
  nodeCount: number
  edgeCount?: number
  totalNodes?: number
  totalEdges?: number
  windowLimit?: GraphWindowLimit
  onWindowLimitChange?: (limit: GraphWindowLimit) => void
  mode?: GraphViewMode
  onModeChange?: (mode: GraphViewMode) => void
  canReset?: boolean
  pageOffset?: number
  pageReturned?: number
  hasMore?: boolean
  pagingEnabled?: boolean
  isLoadingMore?: boolean
  onPreviousPage?: () => void
  onNextPage?: () => void
  onLoadMore?: () => void
  liveAnnouncement?: string
  truncation?: GraphTruncation
  windowOrder?: string
  layout: LayoutName
}

const LAYOUTS: { value: LayoutName; label: string }[] = [
  { value: 'cose', label: 'Force' },
  { value: 'breadthfirst', label: 'Tree' },
  { value: 'concentric', label: 'Ring' },
]

export function GraphControls({
  onZoomIn,
  onZoomOut,
  onFit,
  onRelayout,
  onReset,
  nodeCount,
  edgeCount = 0,
  totalNodes = nodeCount,
  totalEdges = edgeCount,
  windowLimit = 300,
  onWindowLimitChange,
  mode = 'symbols',
  onModeChange,
  canReset = false,
  pageOffset = 0,
  pageReturned = nodeCount,
  hasMore = false,
  pagingEnabled = true,
  isLoadingMore = false,
  onPreviousPage,
  onNextPage,
  onLoadMore,
  liveAnnouncement = '',
  truncation = { incoming: false, outgoing: false },
  windowOrder = 'degree-desc,id-asc',
  layout,
}: GraphControlsProps) {
  const edgeCountLabel = windowOrder === 'file-contained' && truncation.window
    ? `${edgeCount.toLocaleString()} loaded edge${edgeCount === 1 ? '' : 's'}`
    : `${edgeCount.toLocaleString()} of ${totalEdges.toLocaleString()} edges`
  const rangeStart = pageReturned === 0 ? 0 : pageOffset + 1
  const rangeEnd = pageOffset + pageReturned
  const countLabel = `nodes ${rangeStart.toLocaleString()} to ${rangeEnd.toLocaleString()} of ${totalNodes.toLocaleString()}, ${edgeCountLabel}`
  const orderLabel = windowOrder.startsWith('degree-desc')
    ? 'Most connected first'
    : 'Selected file symbols'

  return (
    <div className="graph-controls flex max-w-[min(92vw,680px)] flex-col items-end gap-1 rounded-lg border border-border bg-card/95 p-1.5 backdrop-blur-sm" style={{ position: 'absolute', top: 16, right: 16, zIndex: 10 }} data-testid="graph-controls">
      <div className="flex flex-wrap items-center justify-end gap-1">
        <div aria-label="Graph level of detail" role="group" className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
          {(['files', 'symbols'] as const).map((value) => (
            <Button
              key={value}
              variant={mode === value ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => onModeChange?.(value)}
              aria-pressed={mode === value}
              className="h-7 px-2 text-xs capitalize"
            >
              {value}
            </Button>
          ))}
        </div>
        <label className="text-subtle flex h-8 items-center gap-1 rounded-md border border-border px-2 text-xs">
          Window
          <select
            aria-label="Graph window size"
            value={windowLimit}
            onChange={(event) => onWindowLimitChange?.(Number(event.target.value) as GraphWindowLimit)}
            className="bg-card text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value={300}>300</option>
            <option value={500}>500</option>
            <option value={1000}>1,000</option>
          </select>
        </label>
        <Button variant="ghost" size="sm" onClick={onZoomIn} data-testid="zoom-in" aria-label="Zoom in" className="h-7 w-7 p-0 text-xs">
          +
        </Button>
        <Button variant="ghost" size="sm" onClick={onZoomOut} data-testid="zoom-out" aria-label="Zoom out" className="h-7 w-7 p-0 text-xs">
          -
        </Button>
        <Button variant="ghost" size="sm" onClick={onFit} aria-label="Fit to screen" className="h-7 px-2 text-xs">
          Fit
        </Button>
        {LAYOUTS.map((item) => (
          <Button
            key={item.value}
            variant={layout === item.value ? 'secondary' : 'ghost'}
            size="sm"
            onClick={() => onRelayout(item.value)}
            aria-pressed={layout === item.value}
            aria-label={`Use ${item.label} layout`}
            className="h-7 px-2 text-xs"
          >
            {item.label}
          </Button>
        ))}
        <Button
          variant="ghost"
          size="sm"
          onClick={onReset}
          disabled={!canReset}
          className="h-7 px-2 text-xs"
        >
          Reset view
        </Button>
        <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-border" />
        <Button
          variant="ghost"
          size="sm"
          onClick={onPreviousPage}
          disabled={!pagingEnabled || pageOffset === 0 || isLoadingMore}
          aria-label="Previous graph page"
          className="h-7 px-2 text-xs"
        >
          Previous
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onNextPage}
          disabled={!pagingEnabled || !hasMore || isLoadingMore}
          aria-label="Next graph page"
          className="h-7 px-2 text-xs"
        >
          Next
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onLoadMore}
          disabled={!pagingEnabled || !hasMore || isLoadingMore}
          aria-label={`Load next ${windowLimit.toLocaleString()} graph nodes`}
          className="h-7 px-2 text-xs"
        >
          {isLoadingMore ? 'Loading...' : `Load next ${windowLimit.toLocaleString()}`}
        </Button>
      </div>
      <div className="text-subtle flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 px-1 text-[11px]">
        <span aria-live="polite" aria-atomic="true">{countLabel}</span>
        {!hasMore && pageReturned > 0 && <span className="font-medium text-subtle">All nodes loaded</span>}
        <span>{orderLabel}</span>
        {truncation.window && (
          <span role="status" className="font-medium text-amber-300">
            Results truncated. {windowLimit < 1000
              ? 'Increase the window to load more.'
              : 'Maximum window reached; the total is larger than the loaded window.'}
          </span>
        )}
        {truncation.incoming && <span className="font-medium">Incoming neighbors capped</span>}
        {truncation.outgoing && <span className="font-medium">Outgoing neighbors capped</span>}
      </div>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {liveAnnouncement}
      </span>
    </div>
  )
}
