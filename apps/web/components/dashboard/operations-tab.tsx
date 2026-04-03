'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { StatCard } from './stat-card'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface GraphStats {
  totalNodes: number
  totalEdges: number
  nodesByType: Record<string, number>
  edgesByType: Record<string, number>
  largestFiles: Array<{ path: string; entityCount: number }>
}

interface KnowledgeStats {
  totalEntities: number
  avgRelevance: number
  lowRelevanceCount: number
  oldestAccess: string | null
  newestAccess: string | null
}

interface EmbeddingLabel {
  label: string
  total: number
  withEmbedding: number
  coverage: number
}

export function OperationsTab() {
  const [graphStats, setGraphStats] = useState<GraphStats | null>(null)
  const [knowledgeStats, setKnowledgeStats] = useState<KnowledgeStats | null>(null)
  const [embeddings, setEmbeddings] = useState<EmbeddingLabel[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchAll() {
      try {
        const [graphRes, knowledgeRes, embeddingsRes] = await Promise.allSettled([
          fetch(`${API_URL}/api/stats`).then(r => r.ok ? r.json() : null),
          fetch(`${API_URL}/api/knowledge/stats`).then(r => r.ok ? r.json() : null),
          fetch(`${API_URL}/api/embeddings/status`).then(r => r.ok ? r.json() : null),
        ])

        if (graphRes.status === 'fulfilled' && graphRes.value) {
          setGraphStats(graphRes.value)
        }
        if (knowledgeRes.status === 'fulfilled' && knowledgeRes.value) {
          setKnowledgeStats(knowledgeRes.value)
        }
        if (embeddingsRes.status === 'fulfilled' && embeddingsRes.value) {
          setEmbeddings(embeddingsRes.value.labels ?? [])
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch stats')
      } finally {
        setLoading(false)
      }
    }

    fetchAll()
  }, [])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading operations data...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-red-400">{error}</p>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Top-level stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          title="Total Nodes"
          value={graphStats?.totalNodes?.toLocaleString() ?? '0'}
          description="Code symbols indexed"
        />
        <StatCard
          title="Total Edges"
          value={graphStats?.totalEdges?.toLocaleString() ?? '0'}
          description="Relationships tracked"
        />
        <StatCard
          title="Knowledge Entities"
          value={knowledgeStats?.totalEntities?.toLocaleString() ?? '0'}
          description="Facts stored"
        />
        <StatCard
          title="Avg Relevance"
          value={knowledgeStats?.avgRelevance?.toFixed(3) ?? 'N/A'}
          description="Knowledge freshness"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Node types breakdown */}
        {graphStats?.nodesByType && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Node Types</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {Object.entries(graphStats.nodesByType)
                  .sort(([, a], [, b]) => b - a)
                  .map(([type, count]) => (
                    <div key={type} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">{type}</Badge>
                      </div>
                      <span className="text-sm font-mono">{count.toLocaleString()}</span>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Embedding coverage */}
        {embeddings.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Embedding Coverage</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {embeddings
                  .filter(e => e.total > 0)
                  .map((e) => (
                    <div key={e.label}>
                      <div className="flex items-center justify-between text-sm">
                        <span>{e.label}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {e.withEmbedding}/{e.total} ({e.coverage}%)
                        </span>
                      </div>
                      <div className="mt-1 h-2 w-full rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full bg-green-500 transition-all"
                          style={{ width: `${e.coverage}%` }}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Knowledge health */}
        {knowledgeStats && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Knowledge Graph Health</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Low relevance entities</span>
                <span className="font-mono">{knowledgeStats.lowRelevanceCount}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Oldest access</span>
                <span className="font-mono text-xs">
                  {knowledgeStats.oldestAccess
                    ? new Date(knowledgeStats.oldestAccess).toLocaleDateString()
                    : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Newest access</span>
                <span className="font-mono text-xs">
                  {knowledgeStats.newestAccess
                    ? new Date(knowledgeStats.newestAccess).toLocaleDateString()
                    : 'N/A'}
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Largest files */}
        {graphStats?.largestFiles && graphStats.largestFiles.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Largest Files (by entity count)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {graphStats.largestFiles.slice(0, 10).map((f) => (
                  <div key={f.path} className="flex items-center justify-between text-sm">
                    <span className="truncate text-xs text-muted-foreground">
                      {f.path.replace(/^.*\/packages\//, 'packages/').replace(/^.*\/apps\//, 'apps/')}
                    </span>
                    <span className="ml-2 font-mono text-xs">{f.entityCount}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
