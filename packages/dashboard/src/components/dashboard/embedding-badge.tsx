import { useEffect, useState, useCallback } from 'react'
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

export function EmbeddingBadge() {
  const [stats, setStats] = useState<{ total: number; embedded: number; pct: number } | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genResult, setGenResult] = useState<string | null>(null)

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/embeddings/status`)
      if (!res.ok) return
      const data = await res.json()
      const labels = (data.labels ?? []) as EmbeddingLabel[]
      // Only count embeddable node types (code symbols, not git/markdown structure).
      // EMBEDDABLE_LABELS is the shared source of truth (packages/types/src/labels.ts).
      const embeddable = new Set<string>(EMBEDDABLE_LABELS)
      const relevant = labels.filter(l => embeddable.has(l.label))
      const total = relevant.reduce((s, l) => s + l.total, 0)
      const embedded = relevant.reduce((s, l) => s + l.withEmbedding, 0)
      const pct = total > 0 ? Math.round((embedded / total) * 100) : 0
      setStats({ total, embedded, pct })
    } catch {
      // non-fatal
    }
  }, [])

  useEffect(() => {
    const initialFetch = window.setTimeout(fetchStats, 0)
    const interval = setInterval(fetchStats, 30_000)
    return () => {
      clearTimeout(initialFetch)
      clearInterval(interval)
    }
  }, [fetchStats])

  const handleGenerate = useCallback(async () => {
    setGenerating(true)
    setGenResult(null)
    try {
      const res = await fetch(`${API_URL}/api/embeddings/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        setGenResult(data.hint ?? data.error ?? 'Failed')
      } else {
        setGenResult(`${data.embedded} embedded`)
        fetchStats() // refresh badge
      }
    } catch (err) {
      setGenResult(err instanceof Error ? err.message : 'Failed')
    } finally {
      setGenerating(false)
      setTimeout(() => setGenResult(null), 5000)
    }
  }, [fetchStats])

  if (!stats || stats.total === 0) return null

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
          onClick={handleGenerate}
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
