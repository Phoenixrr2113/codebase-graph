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
}

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

interface FetchResponse {
  ok: boolean
  status: number
  statusText: string
  json(): Promise<unknown>
}

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

async function loadEmbeddingSummary(
  fetcher: (input: string) => Promise<FetchResponse>,
): Promise<EmbeddingState> {
  try {
    const response = await fetcher(`${API_URL}/api/embeddings/status`)
    if (!response.ok) {
      const statusText = response.statusText ? ` ${response.statusText}` : ''
      throw new Error(`HTTP ${response.status}${statusText}`)
    }

    const labels = parseLabels(await response.json())
    const embeddable = new Set<string>(EMBEDDABLE_LABELS)
    const relevant = labels.filter((label) => embeddable.has(label.label))
    const total = relevant.reduce((sum, label) => sum + label.total, 0)
    const embedded = relevant.reduce((sum, label) => sum + label.withEmbedding, 0)
    const pct = total > 0 ? Math.round((embedded / total) * 100) : 0
    return { status: 'success', data: { total, embedded, pct } }
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Request failed',
    }
  }
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
  if (stats.total === 0) return null

  const badgeColor = stats.pct >= 90
    ? { color: '#34d399', borderColor: 'rgba(16,185,129,0.3)' }
    : stats.pct >= 50
      ? { color: '#facc15', borderColor: 'rgba(234,179,8,0.3)' }
      : { color: '#f87171', borderColor: 'rgba(239,68,68,0.3)' }

  return (
    <div className="flex items-center gap-1.5">
      <Badge variant="outline" className="text-[10px]" style={badgeColor}>
        Embeddings: {stats.pct}% ({stats.embedded}/{stats.total})
      </Badge>
      {stats.pct < 100 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onGenerate}
          disabled={generating}
          className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
        >
          {generating ? 'Generating...' : 'Generate'}
        </Button>
      )}
      {genResult && (
        <span className="text-[10px] text-muted-foreground">{genResult}</span>
      )}
    </div>
  )
}

export function EmbeddingBadge() {
  const [state, setState] = useState<EmbeddingState>({ status: 'loading' })
  const [generating, setGenerating] = useState(false)
  const [genResult, setGenResult] = useState<string | null>(null)

  const fetchStats = useCallback(async () => {
    setState(await loadEmbeddingSummary(fetch))
  }, [])

  useEffect(() => {
    const initialFetch = window.setTimeout(() => void fetchStats(), 0)
    const interval = window.setInterval(() => void fetchStats(), 30_000)
    return () => {
      clearTimeout(initialFetch)
      clearInterval(interval)
    }
  }, [fetchStats])

  const handleGenerate = useCallback(async () => {
    setGenerating(true)
    setGenResult(null)
    try {
      const response = await fetch(`${API_URL}/api/embeddings/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
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
      } else if (finiteNumber(data.embedded)) {
        setGenResult(`${data.embedded} embedded`)
        await fetchStats()
      } else {
        throw new Error('Invalid embedding generation response')
      }
    } catch (error) {
      setGenResult(error instanceof Error ? error.message : 'Failed')
    } finally {
      setGenerating(false)
      setTimeout(() => setGenResult(null), 5_000)
    }
  }, [fetchStats])

  return (
    <EmbeddingBadgeContent
      state={state}
      generating={generating}
      genResult={genResult}
      onGenerate={() => void handleGenerate()}
      onRetry={() => void fetchStats()}
    />
  )
}
