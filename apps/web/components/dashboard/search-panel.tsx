'use client'

import { useState, useCallback } from 'react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

interface SearchResult {
  name: string
  nodeType: string
  filePath?: string
  callerCount?: number
  importerCount?: number
}

interface SearchPanelProps {
  apiUrl: string
  onHighlight: (names: string[]) => void
  onSelectResult: (name: string) => void
}

export function SearchPanel({ apiUrl, onHighlight, onSelectResult }: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [total, setTotal] = useState(0)

  const handleSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      setTotal(0)
      onHighlight([])
      return
    }

    setSearching(true)
    try {
      const res = await fetch(`${apiUrl}/api/search?q=${encodeURIComponent(q)}&limit=30`)
      if (!res.ok) throw new Error(`${res.status}`)
      const data = await res.json()
      const hits = data.results ?? []
      setResults(hits)
      setTotal(data.total ?? hits.length)
      onHighlight(hits.map((r: SearchResult) => r.name))
    } catch {
      setResults([])
      setTotal(0)
    } finally {
      setSearching(false)
    }
  }, [apiUrl, onHighlight])

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-border bg-card">
      <div className="border-b border-border p-3">
        <Input
          type="search"
          placeholder="Search code..."
          data-testid="search-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            // Debounce-ish: search on each keystroke after 2 chars
            if (e.target.value.length >= 2) {
              handleSearch(e.target.value)
            } else if (e.target.value.length === 0) {
              handleSearch('')
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSearch(query)
          }}
          className="h-8 text-sm"
        />
        {total > 0 && (
          <div className="mt-1 text-xs text-muted-foreground">{total} results</div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {searching && (
          <div className="p-3 text-xs text-muted-foreground">Searching...</div>
        )}
        {results.map((r, i) => (
          <button
            key={`${r.name}-${i}`}
            className="w-full border-b border-border/50 px-3 py-2 text-left transition-colors hover:bg-accent/50"
            onClick={() => onSelectResult(r.name)}
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
