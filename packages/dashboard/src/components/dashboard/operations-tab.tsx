import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StatCard } from './stat-card'
import { API_URL } from '@/lib/api'

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

export type ResourceState<T> =
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; message: string }

export interface OperationsStates {
  graph: ResourceState<GraphStats>
  knowledge: ResourceState<KnowledgeStats>
  embeddings: ResourceState<EmbeddingLabel[]>
}

interface FetchResponse {
  ok: boolean
  status: number
  statusText: string
  json(): Promise<unknown>
}

type FetchLike = (input: string) => Promise<FetchResponse>

const INITIAL_STATES: OperationsStates = {
  graph: { status: 'loading' },
  knowledge: { status: 'loading' },
  embeddings: { status: 'loading' },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function numberRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every(isFiniteNumber)
}

function parseGraphStats(value: unknown): GraphStats {
  if (
    !isRecord(value)
    || !isFiniteNumber(value.totalNodes)
    || !isFiniteNumber(value.totalEdges)
    || !numberRecord(value.nodesByType)
    || !numberRecord(value.edgesByType)
    || !Array.isArray(value.largestFiles)
  ) {
    throw new Error('Invalid graph stats response')
  }

  const largestFiles = value.largestFiles.map((file) => {
    if (!isRecord(file) || typeof file.path !== 'string' || !isFiniteNumber(file.entityCount)) {
      throw new Error('Invalid graph stats response')
    }
    return { path: file.path, entityCount: file.entityCount }
  })

  return {
    totalNodes: value.totalNodes,
    totalEdges: value.totalEdges,
    nodesByType: value.nodesByType,
    edgesByType: value.edgesByType,
    largestFiles,
  }
}

function parseKnowledgeStats(value: unknown): KnowledgeStats {
  if (
    !isRecord(value)
    || !isFiniteNumber(value.totalEntities)
    || !isFiniteNumber(value.avgRelevance)
    || !isFiniteNumber(value.lowRelevanceCount)
    || (value.oldestAccess !== null && typeof value.oldestAccess !== 'string')
    || (value.newestAccess !== null && typeof value.newestAccess !== 'string')
  ) {
    throw new Error('Invalid knowledge stats response')
  }

  return {
    totalEntities: value.totalEntities,
    avgRelevance: value.avgRelevance,
    lowRelevanceCount: value.lowRelevanceCount,
    oldestAccess: value.oldestAccess,
    newestAccess: value.newestAccess,
  }
}

function parseEmbeddingLabels(value: unknown): EmbeddingLabel[] {
  if (!isRecord(value) || !Array.isArray(value.labels)) {
    throw new Error('Invalid embedding status response')
  }

  return value.labels.map((label) => {
    if (
      !isRecord(label)
      || typeof label.label !== 'string'
      || !isFiniteNumber(label.total)
      || !isFiniteNumber(label.withEmbedding)
      || !isFiniteNumber(label.coverage)
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed'
}

async function loadResource<T>(
  fetcher: FetchLike,
  path: string,
  parse: (value: unknown) => T,
): Promise<ResourceState<T>> {
  try {
    const response = await fetcher(`${API_URL}${path}`)
    if (!response.ok) {
      const statusText = response.statusText ? ` ${response.statusText}` : ''
      throw new Error(`HTTP ${response.status}${statusText}`)
    }
    return { status: 'success', data: parse(await response.json()) }
  } catch (error) {
    return { status: 'error', message: errorMessage(error) }
  }
}

function loadGraphStats(fetcher: FetchLike): Promise<ResourceState<GraphStats>> {
  return loadResource(fetcher, '/api/stats', parseGraphStats)
}

function loadKnowledgeStats(fetcher: FetchLike): Promise<ResourceState<KnowledgeStats>> {
  return loadResource(fetcher, '/api/knowledge/stats', parseKnowledgeStats)
}

function loadEmbeddingStats(fetcher: FetchLike): Promise<ResourceState<EmbeddingLabel[]>> {
  return loadResource(fetcher, '/api/embeddings/status', parseEmbeddingLabels)
}

export async function loadOperationsData(fetcher: FetchLike = fetch): Promise<OperationsStates> {
  const [graph, knowledge, embeddings] = await Promise.all([
    loadGraphStats(fetcher),
    loadKnowledgeStats(fetcher),
    loadEmbeddingStats(fetcher),
  ])
  return { graph, knowledge, embeddings }
}

interface OperationsContentProps {
  states: OperationsStates
  retry: {
    graph: () => void
    knowledge: () => void
    embeddings: () => void
  }
}

function stateProps<T>(state: ResourceState<T>, onRetry: () => void): {
  loading: boolean
  error?: string
  onRetry: () => void
} {
  if (state.status === 'loading') return { loading: true, onRetry }
  if (state.status === 'error') return { loading: false, error: state.message, onRetry }
  return { loading: false, onRetry }
}

export function OperationsContent({ states, retry }: OperationsContentProps) {
  const allFailed = Object.values(states).every((state) => state.status === 'error')
  const graphStateProps = stateProps(states.graph, retry.graph)
  const knowledgeStateProps = stateProps(states.knowledge, retry.knowledge)

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {allFailed && (
        <div role="alert" className="rounded-md border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-300">
          Unable to load operations data. Retry the failed cards below.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          title="Total Nodes"
          value={states.graph.status === 'success' ? states.graph.data.totalNodes.toLocaleString() : undefined}
          description="Everything in the graph"
          {...graphStateProps}
        />
        <StatCard
          title="Total Edges"
          value={states.graph.status === 'success' ? states.graph.data.totalEdges.toLocaleString() : undefined}
          description="Relationships tracked"
          {...graphStateProps}
        />
        <StatCard
          title="Knowledge Entities"
          value={states.knowledge.status === 'success' ? states.knowledge.data.totalEntities.toLocaleString() : undefined}
          description="Facts stored"
          {...knowledgeStateProps}
        />
        <StatCard
          title="Avg Relevance"
          value={states.knowledge.status === 'success' ? states.knowledge.data.avgRelevance.toFixed(3) : undefined}
          description="Knowledge freshness"
          {...knowledgeStateProps}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {states.graph.status === 'success' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Node Types</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {Object.entries(states.graph.data.nodesByType)
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

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Embedding Coverage</CardTitle>
          </CardHeader>
          <CardContent>
            {states.embeddings.status === 'loading' ? (
              <p role="status" className="text-sm text-muted-foreground">Loading...</p>
            ) : states.embeddings.status === 'error' ? (
              <div role="alert" className="space-y-2">
                <p className="text-xs text-red-400">{states.embeddings.message}</p>
                <Button variant="outline" size="sm" onClick={retry.embeddings} className="h-7 text-xs">
                  Retry
                </Button>
              </div>
            ) : states.embeddings.data.length === 0 ? (
              <p className="text-sm text-muted-foreground">No embedding data available.</p>
            ) : (
              <div className="space-y-3">
                {states.embeddings.data
                  .filter((embedding) => embedding.total > 0)
                  .map((embedding) => (
                    <div key={embedding.label}>
                      <div className="flex items-center justify-between text-sm">
                        <span>{embedding.label}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {embedding.withEmbedding}/{embedding.total} ({embedding.coverage}%)
                        </span>
                      </div>
                      <div className="mt-1 h-2 w-full rounded-full bg-muted">
                        <div
                          className="h-2 rounded-full bg-green-500 transition-all"
                          style={{ width: `${embedding.coverage}%` }}
                        />
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>

        {states.knowledge.status === 'success' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Knowledge Graph Health</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Low relevance entities</span>
                <span className="font-mono">{states.knowledge.data.lowRelevanceCount}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Oldest access</span>
                <span className="font-mono text-xs">
                  {states.knowledge.data.oldestAccess
                    ? new Date(states.knowledge.data.oldestAccess).toLocaleDateString()
                    : 'No access recorded'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Newest access</span>
                <span className="font-mono text-xs">
                  {states.knowledge.data.newestAccess
                    ? new Date(states.knowledge.data.newestAccess).toLocaleDateString()
                    : 'No access recorded'}
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {states.graph.status === 'success' && states.graph.data.largestFiles.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Largest Files (by entity count)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {states.graph.data.largestFiles.slice(0, 10).map((file) => (
                  <div key={file.path} className="flex items-center justify-between text-sm">
                    <span className="truncate text-xs text-muted-foreground">
                      {file.path.replace(/^.*\/packages\//, 'packages/').replace(/^.*\/apps\//, 'apps/')}
                    </span>
                    <span className="ml-2 font-mono text-xs">{file.entityCount}</span>
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

export function OperationsTab() {
  const [states, setStates] = useState<OperationsStates>(INITIAL_STATES)

  const refresh = useCallback(async (resource: keyof OperationsStates): Promise<void> => {
    if (resource === 'graph') {
      setStates((current) => ({ ...current, graph: { status: 'loading' } }))
      const graph = await loadGraphStats(fetch)
      setStates((current) => ({ ...current, graph }))
      return
    }
    if (resource === 'knowledge') {
      setStates((current) => ({ ...current, knowledge: { status: 'loading' } }))
      const knowledge = await loadKnowledgeStats(fetch)
      setStates((current) => ({ ...current, knowledge }))
      return
    }

    setStates((current) => ({ ...current, embeddings: { status: 'loading' } }))
    const embeddings = await loadEmbeddingStats(fetch)
    setStates((current) => ({ ...current, embeddings }))
  }, [])

  useEffect(() => {
    void refresh('graph')
    void refresh('knowledge')
    void refresh('embeddings')
  }, [refresh])

  return (
    <OperationsContent
      states={states}
      retry={{
        graph: () => void refresh('graph'),
        knowledge: () => void refresh('knowledge'),
        embeddings: () => void refresh('embeddings'),
      }}
    />
  )
}
