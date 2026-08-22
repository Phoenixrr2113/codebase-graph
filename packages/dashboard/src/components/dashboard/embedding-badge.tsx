import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { API_URL } from '@/lib/api'
import { EMBEDDABLE_LABELS } from '@codegraph/types'

interface EmbeddingLabel {
  label: string
  total: number
  withEmbedding: number
  coverage: number
}

interface EmbeddingSummary {
  total: number
  embedded: number
  pct: number
  running: boolean
  scope: EmbeddingScope
}

type EmbeddingScope =
  | { kind: 'all' }
  | { kind: 'project'; projectId: string; projectName: string | null }

type EmbeddingState =
  | { status: 'loading' }
  | { status: 'success'; data: EmbeddingSummary }
  | { status: 'error'; message: string }

interface EmbeddingBadgeContentProps {
  state: EmbeddingState
  generating: boolean
  genResult: string | null
  onGenerate: () => void
  onRetry: () => void
}

interface EmbeddingBadgeProps {
  projectId: string | null
  projectName: string | null
  refreshKey?: number
}

interface FetchResponse {
  ok: boolean
  status: number
  statusText: string
  json(): Promise<unknown>
}

type FetchImplementation = (input: string, init?: RequestInit) => Promise<FetchResponse>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseLabels(value: unknown): EmbeddingLabel[] {
  if (!isRecord(value) || !Array.isArray(value.labels)) {
    throw new Error('Invalid embedding status response')
  }
  return value.labels.map((label) => {
    if (
      !isRecord(label)
      || typeof label.label !== 'string'
      || !finiteNumber(label.total)
      || !finiteNumber(label.withEmbedding)
      || !finiteNumber(label.coverage)
    ) {
      throw new Error('Invalid embedding status response')
    }
    return {
      label: label.label,
      total: label.total,
      withEmbedding: label.withEmbedding,
      coverage: label.coverage,
    }
  })
}

function parseScope(value: unknown): EmbeddingScope {
  if (value === 'all' || value === 'global') return { kind: 'all' }
  if (!isRecord(value)) throw new Error('Invalid embedding status response')

  const kind = value.kind ?? value.type
  if (kind === 'all' || kind === 'global') return { kind: 'all' }
  if (
    (kind === 'project' || typeof value.projectId === 'string')
    && typeof value.projectId === 'string'
    && (value.projectName === undefined || value.projectName === null || typeof value.projectName === 'string')
  ) {
    return {
      kind: 'project',
      projectId: value.projectId,
      projectName: typeof value.projectName === 'string' ? value.projectName : null,
    }
  }
  throw new Error('Invalid embedding status response')
}

async function loadEmbeddingSummary(
  fetcher: FetchImplementation,
  projectId: string | null,
  signal: AbortSignal,
): Promise<EmbeddingState> {
  try {
    const query = projectId ? `?${new URLSearchParams({ projectId })}` : ''
    const response = await fetcher(`${API_URL}/api/embeddings/status${query}`, { signal })
    if (!response.ok) {
      const statusText = response.statusText ? ` ${response.statusText}` : ''
      throw new Error(`HTTP ${response.status}${statusText}`)
    }

    const payload = await response.json()
    if (!isRecord(payload)) {
      throw new Error('Invalid embedding status response')
    }
    const embeddingPass = payload.embeddingPass
    const running = typeof payload.running === 'boolean'
      ? payload.running
      : isRecord(embeddingPass) && typeof embeddingPass.running === 'boolean'
        ? embeddingPass.running
        : null
    if (running === null) throw new Error('Invalid embedding status response')
    const labels = parseLabels(payload)
    const scope = parseScope(payload.scope)
    const embeddable = new Set<string>(EMBEDDABLE_LABELS)
    const relevant = labels.filter((label) => embeddable.has(label.label))
    const total = relevant.reduce((sum, label) => sum + label.total, 0)
    const embedded = relevant.reduce((sum, label) => sum + label.withEmbedding, 0)
    const pct = total > 0 ? Math.round((embedded / total) * 100) : 0
    return { status: 'success', data: { total, embedded, pct, running, scope } }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Request failed',
    }
  }
}

interface EmbeddingPollingOptions {
  projectId: string | null
  fetcher: FetchImplementation
  onState: (state: EmbeddingState) => void
  pollIntervalMs?: number
  pollWhileIdle?: boolean
}

export function startEmbeddingStatusPolling({
  projectId,
  fetcher,
  onState,
  pollIntervalMs = 1_000,
  pollWhileIdle = false,
}: EmbeddingPollingOptions): { abort: () => void } {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined

  const poll = async (): Promise<void> => {
    const nextState = await loadEmbeddingSummary(fetcher, projectId, controller.signal)
    if (controller.signal.aborted) return
    onState(nextState)
    if (nextState.status === 'success' && (nextState.data.running || pollWhileIdle)) {
      timer = setTimeout(() => void poll(), pollIntervalMs)
    }
  }

  void poll()
  return {
    abort: () => {
      controller.abort()
      if (timer !== undefined) clearTimeout(timer)
    },
  }
}

export function createEmbeddingGenerateBody(projectId: string | null): { projectId?: string } {
  return projectId ? { projectId } : {}
}

export function EmbeddingBadgeContent({
  state,
  generating,
  genResult,
  onGenerate,
  onRetry,
}: EmbeddingBadgeContentProps) {
  if (state.status === 'loading') return null

  if (state.status === 'error') {
    return (
      <div role="alert" className="flex items-center gap-1.5 text-[10px] text-red-400">
        <span title={state.message}>Embedding status unavailable</span>
        <Button variant="ghost" size="sm" onClick={onRetry} className="h-5 px-1.5 text-[10px]">
          Retry
        </Button>
      </div>
    )
  }

  const stats = state.data
  const badgeColor = stats.pct >= 90
    ? { color: '#34d399', borderColor: 'rgba(16,185,129,0.3)' }
    : stats.pct >= 50
      ? { color: '#facc15', borderColor: 'rgba(234,179,8,0.3)' }
      : { color: '#f87171', borderColor: 'rgba(239,68,68,0.3)' }

  return (
    <div className="flex items-center gap-1.5">
      <Badge variant="outline" className="text-[10px]" style={badgeColor}>
        Embeddings ({stats.scope.kind === 'all'
          ? 'All projects'
          : stats.scope.projectName ?? stats.scope.projectId}): {stats.pct}% ({stats.embedded}/{stats.total})
      </Badge>
      {stats.pct < 100 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onGenerate}
          disabled={generating || stats.running}
          className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
        >
          {generating || stats.running ? 'Generating...' : 'Generate'}
        </Button>
      )}
      {genResult && (
        <span className="text-[10px] text-muted-foreground">{genResult}</span>
      )}
    </div>
  )
}

export function EmbeddingBadge({ projectId, projectName, refreshKey = 0 }: EmbeddingBadgeProps) {
  const [state, setState] = useState<EmbeddingState>({ status: 'loading' })
  const [generating, setGenerating] = useState(false)
  const [genResult, setGenResult] = useState<string | null>(null)
  const [pollKey, setPollKey] = useState(0)

  useEffect(() => {
    setState({ status: 'loading' })
    const lifecycle = startEmbeddingStatusPolling({
      projectId,
      fetcher: fetch,
      onState: (nextState) => {
        if (
          nextState.status === 'success'
          && nextState.data.scope.kind === 'project'
          && nextState.data.scope.projectName === null
          && projectName
        ) {
          setState({
            ...nextState,
            data: {
              ...nextState.data,
              scope: { ...nextState.data.scope, projectName },
            },
          })
          return
        }
        setState(nextState)
      },
      pollWhileIdle: generating,
    })
    return lifecycle.abort
  }, [generating, pollKey, projectId, projectName, refreshKey])

  const handleGenerate = useCallback(async () => {
    setGenerating(true)
    setGenResult(null)
    try {
      const response = await fetch(`${API_URL}/api/embeddings/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createEmbeddingGenerateBody(projectId)),
      })
      const data: unknown = await response.json()
      if (!isRecord(data)) throw new Error('Invalid embedding generation response')

      if (!response.ok || typeof data.error === 'string') {
        const message = typeof data.hint === 'string'
          ? data.hint
          : typeof data.error === 'string'
            ? data.error
            : `HTTP ${response.status}`
        setGenResult(message)
      } else if (finiteNumber(data.embedded) || data.running === true) {
        setGenResult(finiteNumber(data.embedded) ? `${data.embedded} embedded` : 'Embedding pass started')
        setPollKey((key) => key + 1)
      } else {
        throw new Error('Invalid embedding generation response')
      }
    } catch (error) {
      setGenResult(error instanceof Error ? error.message : 'Failed')
    } finally {
      setGenerating(false)
      setTimeout(() => setGenResult(null), 5_000)
    }
  }, [projectId])

  return (
    <EmbeddingBadgeContent
      state={state}
      generating={generating}
      genResult={genResult}
      onGenerate={() => void handleGenerate()}
      onRetry={() => setPollKey((key) => key + 1)}
    />
  )
}
