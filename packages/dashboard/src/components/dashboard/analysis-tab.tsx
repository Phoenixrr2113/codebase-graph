import { useEffect, useId, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  analysisFileToGraphNode,
  analysisSymbolToGraphNode,
  fetchChangeCoupling,
  fetchHotspots,
  fetchImportCycles,
  fetchUnreferencedExports,
  isAbortError,
  type AnalysisResponses,
  type ChangeCouplingResult,
  type HistoryCoverage,
  type HotspotsResult,
  type ImportCyclesResult,
  type LoadState,
  type UnreferencedExportsResult,
} from '@/lib/analysis'
import type { GraphNode } from './graph-canvas'

type AnalysisKind = 'cycles' | 'unreferenced' | 'hotspots' | 'coupling'

interface AnalysisTabProps {
  projectId: string | null
  onSelect: (node: GraphNode) => void
}

type AnalysisPanelProps =
  | { kind: 'cycles'; state: LoadState<ImportCyclesResult>; onSelect: (node: GraphNode) => void }
  | { kind: 'unreferenced'; state: LoadState<UnreferencedExportsResult>; onSelect: (node: GraphNode) => void }
  | { kind: 'hotspots'; state: LoadState<HotspotsResult>; onSelect: (node: GraphNode) => void }
  | { kind: 'coupling'; state: LoadState<ChangeCouplingResult>; onSelect: (node: GraphNode) => void }

const CARD_COPY: Record<AnalysisKind, { title: string; description: string }> = {
  cycles: {
    title: 'Import cycles',
    description: 'Resolved file imports that form a closed dependency path.',
  },
  unreferenced: {
    title: 'Unreferenced exports',
    description: 'Exported symbols without known inbound static references.',
  },
  hotspots: {
    title: 'Hotspots',
    description: 'Frequently changed files ranked with current structural pressure.',
  },
  coupling: {
    title: 'Change coupling',
    description: 'File pairs that change together within indexed history.',
  },
}

export async function createAnalysisRequests(
  projectId: string,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<AnalysisResponses> {
  const [cycles, unreferenced, hotspots, coupling] = await Promise.all([
    fetchImportCycles(projectId, signal, fetchImpl),
    fetchUnreferencedExports(projectId, signal, fetchImpl),
    fetchHotspots(projectId, signal, fetchImpl),
    fetchChangeCoupling(projectId, signal, fetchImpl),
  ])
  return { cycles, unreferenced, hotspots, coupling }
}

function useAnalysisCard<T>(
  projectId: string | null,
  load: (projectId: string, signal: AbortSignal) => Promise<T>,
): { state: LoadState<T>; retry: () => void } {
  const [state, setState] = useState<LoadState<T>>({ status: 'idle' })
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    if (!projectId) {
      setState({ status: 'idle' })
      return
    }

    setState({ status: 'loading' })
    return startAnalysisCardRequest(
      projectId,
      load,
      (data) => setState({ status: 'success', data }),
      () => setState({ status: 'error', message: 'Analysis could not be loaded. Try again.' }),
    ).abort
  }, [generation, load, projectId])

  return { state, retry: () => setGeneration((value) => value + 1) }
}

export function startAnalysisCardRequest<T>(
  projectId: string,
  load: (projectId: string, signal: AbortSignal) => Promise<T>,
  onSuccess: (data: T) => void,
  onError: (error: unknown) => void,
): { abort: () => void } {
  const controller = new AbortController()
  load(projectId, controller.signal)
    .then((data) => {
      if (!controller.signal.aborted) onSuccess(data)
    })
    .catch((error: unknown) => {
      if (!controller.signal.aborted && !isAbortError(error)) onError(error)
    })
  return { abort: () => controller.abort() }
}

const loadCycles = (projectId: string, signal: AbortSignal): Promise<ImportCyclesResult> => fetchImportCycles(projectId, signal)
const loadUnreferenced = (projectId: string, signal: AbortSignal): Promise<UnreferencedExportsResult> => fetchUnreferencedExports(projectId, signal)
const loadHotspots = (projectId: string, signal: AbortSignal): Promise<HotspotsResult> => fetchHotspots(projectId, signal)
const loadCoupling = (projectId: string, signal: AbortSignal): Promise<ChangeCouplingResult> => fetchChangeCoupling(projectId, signal)

export function AnalysisTab({ projectId, onSelect }: AnalysisTabProps) {
  const cycles = useAnalysisCard(projectId, loadCycles)
  const unreferenced = useAnalysisCard(projectId, loadUnreferenced)
  const hotspots = useAnalysisCard(projectId, loadHotspots)
  const coupling = useAnalysisCard(projectId, loadCoupling)

  return (
    <section aria-labelledby="analysis-heading" className="h-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-[1600px] space-y-5 p-4 sm:p-6">
        <header className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-300">Repository signals</p>
          <h2 id="analysis-heading" className="text-2xl font-semibold tracking-tight">Analysis</h2>
          <p className="max-w-3xl text-sm text-subtle">
            Static architecture and indexed-history findings. Each panel reports its own coverage and limits.
          </p>
        </header>

        {!projectId && (
          <div role="status" className="rounded-xl border border-dashed border-border bg-card/50 p-8 text-center text-sm text-subtle">
            Select a project to run repository analysis.
          </div>
        )}

        <div className="grid items-start gap-4 lg:grid-cols-2">
          <AnalysisCard kind="cycles" state={cycles.state} retry={cycles.retry} onSelect={onSelect} />
          <AnalysisCard kind="unreferenced" state={unreferenced.state} retry={unreferenced.retry} onSelect={onSelect} />
          <AnalysisCard kind="hotspots" state={hotspots.state} retry={hotspots.retry} onSelect={onSelect} />
          <AnalysisCard kind="coupling" state={coupling.state} retry={coupling.retry} onSelect={onSelect} />
        </div>
      </div>
    </section>
  )
}

function AnalysisCard({
  kind,
  state,
  retry,
  onSelect,
}: AnalysisPanelProps & { retry: () => void }) {
  const headingId = `analysis-card-${kind}`
  const copy = CARD_COPY[kind]
  return (
    <Card role="region" aria-labelledby={headingId} className="gap-4 py-5">
      <CardHeader className="gap-1 px-5">
        <CardTitle id={headingId} className="text-base">{copy.title}</CardTitle>
        <CardDescription className="text-subtle">{copy.description}</CardDescription>
      </CardHeader>
      <CardContent className="px-5">
        {kind === 'cycles' && <AnalysisPanelContent kind={kind} state={state} onSelect={onSelect} />}
        {kind === 'unreferenced' && <AnalysisPanelContent kind={kind} state={state} onSelect={onSelect} />}
        {kind === 'hotspots' && <AnalysisPanelContent kind={kind} state={state} onSelect={onSelect} />}
        {kind === 'coupling' && <AnalysisPanelContent kind={kind} state={state} onSelect={onSelect} />}
        {state.status === 'error' && (
          <button
            type="button"
            onClick={retry}
            className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Retry
          </button>
        )}
      </CardContent>
    </Card>
  )
}

export function AnalysisPanelContent(props: AnalysisPanelProps) {
  if (props.state.status === 'idle') {
    return <p className="text-sm text-subtle">Select a project to load this analysis.</p>
  }
  if (props.state.status === 'loading') {
    return <p role="status" aria-live="polite" className="text-sm text-subtle">Loading {CARD_COPY[props.kind].title.toLowerCase()}...</p>
  }
  if (props.state.status === 'error') {
    return <p role="alert" className="text-sm text-red-300">{props.state.message}</p>
  }

  switch (props.kind) {
    case 'cycles': return <CyclesContent data={props.state.data} onSelect={props.onSelect} />
    case 'unreferenced': return <UnreferencedContent data={props.state.data} onSelect={props.onSelect} />
    case 'hotspots': return <HotspotsContent data={props.state.data} onSelect={props.onSelect} />
    case 'coupling': return <CouplingContent data={props.state.data} onSelect={props.onSelect} />
  }
}

function ResultButton({ children, onClick, ariaLabel }: { children: React.ReactNode; onClick: () => void; ariaLabel?: string }) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className="w-full rounded-md px-2 py-2 text-left hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  )
}

function CyclesContent({ data, onSelect }: { data: ImportCyclesResult; onSelect: (node: GraphNode) => void }) {
  if (data.cycles.length === 0) return <ResultMeta data={data} empty="No import cycles found." />
  return (
    <div className="space-y-3">
      <ol className="space-y-1">
        {data.cycles.map((cycle) => (
          <li key={cycle.filePaths.join('\u0000')} className="rounded-lg border border-border bg-background/40 p-1">
            <p className="px-2 pt-1 text-[11px] font-medium uppercase tracking-wider text-subtle">{cycle.length} file cycle</p>
            <div className="mt-1 flex flex-wrap items-center gap-1 px-1 pb-1">
              {cycle.filePaths.map((filePath, index) => (
                <span key={`${filePath}:${index}`} className="contents">
                  {index > 0 && <span aria-hidden="true" className="text-subtle">→</span>}
                  <button
                    type="button"
                    onClick={() => onSelect(analysisFileToGraphNode(filePath))}
                    className="rounded px-1.5 py-1 font-mono text-xs text-cyan-300 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {shortPath(filePath)}
                  </button>
                </span>
              ))}
            </div>
          </li>
        ))}
      </ol>
      <ResultMeta data={data} candidateLimitReached={data.candidateLimitReached} />
    </div>
  )
}

function UnreferencedContent({ data, onSelect }: { data: UnreferencedExportsResult; onSelect: (node: GraphNode) => void }) {
  if (data.items.length === 0) return <ResultMeta data={data} empty="No unreferenced exports found." />
  return (
    <div className="space-y-3">
      <ol className="divide-y divide-border rounded-lg border border-border bg-background/40">
        {data.items.map((item) => (
          <li key={item.id} className="p-1">
            <ResultButton onClick={() => onSelect(analysisSymbolToGraphNode(item))}>
              <span className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{item.name}</span>
                  <span className="block truncate font-mono text-[11px] text-subtle">{shortPath(item.filePath)}{lineSuffix(item.startLine)}</span>
                </span>
                <span className={item.confidence === 'higher' ? 'text-amber-300' : 'text-subtle'}>
                  <span className="whitespace-nowrap rounded-full border border-current/30 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                    {item.confidence === 'higher' ? 'Higher confidence' : 'Lower confidence'}
                  </span>
                </span>
              </span>
            </ResultButton>
          </li>
        ))}
      </ol>
      <ResultMeta data={data} />
    </div>
  )
}

function HotspotsContent({ data, onSelect }: { data: HotspotsResult; onSelect: (node: GraphNode) => void }) {
  const [scoreBy, setScoreBy] = useState<'complexity' | 'degree'>(data.input.scoreBy)
  const items = [...data.items].sort((left, right) => (
    scoreBy === 'complexity'
      ? right.complexityScore - left.complexityScore
      : right.degreeScore - left.degreeScore
  ))
  if (items.length === 0) return <ResultMeta data={data} empty="No hotspot history found." historyCoverage={data.historyCoverage} />
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs text-subtle">Rank by</span>
        <div role="group" aria-label="Hotspot score" className="flex rounded-md border border-border p-0.5">
          {(['complexity', 'degree'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={scoreBy === value}
              onClick={() => setScoreBy(value)}
              className="rounded px-2 py-1 text-xs capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-accent aria-pressed:text-accent-foreground"
            >
              {value}
            </button>
          ))}
        </div>
      </div>
      <ol className="divide-y divide-border rounded-lg border border-border bg-background/40">
        {items.map((item) => (
          <li key={item.filePath} className="p-1">
            <ResultButton onClick={() => onSelect(analysisFileToGraphNode(item.filePath))}>
              <span className="block truncate font-mono text-xs font-medium text-cyan-300">{shortPath(item.filePath)}</span>
              <span className="mt-1 grid grid-cols-3 gap-2 text-[11px] text-subtle">
                <Metric label="Changes" value={item.changeCount} />
                <Metric label="Churn" value={item.churn} />
                <Metric label={scoreBy === 'complexity' ? 'Complexity score' : 'Degree score'} value={scoreBy === 'complexity' ? item.complexityScore : item.degreeScore} />
              </span>
            </ResultButton>
          </li>
        ))}
      </ol>
      <ResultMeta data={data} historyCoverage={data.historyCoverage} />
    </div>
  )
}

function CouplingContent({ data, onSelect }: { data: ChangeCouplingResult; onSelect: (node: GraphNode) => void }) {
  if (data.items.length === 0) return <ResultMeta data={data} empty="No coupled file pairs found." historyCoverage={data.historyCoverage} />
  return (
    <div className="space-y-3">
      <ol className="space-y-2">
        {data.items.map((item) => (
          <li key={`${item.leftFile}\u0000${item.rightFile}`} className="rounded-lg border border-border bg-background/40 p-2">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <FilePairButton filePath={item.leftFile} onSelect={onSelect} />
              <span aria-hidden="true" className="text-subtle">↔</span>
              <FilePairButton filePath={item.rightFile} onSelect={onSelect} />
            </div>
            <p className="mt-2 text-center text-[11px] text-subtle">
              {item.coChanges} co-changes · {formatPercent(item.jaccard)} Jaccard
            </p>
          </li>
        ))}
      </ol>
      <ResultMeta data={data} historyCoverage={data.historyCoverage} />
    </div>
  )
}

function FilePairButton({ filePath, onSelect }: { filePath: string; onSelect: (node: GraphNode) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelect(analysisFileToGraphNode(filePath))}
      className="min-w-0 truncate rounded px-1.5 py-1 font-mono text-xs text-cyan-300 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {shortPath(filePath)}
    </button>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return <span><span className="block text-subtle">{label}</span><span className="font-medium text-foreground">{value.toLocaleString()}</span></span>
}

function ResultMeta({
  data,
  empty,
  candidateLimitReached = false,
  historyCoverage,
}: {
  data: { truncated: boolean; caveats: string[] }
  empty?: string
  candidateLimitReached?: boolean
  historyCoverage?: HistoryCoverage | null
}) {
  const caveatId = useId()
  return (
    <div className="space-y-2">
      {empty && <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-subtle">{empty}</p>}
      {historyCoverage !== undefined && <HistoryNote coverage={historyCoverage} />}
      {(data.truncated || candidateLimitReached) && (
        <p role="status" className="text-xs font-medium text-amber-300">
          {data.truncated && 'Results truncated.'}{data.truncated && candidateLimitReached && ' '}{candidateLimitReached && 'Candidate scan limit reached.'}
        </p>
      )}
      <div id={caveatId} className="rounded-lg border border-border bg-muted/30 p-2.5">
        <p className="text-[10px] font-medium uppercase tracking-wider text-subtle">Read with care</p>
        <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-relaxed text-subtle">
          {data.caveats.map((caveat, index) => <li key={`${index}:${caveat}`}>{caveat}</li>)}
        </ul>
      </div>
    </div>
  )
}

function HistoryNote({ coverage }: { coverage: HistoryCoverage | null }) {
  if (!coverage) return <p className="text-xs text-subtle">History coverage unavailable.</p>
  const range = coverage.earliestCommitDate && coverage.latestCommitDate
    ? ` from ${formatDate(coverage.earliestCommitDate)} to ${formatDate(coverage.latestCommitDate)}`
    : ''
  return (
    <p className="text-xs text-subtle">
      {coverage.commitCount.toLocaleString()} indexed commits{range}. {coverage.historyComplete ? 'History is complete.' : 'History may be partial.'}
    </p>
  )
}

function shortPath(filePath: string): string {
  const segments = filePath.split('/').filter(Boolean)
  return segments.slice(-3).join('/') || filePath
}

function lineSuffix(startLine: number | undefined): string {
  return startLine === undefined ? '' : `:${startLine}`
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString()
}
