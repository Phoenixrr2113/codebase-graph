'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

interface QueryPanelProps {
  apiUrl: string
}

export function QueryPanel({ apiUrl }: QueryPanelProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<unknown[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [durationMs, setDurationMs] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const handleExecute = useCallback(async () => {
    const trimmed = query.trim()
    if (!trimmed) return

    setLoading(true)
    setError(null)
    setResults(null)
    setDurationMs(null)

    const start = Date.now()
    try {
      const res = await fetch(`${apiUrl}/api/query/cypher`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed, params: {} }),
      })
      const data = await res.json()
      setDurationMs(Date.now() - start)

      if (!res.ok || data.error) {
        setError(data.error ?? `HTTP ${res.status}`)
      } else {
        setResults(data.results ?? [])
      }
    } catch (err) {
      setDurationMs(Date.now() - start)
      setError(err instanceof Error ? err.message : 'Query failed')
    } finally {
      setLoading(false)
    }
  }, [query, apiUrl])

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

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-border bg-card">
      {/* Header */}
      <div className="shrink-0 border-b border-border p-3">
        <div className="mb-2 flex items-center gap-2">
          <Badge variant="outline" className="text-[10px]">Cypher</Badge>
          <span className="text-xs text-muted-foreground">Read-only queries</span>
        </div>

        <textarea
          ref={textareaRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="MATCH (n:Function) RETURN n.name LIMIT 10"
          className="w-full h-20 px-3 py-2 text-sm font-mono bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
        />

        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">
            Ctrl+Enter to run
          </span>
          <Button
            onClick={handleExecute}
            disabled={!query.trim() || loading}
            size="sm"
            className="h-7 text-xs"
          >
            {loading ? 'Running...' : 'Execute'}
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
            <div className="flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {results.length} result{results.length !== 1 ? 's' : ''}
                {durationMs != null && <span className="ml-2 text-muted-foreground/60">{durationMs}ms</span>}
              </div>
              <button
                onClick={handleCopy}
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors ${
                  copied
                    ? 'text-emerald-400 bg-emerald-500/10'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                }`}
              >
                {copied ? 'Copied' : 'Copy JSON'}
              </button>
            </div>
            {results.length > 0 ? (
              <pre className="text-xs text-foreground/80 font-mono bg-background p-3 rounded border border-border overflow-x-auto">
                {JSON.stringify(results, null, 2)}
              </pre>
            ) : (
              <div className="text-xs text-muted-foreground text-center py-4">
                Query returned no results
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground text-center py-8">
            Execute a query to see results
          </div>
        )}
      </div>
    </div>
  )
}
