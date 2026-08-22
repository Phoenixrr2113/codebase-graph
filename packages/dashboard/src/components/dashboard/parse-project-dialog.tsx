import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

interface ParseProjectDialogProps {
  apiUrl: string
  onProjectParsed?: (project: ParsedProject) => void
}

export interface ParsedProject {
  projectId: string
  projectName: string
}

interface ParseResult {
  success: boolean
  projectId?: string
  projectName?: string
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseSuccessfulProject(value: unknown): ParsedProject {
  if (
    !isRecord(value)
    || value.success !== true
    || typeof value.projectId !== 'string'
    || typeof value.projectName !== 'string'
  ) {
    throw new Error('Invalid parse response')
  }
  return { projectId: value.projectId, projectName: value.projectName }
}

function parseStats(value: unknown): ParseResult['stats'] {
  if (!isRecord(value)) return undefined
  const fields = ['files', 'entities', 'edges', 'errors', 'durationMs'] as const
  if (fields.some((field) => typeof value[field] !== 'number' || !Number.isFinite(value[field]))) {
    return undefined
  }
  return {
    files: value.files as number,
    entities: value.entities as number,
    edges: value.edges as number,
    errors: value.errors as number,
    durationMs: value.durationMs as number,
  }
}

interface ParseProjectFormProps {
  path: string
  loading: boolean
  result: ParseResult | null
  onPathChange: (path: string) => void
  onParse: () => void
  onCancel: () => void
}

export function ParseProjectForm({
  path,
  loading,
  result,
  onPathChange,
  onParse,
  onCancel,
}: ParseProjectFormProps) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="index-project-path" className="sr-only">Project path</label>
      <Input
        id="index-project-path"
        type="text"
        placeholder="/path/to/project"
        value={path}
        onChange={(event) => onPathChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onParse()
          if (event.key === 'Escape') onCancel()
        }}
        className="h-7 w-64 text-xs"
        autoFocus
      />
      <Button
        size="sm"
        onClick={onParse}
        disabled={!path.trim() || loading}
        className="h-7 text-xs"
      >
        {loading ? 'Indexing...' : 'Index'}
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onCancel}
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
      const data: unknown = await res.json()

      // A failed index can still arrive as a well-formed body, so the payload's
      // own verdict matters as much as the status code.
      if (!res.ok || !isRecord(data) || data.error || data.success === false) {
        setResult({
          success: false,
          error: isRecord(data) && typeof data.error === 'string'
            ? data.error
            : isRecord(data) && Array.isArray(data.errorMessages) && typeof data.errorMessages[0] === 'string'
              ? data.errorMessages[0]
              : `HTTP ${res.status}`,
        })
      } else {
        const parsedProject = parseSuccessfulProject(data)
        const stats = parseStats(data.stats)
        const errorMessages = Array.isArray(data.errorMessages)
          ? data.errorMessages.filter((message): message is string => typeof message === 'string')
          : undefined
        setResult({ success: true, ...parsedProject, stats, errorMessages })
        onProjectParsed?.(parsedProject)
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

  const closeForm = () => {
    setOpen(false)
    setResult(null)
  }

  return (
    <ParseProjectForm
      path={path}
      loading={loading}
      result={result}
      onPathChange={setPath}
      onParse={() => void handleParse()}
      onCancel={closeForm}
    />
  )
}
