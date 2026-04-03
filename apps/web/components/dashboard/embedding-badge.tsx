'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface EmbeddingLabel {
  label: string
  total: number
  withEmbedding: number
  coverage: number
}

export function EmbeddingBadge() {
  const [stats, setStats] = useState<{ total: number; embedded: number; pct: number } | null>(null)

  useEffect(() => {
    async function fetch_stats() {
      try {
        const res = await fetch(`${API_URL}/api/embeddings/status`)
        if (!res.ok) return
        const data = await res.json()
        const labels = (data.labels ?? []) as EmbeddingLabel[]
        const total = labels.reduce((s, l) => s + l.total, 0)
        const embedded = labels.reduce((s, l) => s + l.withEmbedding, 0)
        const pct = total > 0 ? Math.round((embedded / total) * 100) : 0
        setStats({ total, embedded, pct })
      } catch {
        // non-fatal
      }
    }
    fetch_stats()
    const interval = setInterval(fetch_stats, 30_000)
    return () => clearInterval(interval)
  }, [])

  if (!stats || stats.total === 0) return null

  const color = stats.pct >= 90 ? 'text-emerald-400 border-emerald-400/30'
    : stats.pct >= 50 ? 'text-yellow-400 border-yellow-400/30'
    : 'text-red-400 border-red-400/30'

  return (
    <Badge variant="outline" className={`text-[10px] ${color}`}>
      Embeddings: {stats.pct}% ({stats.embedded}/{stats.total})
    </Badge>
  )
}
