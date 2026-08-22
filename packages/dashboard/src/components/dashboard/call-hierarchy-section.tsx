import { useEffect, useId, useState } from 'react'
import {
  analysisSymbolToGraphNode,
  fetchCallHierarchy,
  isAbortError,
  type CallHierarchyResult,
  type LoadState,
} from '@/lib/analysis'
import type { GraphNode } from './graph-canvas'
import { Caveats } from './impact-section'

type Direction = 'callers' | 'callees'

interface CallHierarchySectionProps {
  symbolId: string
  onSelect?: (node: GraphNode) => void
}

export function fetchCallBranch(
  symbolId: string,
  direction: Direction,
  signal?: AbortSignal,
  fetchImpl?: typeof fetch,
): Promise<CallHierarchyResult> {
  return fetchCallHierarchy(symbolId, direction, signal, fetchImpl)
}

export function CallHierarchySection({ symbolId, onSelect }: CallHierarchySectionProps) {
  const [open, setOpen] = useState(false)
  const contentId = useId()

  useEffect(() => setOpen(false), [symbolId])

  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between rounded py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="text-[11px] font-medium uppercase tracking-wider text-subtle">Calls</span>
        <Chevron open={open} />
      </button>
      {open && (
        <div id={contentId} className="mt-2 space-y-2">
          <CallBranch symbolId={symbolId} direction="callers" onSelect={onSelect} />
          <CallBranch symbolId={symbolId} direction="callees" onSelect={onSelect} />
        </div>
      )}
    </section>
  )
}

function CallBranch({ symbolId, direction, onSelect }: { symbolId: string; direction: Direction; onSelect?: (node: GraphNode) => void }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<LoadState<CallHierarchyResult>>({ status: 'idle' })
  const [generation, setGeneration] = useState(0)
  const contentId = useId()
  const label = direction === 'callers' ? 'Callers' : 'Callees'

  useEffect(() => {
    setOpen(false)
    setState({ status: 'idle' })
  }, [symbolId])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setState({ status: 'loading' })
    fetchCallBranch(symbolId, direction, controller.signal)
      .then((data) => setState({ status: 'success', data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return
        setState({ status: 'error', message: `${label} could not be loaded. Try again.` })
      })
    return () => controller.abort()
  }, [direction, generation, label, open, symbolId])

  return (
    <div className="rounded-lg border border-border bg-background/30">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {label}
        <Chevron open={open} />
      </button>
      {open && (
        <div id={contentId} className="border-t border-border p-2">
          <CallBranchContent direction={direction} state={state} onSelect={onSelect} />
          {state.status === 'error' && (
            <button
              type="button"
              onClick={() => setGeneration((value) => value + 1)}
              className="mt-2 rounded-md border border-border px-2 py-1 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function CallBranchContent({
  direction,
  state,
  onSelect,
}: {
  direction: Direction
  state: LoadState<CallHierarchyResult>
  onSelect?: (node: GraphNode) => void
}) {
  const label = direction === 'callers' ? 'callers' : 'callees'
  if (state.status === 'idle' || state.status === 'loading') {
    return <p role="status" aria-live="polite" className="text-xs text-subtle">Loading {label}...</p>
  }
  if (state.status === 'error') return <p role="alert" className="text-xs text-red-300">{state.message}</p>

  const { data } = state
  if (data.status === 'not_found') {
    return (
      <div className="space-y-2">
        <p className="text-xs text-subtle">This persisted symbol was not found.</p>
        <Caveats values={data.caveats} />
      </div>
    )
  }
  const items = direction === 'callers' ? data.callers : data.callees
  return (
    <div className="space-y-2">
      {items.length === 0 ? (
        <p className="rounded border border-dashed border-border p-3 text-center text-xs text-subtle">No static {label} found.</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((item) => (
            <li key={item.id} className="py-1">
              <button
                type="button"
                data-node-id={item.id}
                onClick={() => onSelect?.(analysisSymbolToGraphNode(item))}
                className="w-full rounded px-1.5 py-1 text-left hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{item.name}</span>
                    <span className="block truncate font-mono text-[10px] text-subtle">
                      {shortPath(item.filePath)}{item.callLine === undefined ? '' : `:${item.callLine}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[10px] text-subtle">
                    <span className="block">{item.nodeType}</span>
                    <span className="block">{item.via}{item.count > 1 ? ` · ${item.count} calls` : ''}</span>
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {(direction === 'callers' ? data.callersTruncated : data.calleesTruncated) && (
        <p role="status" className="text-xs font-medium text-amber-300">Results truncated.</p>
      )}
      <Caveats values={data.caveats} />
    </div>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg aria-hidden="true" className={`h-3.5 w-3.5 text-subtle transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

function shortPath(filePath: string): string {
  return filePath.split('/').filter(Boolean).slice(-3).join('/') || filePath
}
