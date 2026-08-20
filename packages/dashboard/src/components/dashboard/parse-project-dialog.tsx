import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

interface ParseProjectDialogProps {
  apiUrl: string
  onProjectParsed?: () => void
}

interface ParseResult {
  success: boolean
  stats?: {
    files: number
    entities: number
    edges: number
    errors: number
    durationMs: number
  }
  errorMessages?: string[]
  error?: string
}

export function ParseProjectDialog({ apiUrl, onProjectParsed }: ParseProjectDialogProps) {
  const [open, setOpen] = useState(false)
  const [path, setPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ParseResult | null>(null)

  const handleParse = useCallback(async () => {
    const trimmed = path.trim()
    if (!trimmed) return

    setLoading(true)
    setResult(null)

    try {
      const res = await fetch(`${apiUrl}/api/parse/project`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: trimmed }),
      })
      const data = await res.json()

      // A failed index can still arrive as a well-formed body, so the payload's
      // own verdict matters as much as the status code.
      if (!res.ok || data.error || data.success === false) {
        setResult({
          success: false,
          error: data.error ?? data.errorMessages?.[0] ?? `HTTP ${res.status}`,
        })
      } else {
        setResult({ success: true, stats: data.stats, errorMessages: data.errorMessages })
        onProjectParsed?.()
      }
    } catch (err) {
      setResult({ success: false, error: err instanceof Error ? err.message : 'Parse failed' })
    } finally {
      setLoading(false)
    }
  }, [path, apiUrl, onProjectParsed])

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-7 text-xs"
      >
        Index Project
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        type="text"
        placeholder="/path/to/project"
        value={path}
        onChange={(e) => setPath(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleParse()
          if (e.key === 'Escape') { setOpen(false); setResult(null) }
        }}
        className="h-7 w-64 text-xs"
        autoFocus
      />
      <Button
        size="sm"
        onClick={handleParse}
        disabled={!path.trim() || loading}
        className="h-7 text-xs"
      >
        {loading ? 'Indexing...' : 'Index'}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => { setOpen(false); setResult(null) }}
        className="h-7 text-xs"
      >
        Cancel
      </Button>
      {result && (
        result.success ? (
          <Badge variant="outline" className="text-[10px] text-emerald-400 border-emerald-400/30">
            {result.stats?.files} files, {result.stats?.entities} symbols ({((result.stats?.durationMs ?? 0) / 1000).toFixed(1)}s)
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px] text-red-400 border-red-400/30">
            {result.error}
          </Badge>
        )
      )}
    </div>
  )
}
