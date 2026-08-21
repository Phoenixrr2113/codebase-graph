import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

export interface SearchResult {
  id?: string
  name: string
  nodeType: string
  filePath?: string
  callerCount?: number
  importerCount?: number
  // The search endpoint returns the full node payload (startLine, docstring,
  // params and so on). Those extra fields are what the detail panel renders.
  [key: string]: unknown
}

export interface SearchResponseResult extends SearchResult {
  id: string
}

interface SearchPanelProps {
  apiUrl: string
  onHighlight: (nodeIds: string[]) => void
  onSelectResult: (result: SearchResponseResult) => void
}

interface SearchRequestManagerOptions {
  apiUrl: string
  fetchImpl?: typeof fetch
  onResults: (results: SearchResponseResult[]) => void
  onTotal: (total: number) => void
  onHighlight: (nodeIds: string[]) => void
  onSearching: (searching: boolean) => void
  onError: (error: string | null) => void
}

export interface SearchRequestManager {
  searchAfterDelay: (query: string) => void
  searchNow: (query: string) => void
  dispose: () => void
}

const SEARCH_DEBOUNCE_MS = 250

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError'
}

function parseSearchResponse(value: unknown): { results: SearchResponseResult[]; total: number } {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Search returned an invalid response')
  }

  const response = value as Record<string, unknown>
  if (!Array.isArray(response.results)) {
    throw new Error('Search returned an invalid response')
  }

  const validResults = response.results.every((item) => (
    typeof item === 'object'
    && item !== null
    && typeof (item as Record<string, unknown>).id === 'string'
    && typeof (item as Record<string, unknown>).name === 'string'
    && typeof (item as Record<string, unknown>).nodeType === 'string'
  ))
  if (!validResults) throw new Error('Search returned an invalid response')
  const results = response.results as SearchResponseResult[]
  const total = typeof response.total === 'number' && Number.isFinite(response.total)
    ? response.total
    : results.length

  return { results, total }
}

export function createSearchRequestManager({
  apiUrl,
  fetchImpl = fetch,
  onResults,
  onTotal,
  onHighlight,
  onSearching,
  onError,
}: SearchRequestManagerOptions): SearchRequestManager {
  let generation = 0
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let activeController: AbortController | null = null

  const clearDebounce = (): void => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  const cancelActiveRequest = (): void => {
    activeController?.abort()
    activeController = null
  }

  const execute = async (query: string, requestGeneration: number): Promise<void> => {
    const controller = new AbortController()
    activeController = controller
    onSearching(true)
    onError(null)

    try {
      const response = await fetchImpl(
        `${apiUrl}/api/search?q=${encodeURIComponent(query)}&limit=30`,
        { signal: controller.signal },
      )
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = parseSearchResponse(await response.json())
      if (requestGeneration !== generation) return

      onResults(data.results)
      onTotal(data.total)
      onHighlight(data.results.map((result) => result.id))
    } catch (error) {
      if (requestGeneration !== generation || isAbortError(error)) return
      onError('Search failed. Please try again.')
    } finally {
      if (requestGeneration === generation) {
        onSearching(false)
        if (activeController === controller) activeController = null
      }
    }
  }

  const prepare = (query: string): { trimmed: string; requestGeneration: number } => {
    generation += 1
    clearDebounce()
    cancelActiveRequest()
    onError(null)
    return { trimmed: query.trim(), requestGeneration: generation }
  }

  const clearVisibleSearch = (): void => {
    onSearching(false)
    onError(null)
    onResults([])
    onTotal(0)
    onHighlight([])
  }

  return {
    searchAfterDelay(query: string): void {
      const { trimmed, requestGeneration } = prepare(query)
      if (trimmed.length < 2) {
        clearVisibleSearch()
        return
      }

      debounceTimer = setTimeout(() => {
        debounceTimer = null
        void execute(trimmed, requestGeneration)
      }, SEARCH_DEBOUNCE_MS)
    },
    searchNow(query: string): void {
      const { trimmed, requestGeneration } = prepare(query)
      if (!trimmed) {
        clearVisibleSearch()
        return
      }
      void execute(trimmed, requestGeneration)
    },
    dispose(): void {
      generation += 1
      clearDebounce()
      cancelActiveRequest()
    },
  }
}

export function SearchPanel({ apiUrl, onHighlight, onSelectResult }: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResponseResult[]>([])
  const [searching, setSearching] = useState(false)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const requestManagerRef = useRef<SearchRequestManager | null>(null)

  useEffect(() => {
    const manager = createSearchRequestManager({
      apiUrl,
      onResults: setResults,
      onTotal: setTotal,
      onHighlight,
      onSearching: setSearching,
      onError: setError,
    })
    requestManagerRef.current = manager
    return () => {
      manager.dispose()
      if (requestManagerRef.current === manager) requestManagerRef.current = null
    }
  }, [apiUrl, onHighlight])

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-border bg-card">
      <div className="border-b border-border p-3">
        <Input
          type="search"
          aria-label="Search code"
          placeholder="Search code..."
          data-testid="search-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            requestManagerRef.current?.searchAfterDelay(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') requestManagerRef.current?.searchNow(query)
          }}
          className="h-8 text-sm"
        />
        <div
          role="status"
          aria-live="polite"
          className={searching || total > 0 ? 'mt-1 text-xs text-muted-foreground' : 'sr-only'}
        >
          {searching ? 'Searching...' : total > 0 ? `${total} results` : ''}
        </div>
        <div role="alert" className={error ? 'mt-1 text-xs text-red-400' : 'sr-only'}>
          {error ?? ''}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {results.map((r) => (
          <button
            key={r.id}
            className="w-full border-b border-border/50 px-3 py-2 text-left transition-colors hover:bg-accent/50"
            onClick={() => onSelectResult(r)}
          >
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] font-normal">
                {r.nodeType}
              </Badge>
              <span className="truncate text-sm font-medium">{r.name}</span>
            </div>
            {r.filePath && (
              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                {r.filePath.replace(/^.*\/packages\//, 'packages/').replace(/^.*\/apps\//, 'apps/')}
              </div>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
