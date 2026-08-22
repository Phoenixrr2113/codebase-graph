import { useEffect, useId, useState } from 'react'
import {
  analysisSymbolToGraphNode,
  fetchBlastRadius,
  isAbortError,
  type BlastRadiusResult,
  type LoadState,
} from '@/lib/analysis'
import type { GraphNode } from './graph-canvas'

interface ImpactSectionProps {
  symbolId: string
  onSelect?: (node: GraphNode) => void
}

export function ImpactSection({ symbolId, onSelect }: ImpactSectionProps) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<LoadState<BlastRadiusResult>>({ status: 'idle' })
  const [generation, setGeneration] = useState(0)
  const contentId = useId()

  useEffect(() => {
    setOpen(false)
    setState({ status: 'idle' })
  }, [symbolId])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setState({ status: 'loading' })
    fetchBlastRadius(symbolId, controller.signal)
      .then((data) => setState({ status: 'success', data }))
      .catch((error: unknown) => {
        if (controller.signal.aborted || isAbortError(error)) return
        setState({ status: 'error', message: 'Impact could not be loaded. Try again.' })
      })
    return () => controller.abort()
  }, [generation, open, symbolId])

  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between rounded py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="text-[11px] font-medium uppercase tracking-wider text-subtle">Impact</span>
        <Chevron open={open} />
      </button>
      {open && (
        <div id={contentId} className="mt-2">
          <ImpactContent state={state} onSelect={onSelect} />
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
    </section>
  )
}

export function ImpactContent({ state, onSelect }: { state: LoadState<BlastRadiusResult>; onSelect?: (node: GraphNode) => void }) {
  if (state.status === 'idle' || state.status === 'loading') {
    return <p role="status" aria-live="polite" className="text-xs text-subtle">Loading impact...</p>
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
  if (data.items.length === 0) {
    return (
      <div className="space-y-2">
        <p className="rounded-lg border border-dashed border-border p-3 text-center text-xs text-subtle">No static dependents found.</p>
        <Caveats values={data.caveats} />
      </div>
    )
  }

  const groups = new Map<number, typeof data.items>()
  for (const item of data.items) {
    groups.set(item.depth, [...(groups.get(item.depth) ?? []), item])
  }
  return (
    <div className="space-y-3">
      {[...groups.entries()].sort(([left], [right]) => left - right).map(([depth, items]) => (
        <div key={depth}>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-subtle">Depth {depth} · {items.length}</p>
          <ul className="divide-y divide-border rounded-lg border border-border bg-background/40">
            {items.map((item) => (
              <li key={item.id} className="p-1">
                <button
                  type="button"
                  data-node-id={item.id}
                  onClick={() => onSelect?.(analysisSymbolToGraphNode(item))}
                  className="w-full rounded px-2 py-1.5 text-left hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-xs font-medium">{item.name}</span>
                    <span className="shrink-0 text-[10px] text-subtle">{item.nodeType}</span>
                  </span>
                  <span className="block truncate font-mono text-[10px] text-subtle">{shortPath(item.filePath)}{item.startLine === undefined ? '' : `:${item.startLine}`}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {data.truncated && <p role="status" className="text-xs font-medium text-amber-300">Results truncated.</p>}
      <Caveats values={data.caveats} />
    </div>
  )
}

export function Caveats({ values }: { values: string[] }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-2">
      <p className="text-[10px] font-medium uppercase tracking-wider text-subtle">Caveats</p>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-subtle">
        {values.map((value, index) => <li key={`${index}:${value}`}>{value}</li>)}
      </ul>
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
