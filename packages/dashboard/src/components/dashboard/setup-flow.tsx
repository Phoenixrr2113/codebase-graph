import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Database, FolderOpen, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { SetupStatus } from '@/lib/setup-status'
import { FolderPicker } from './folder-picker'
import type { ParsedProject } from './parse-project-dialog'

interface IndexStats {
  files: number
  entities: number
  edges: number
  errors: number
  durationMs: number
  embedded?: number
}

interface IndexResult extends ParsedProject {
  stats: IndexStats
}

type EmbeddingCountState =
  | { status: 'idle' | 'loading' }
  | { status: 'success'; count: number }
  | { status: 'error'; message: string }

interface SetupFlowProps {
  apiUrl: string
  status: SetupStatus
  onStatusRefresh: () => Promise<void>
  onProjectParsed: (project: ParsedProject) => void
  onExplore: () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0
}

function parseIndexResult(value: unknown): IndexResult {
  if (
    !isRecord(value)
    || value.success !== true
    || typeof value.projectId !== 'string'
    || typeof value.projectName !== 'string'
    || !isRecord(value.stats)
  ) {
    throw new Error('Indexing returned an invalid response')
  }
  const stats = value.stats
  if (
    !isNonNegativeNumber(stats.files)
    || !isNonNegativeNumber(stats.entities)
    || !isNonNegativeNumber(stats.edges)
    || !isNonNegativeNumber(stats.errors)
    || !isNonNegativeNumber(stats.durationMs)
    || (stats.embedded !== undefined && !isNonNegativeNumber(stats.embedded))
  ) {
    throw new Error('Indexing returned invalid counts')
  }
  return {
    projectId: value.projectId,
    projectName: value.projectName,
    stats: {
      files: stats.files,
      entities: stats.entities,
      edges: stats.edges,
      errors: stats.errors,
      durationMs: stats.durationMs,
      ...(stats.embedded === undefined ? {} : { embedded: stats.embedded }),
    },
  }
}

function parseEmbeddingCount(value: unknown): number {
  if (!isRecord(value) || !Array.isArray(value.labels)) {
    throw new Error('Embedding status returned an invalid response')
  }
  return value.labels.reduce((total, label) => {
    if (!isRecord(label) || !isNonNegativeNumber(label.withEmbedding)) {
      throw new Error('Embedding status returned an invalid count')
    }
    return total + label.withEmbedding
  }, 0)
}

async function responseMessage(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null)
  if (isRecord(body)) {
    if (typeof body.error === 'string') return body.error
    if (Array.isArray(body.errorMessages) && typeof body.errorMessages[0] === 'string') {
      return body.errorMessages[0]
    }
  }
  return `${fallback} (HTTP ${response.status})`
}

function storageLabel(status: SetupStatus): string {
  return status.storage.driver === 'falkordblite' ? 'Embedded FalkorDBLite' : 'External FalkorDB'
}

function ownerLabel(state: SetupStatus['storage']['ownerState']): string {
  if (state === 'owned') return 'This CodeGraph process owns storage'
  if (state === 'attached') return 'Attached to the storage owner'
  if (state === 'starting') return 'Storage is starting'
  return 'Storage is blocked'
}

function providerLabel(provider: SetupStatus['embedding']['profile']['provider']): string {
  if (provider === 'local') return 'Local'
  if (provider === 'voyage') return 'Voyage'
  if (provider === 'openrouter') return 'OpenRouter'
  return 'Structural only'
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

function ProgressBar({ value, label }: { value: number; label: string }) {
  const bounded = Math.max(0, Math.min(100, value))
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(bounded)}
      className="h-2 overflow-hidden rounded-full bg-muted"
    >
      <div className="h-full rounded-full bg-emerald-700 transition-[width] dark:bg-emerald-400" style={{ width: `${bounded}%` }} />
    </div>
  )
}

function ModelProgress({ status }: { status: SetupStatus }) {
  const load = status.embedding.modelLoad
  if (!load || load.state === 'not-started') return null
  const measuredPercent = load.percent ?? (
    load.loadedBytes !== undefined && load.totalBytes !== undefined && load.totalBytes > 0
      ? (load.loadedBytes / load.totalBytes) * 100
      : undefined
  )
  return (
    <div className="mt-3 rounded-md border border-border bg-background/60 p-3" aria-busy={load.state === 'downloading' || load.state === 'loading'}>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">
          {load.state === 'downloading' ? 'Downloading local model' : load.state === 'loading' ? 'Loading local model' : load.state === 'ready' ? 'Local model ready' : 'Local model failed'}
        </span>
        {measuredPercent !== undefined && <span className="tabular-nums">{Math.round(measuredPercent)}%</span>}
      </div>
      {measuredPercent !== undefined && <div className="mt-2"><ProgressBar value={measuredPercent} label="Local model download" /></div>}
      {load.loadedBytes !== undefined && load.totalBytes !== undefined && (
        <p className="mt-1 text-xs text-subtle">{formatBytes(load.loadedBytes)} of {formatBytes(load.totalBytes)}</p>
      )}
      {load.error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">{load.error}</p>}
    </div>
  )
}

function IndexProgress({ status, pending }: { status: SetupStatus; pending: boolean }) {
  const progress = status.index.progress
  const continuationRunning = status.index.embeddingPass.running
  if (!progress && !continuationRunning && !pending) return null
  const hasMeasuredProgress = progress?.processed !== undefined
    && progress.total !== undefined
    && progress.total > 0
  const percent = hasMeasuredProgress
    ? ((progress?.processed ?? 0) / (progress?.total ?? 1)) * 100
    : undefined
  const phase = continuationRunning && progress?.phase === 'complete'
    ? 'Generating remaining embeddings'
    : progress?.message ?? (pending ? 'Starting index...' : 'Generating embeddings')

  return (
    <div className="rounded-md border border-border bg-background/60 p-4" aria-busy={pending || status.index.state === 'indexing' || status.index.state === 'embedding'}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{phase}</p>
        {hasMeasuredProgress && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {progress?.processed} of {progress?.total}
          </span>
        )}
      </div>
      {percent !== undefined && <div className="mt-2"><ProgressBar value={percent} label="Indexing progress" /></div>}
      {continuationRunning && (
        <p className="mt-2 text-xs text-subtle">Finishing embeddings automatically. No second indexing step is needed.</p>
      )}
    </div>
  )
}

export function SetupFlow({ apiUrl, status, onStatusRefresh, onProjectParsed, onExplore }: SetupFlowProps) {
  const [path, setPath] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [indexing, setIndexing] = useState(false)
  const [indexError, setIndexError] = useState<string | null>(null)
  const [indexResult, setIndexResult] = useState<IndexResult | null>(null)
  const [migrationRunning, setMigrationRunning] = useState(false)
  const [migrationError, setMigrationError] = useState<string | null>(null)
  const [embeddingCount, setEmbeddingCount] = useState<EmbeddingCountState>({ status: 'idle' })
  const done = indexResult !== null
    && status.projects.configured
    && status.index.state === 'idle'
    && !status.index.embeddingPass.running

  const loadEmbeddingCount = useCallback(async (signal?: AbortSignal): Promise<void> => {
    if (!indexResult) return
    setEmbeddingCount({ status: 'loading' })
    try {
      const response = await fetch(
        `${apiUrl}/api/embeddings/status?projectId=${encodeURIComponent(indexResult.projectId)}`,
        { signal },
      )
      if (!response.ok) throw new Error(`Embedding status unavailable (HTTP ${response.status})`)
      setEmbeddingCount({ status: 'success', count: parseEmbeddingCount(await response.json()) })
    } catch (error) {
      if (signal?.aborted) return
      setEmbeddingCount({
        status: 'error',
        message: error instanceof Error ? error.message : 'Embedding count unavailable',
      })
    }
  }, [apiUrl, indexResult])

  const indexProject = useCallback(async (): Promise<void> => {
    const trimmed = path.trim()
    if (!trimmed || indexing) return
    setIndexing(true)
    setIndexError(null)
    setIndexResult(null)
    try {
      const response = await fetch(`${apiUrl}/api/parse/project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: trimmed }),
      })
      if (!response.ok) throw new Error(await responseMessage(response, 'Indexing failed'))
      const result = parseIndexResult(await response.json())
      setIndexResult(result)
      onProjectParsed(result)
    } catch (error) {
      setIndexError(error instanceof Error ? error.message : 'Indexing failed')
    } finally {
      setIndexing(false)
      await onStatusRefresh()
    }
  }, [apiUrl, indexing, onProjectParsed, onStatusRefresh, path])

  const runMigration = useCallback(async (): Promise<void> => {
    if (migrationRunning) return
    setMigrationRunning(true)
    setMigrationError(null)
    try {
      const response = await fetch(`${apiUrl}/api/embeddings/migrate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!response.ok) throw new Error(await responseMessage(response, 'Migration failed'))
      const body: unknown = await response.json()
      if (!isRecord(body)) throw new Error('Migration returned an invalid response')
    } catch (error) {
      setMigrationError(error instanceof Error ? error.message : 'Migration failed')
    } finally {
      setMigrationRunning(false)
      await onStatusRefresh()
    }
  }, [apiUrl, migrationRunning, onStatusRefresh])

  useEffect(() => {
    if (status.index.state !== 'failed') return
    setIndexError(status.index.progress?.message ?? 'Indexing failed')
  }, [status.index.progress?.message, status.index.state])

  useEffect(() => {
    if (!done || !indexResult) return
    const controller = new AbortController()
    void loadEmbeddingCount(controller.signal)
    return () => controller.abort()
  }, [done, indexResult, loadEmbeddingCount])

  return (
    <section aria-labelledby="setup-title" className="h-full overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:py-12">
        <div className="max-w-2xl">
          <Badge variant="outline" className="border-accent/40 text-foreground">Guided setup</Badge>
          <h2 id="setup-title" className="mt-4 text-3xl font-semibold tracking-tight">Set up CodeGraph</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Confirm storage, understand the embedding profile, then choose one code folder. CodeGraph indexes structure first and finishes semantic embeddings automatically.
          </p>
        </div>

        <div aria-live="polite" aria-atomic="false" className="mt-8 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><Database className="size-4 text-accent" aria-hidden="true" />1. Storage</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{storageLabel(status)}</span>
                <Badge variant="outline">{ownerLabel(status.storage.ownerState)}</Badge>
              </div>
              {status.storage.dataPath && (
                <div>
                  <span className="text-xs text-subtle">Data path</span>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="min-w-0 flex-1 overflow-x-auto rounded bg-muted px-2 py-1.5 text-xs text-muted-foreground">{status.storage.dataPath}</code>
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => {
                      void navigator.clipboard.writeText(status.storage.dataPath ?? '').catch((error: unknown) => {
                        console.warn('Unable to copy the storage path', error)
                      })
                    }}>Copy path</Button>
                  </div>
                </div>
              )}
              {status.storage.error && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{status.storage.error}</p>}
              {(status.storage.error || status.storage.ownerState === 'blocked') && (
                <Button variant="outline" size="sm" onClick={() => void onStatusRefresh()}>Retry storage</Button>
              )}
              {(status.storage.externalGuidance || status.storage.ownerState === 'blocked') && (
                <div className="rounded-md border border-amber-500/40 bg-amber-400/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                  <p>{status.storage.externalGuidance ?? 'Embedded storage is blocked. Configure external FalkorDB to continue.'}</p>
                  {!status.storage.externalGuidance && (
                    <code className="mt-2 block text-xs">CODEGRAPH_DRIVER=falkordb<br />FALKORDB_URL=redis://host:6379<br />FALKORDB_HOST=host<br />FALKORDB_PORT=6379</code>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="size-4 text-accent" aria-hidden="true" />2. Embeddings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{providerLabel(status.embedding.profile.provider)}</span>
                <Badge variant="outline">Current provider</Badge>
                <span className="text-xs text-subtle">{status.embedding.profile.dimension} dimensions</span>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {status.embedding.profile.provider === 'local'
                  ? 'Local, free, runs on this computer. The first run downloads approximately 132 MiB, then the model is cached.'
                  : status.embedding.profile.provider === 'none'
                    ? 'Structural only is an explicit opt-out. Semantic similarity search is unavailable.'
                    : status.embedding.keyPresent
                      ? `${providerLabel(status.embedding.profile.provider)} uses a configured API key for semantic search.`
                      : `${providerLabel(status.embedding.profile.provider)} needs its API key before semantic search can run.`}
              </p>
              <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                <div className="rounded border border-accent/30 bg-accent/5 p-2"><dt className="font-medium">Local</dt><dd className="mt-1 text-subtle">Free default</dd></div>
                <div className="rounded border border-border p-2"><dt className="font-medium">Voyage</dt><dd className="mt-1 text-subtle">{status.embedding.profile.provider === 'voyage' ? `VOYAGE_API_KEY: ${status.embedding.keyPresent ? 'configured' : 'not configured'}` : 'Requires VOYAGE_API_KEY'}</dd></div>
                <div className="rounded border border-border p-2"><dt className="font-medium">OpenRouter</dt><dd className="mt-1 text-subtle">{status.embedding.profile.provider === 'openrouter' ? `OPENROUTER_API_KEY: ${status.embedding.keyPresent ? 'configured' : 'not configured'}` : 'Requires OPENROUTER_API_KEY'}</dd></div>
              </dl>
              <ModelProgress status={status} />
            </CardContent>
          </Card>
        </div>

        {status.embedding.migration && (
          <Card className="mt-4 border-amber-400/40 bg-amber-400/5">
            <CardHeader className="pb-2"><CardTitle className="text-base text-amber-800 dark:text-amber-200">Embedding migration required</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm">{status.embedding.migration.remedy}</p>
              <p className="text-xs text-subtle">
                {providerLabel(status.embedding.migration.storedProfile.provider)} ({status.embedding.migration.storedProfile.dimension}) to {providerLabel(status.embedding.migration.requestedProfile.provider)} ({status.embedding.migration.requestedProfile.dimension})
              </p>
              {migrationError && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{migrationError}</p>}
              <Button onClick={() => void runMigration()} disabled={migrationRunning}>
                {migrationRunning ? 'Running migration...' : 'Run re-embed migration'}
              </Button>
            </CardContent>
          </Card>
        )}

        <Card className="mt-4">
          <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><FolderOpen className="size-4 text-accent" aria-hidden="true" />3. Choose and index a project</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <label htmlFor="setup-project-path" className="sr-only">Project path</label>
              <Input
                id="setup-project-path"
                value={path}
                onChange={(event) => setPath(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') void indexProject() }}
                placeholder="Choose a project folder"
                className="min-w-0 flex-1"
              />
              <FolderPicker apiUrl={apiUrl} open={pickerOpen} initialPath={path} onOpenChange={setPickerOpen} onSelect={setPath} />
              <Button onClick={() => void indexProject()} disabled={!path.trim() || indexing || status.storage.ownerState === 'blocked'}>
                {indexing ? 'Indexing...' : indexError ? 'Retry index' : 'Index project'}
              </Button>
            </div>
            {indexError && <p role="alert" className="text-sm text-red-700 dark:text-red-400">{indexError}</p>}
            <IndexProgress status={status} pending={indexing} />
          </CardContent>
        </Card>

        {done && (
          <Card className="mt-4 border-emerald-400/40 bg-emerald-400/5">
            <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="size-5 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />Index complete</CardTitle></CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div><dt className="text-xs text-subtle">Files</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{indexResult.stats.files.toLocaleString()}</dd></div>
                <div><dt className="text-xs text-subtle">Symbols</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{indexResult.stats.entities.toLocaleString()}</dd></div>
                <div><dt className="text-xs text-subtle">Edges</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{indexResult.stats.edges.toLocaleString()}</dd></div>
                <div>
                  <dt className="text-xs text-subtle">Embeddings</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums">
                    {embeddingCount.status === 'success'
                      ? embeddingCount.count.toLocaleString()
                      : embeddingCount.status === 'loading'
                        ? 'Loading...'
                        : embeddingCount.status === 'error'
                          ? 'Unavailable'
                          : indexResult.stats.embedded?.toLocaleString() ?? 'Loading...'}
                  </dd>
                  {embeddingCount.status === 'error' && (
                    <Button variant="ghost" size="sm" className="mt-1 h-6 px-1 text-xs" onClick={() => void loadEmbeddingCount()}>
                      Retry count
                    </Button>
                  )}
                </div>
              </dl>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button onClick={onExplore}>Explore graph</Button>
                <Button variant="outline" onClick={() => {
                  void navigator.clipboard.writeText('npx codegraph-mcp setup').catch((error: unknown) => {
                    console.warn('Unable to copy the MCP setup command', error)
                  })
                }}>Copy MCP setup command</Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  )
}
