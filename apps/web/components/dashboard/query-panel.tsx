'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

type QueryMode = 'cypher' | 'search' | 'natural'

interface QueryPanelProps {
  apiUrl: string
}

interface ResultItem {
  name: string
  type: string
  source?: string
  score?: number
  filePath?: string
  [key: string]: unknown
}

export function QueryPanel({ apiUrl }: QueryPanelProps) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<QueryMode>('cypher')
  const [results, setResults] = useState<unknown[] | null>(null)
  const [meta, setMeta] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [durationMs, setDurationMs] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [mode])

  const handleExecute = useCallback(async () => {
    const trimmed = query.trim()
    if (!trimmed) return

    setLoading(true)
    setError(null)
    setResults(null)
    setMeta(null)
    setDurationMs(null)

    const start = Date.now()
    try {
      let res: Response
      let data: Record<string, unknown>

      if (mode === 'cypher') {
        res = await fetch(`${apiUrl}/api/query/cypher`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: trimmed, params: {} }),
        })
        data = await res.json()
        setDurationMs(Date.now() - start)
        if (!res.ok || data.error) {
          setError(data.error as string ?? `HTTP ${res.status}`)
        } else {
          setResults(data.results as unknown[] ?? [])
        }
      } else if (mode === 'search') {
        res = await fetch(`${apiUrl}/api/search?q=${encodeURIComponent(trimmed)}&limit=20`)
        data = await res.json()
        setDurationMs(data.durationMs as number ?? Date.now() - start)
        if (!res.ok || data.error) {
          setError(data.error as string ?? `HTTP ${res.status}`)
        } else {
          setResults(data.results as unknown[] ?? [])
          setMeta({ total: data.total })
        }
      } else {
        // Natural language
        res = await fetch(`${apiUrl}/api/query/natural`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: trimmed }),
        })
        data = await res.json()
        setDurationMs(data.durationMs as number ?? Date.now() - start)
        if (!res.ok || data.error) {
          setError(data.error as string ?? `HTTP ${res.status}`)
        } else {
          setResults(data.results as unknown[] ?? [])
          setMeta({
            routedTo: data.routedTo,
            iterations: data.iterations,
            queries: data.queries,
            total: data.total,
          })
        }
      }
    } catch (err) {
      setDurationMs(Date.now() - start)
      setError(err instanceof Error ? err.message : 'Query failed')
    } finally {
      setLoading(false)
    }
  }, [query, mode, apiUrl])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        handleExecute()
      }
    },
    [handleExecute],
  )

  const handleCopy = useCallback(async () => {
    if (!results) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(results, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard can fail */ }
  }, [results])

  const placeholders: Record<QueryMode, string> = {
    cypher: 'MATCH (n:Function) RETURN n.name LIMIT 10',
    search: 'createUser authentication handler',
    natural: 'What functions call createOrder? Why does payment retry 3 times?',
  }

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-border bg-card">
      {/* Header with mode tabs */}
      <div className="shrink-0 border-b border-border p-3">
        <div className="mb-2 flex items-center gap-1">
          {([
            { value: 'cypher' as const, label: 'Cypher', desc: 'Raw graph queries' },
            { value: 'search' as const, label: 'Search', desc: 'Code symbol search' },
            { value: 'natural' as const, label: 'Ask', desc: 'Natural language' },
          ]).map((m) => (
            <button
              key={m.value}
              onClick={() => { setMode(m.value); setResults(null); setError(null); setMeta(null) }}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                mode === m.value
                  ? 'bg-primary/20 text-primary font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
              }`}
              title={m.desc}
            >
              {m.label}
            </button>
          ))}
          <span className="ml-2 text-[10px] text-muted-foreground">
            {mode === 'cypher' && 'Read-only Cypher queries'}
            {mode === 'search' && 'Vector + reranker search'}
            {mode === 'natural' && 'Auto-routes to best strategy (unified or chain-of-thought)'}
          </span>
        </div>

        <textarea
          ref={textareaRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholders[mode]}
          className="w-full h-16 px-3 py-2 text-sm font-mono bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
        />

        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            {mode === 'cypher' ? 'Ctrl+Enter to run' : 'Ctrl+Enter or press Enter'}
          </span>
          <Button
            onClick={handleExecute}
            disabled={!query.trim() || loading}
            size="sm"
            className="h-7 text-xs"
          >
            {loading ? 'Running...' : mode === 'natural' ? 'Ask' : 'Execute'}
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="shrink-0 border-b border-border bg-red-500/10 p-3">
          <div className="text-sm text-red-400">{error}</div>
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-auto p-3">
        {results !== null ? (
          <div className="space-y-2">
            {/* Meta info (routing, iterations) */}
            {meta?.routedTo && (
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <Badge variant="outline" className="text-[10px]">{meta.routedTo as string}</Badge>
                {meta.iterations && <span>{meta.iterations as number} iterations</span>}
                {durationMs != null && <span>{durationMs}ms</span>}
              </div>
            )}
            {meta?.queries && (meta.queries as string[]).length > 1 && (
              <div className="text-[10px] text-muted-foreground/70">
                Queries: {(meta.queries as string[]).map((q, i) => (
                  <span key={i}>{i > 0 && ' → '}<span className="text-muted-foreground">{q}</span></span>
                ))}
              </div>
            )}

            {/* Result count + copy */}
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {results.length} result{results.length !== 1 ? 's' : ''}
                {durationMs != null && !meta?.routedTo && <span className="ml-2 text-muted-foreground/60">{durationMs}ms</span>}
              </div>
              <button
                onClick={handleCopy}
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                  copied ? 'text-emerald-400 bg-emerald-500/10' : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}
              >
                {copied ? 'Copied' : 'Copy JSON'}
              </button>
            </div>

            {/* Render results based on mode */}
            {results.length > 0 ? (
              mode === 'cypher' ? (
                <pre className="text-xs text-foreground/80 font-mono bg-background p-3 rounded border border-border overflow-x-auto max-h-[300px]">
                  {JSON.stringify(results, null, 2)}
                </pre>
              ) : (
                <div className="space-y-1">
                  {(results as ResultItem[]).map((r, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-md border border-border/50 px-3 py-1.5 hover:bg-accent/30 transition-colors">
                      <Badge variant="outline" className="text-[10px] shrink-0">{r.nodeType ?? r.type}</Badge>
                      {r.source && <Badge variant="outline" className="text-[9px] shrink-0 text-muted-foreground">{r.source}</Badge>}
                      <span className="text-sm font-medium truncate">{r.name}</span>
                      {r.filePath && (
                        <span className="ml-auto text-[10px] text-muted-foreground truncate max-w-[200px]">
                          {(r.filePath as string).replace(/^.*\/packages\//, '').replace(/^.*\/apps\//, '')}
                        </span>
                      )}
                      {r.score != null && (
                        <span className="text-[10px] text-muted-foreground/60 shrink-0">
                          {(r.score as number).toFixed(3)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )
            ) : (
              <div className="text-xs text-muted-foreground text-center py-4">
                Query returned no results
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground text-center py-6">
            {mode === 'cypher' && 'Enter a Cypher query and press Execute'}
            {mode === 'search' && 'Search for code symbols by name or description'}
            {mode === 'natural' && 'Ask a question in plain English — it will auto-route to the best search strategy'}
          </div>
        )}
      </div>
    </div>
  )
}
