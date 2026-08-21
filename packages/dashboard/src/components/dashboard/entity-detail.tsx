import { useState, useCallback, useEffect, useId, useRef } from 'react'
import type { GraphNode } from './graph-canvas'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { NODE_COLORS } from '@/lib/cytoscape-config'
import { API_URL } from '@/lib/api'
import type {
  FileRelationshipNode,
  FileRelationships,
  SymbolReference,
  SymbolReferences,
} from '@/lib/references'

export type FileRelationshipsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: FileRelationships }
  | { status: 'error'; message: string }


interface EntityDetailProps {
  node: GraphNode | null
  references?: SymbolReferences | null
  referencesLoading?: boolean
  onSelectReference?: (node: GraphNode) => void
  fileRelationshipsState?: FileRelationshipsState
}

export function EntityDetail({
  node,
  references,
  referencesLoading,
  onSelectReference,
  fileRelationshipsState,
}: EntityDetailProps) {
  const [copied, setCopied] = useState(false)

  const handleCopyPath = useCallback(() => {
    const filePath = node?.properties?.filePath as string
    if (filePath) {
      navigator.clipboard.writeText(filePath)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [node])

  const handleOpenInEditor = useCallback(() => {
    const filePath = node?.properties?.filePath as string
    const startLine = node?.properties?.startLine as number | undefined
    if (filePath) {
      window.open(`vscode://file/${filePath}${startLine ? `:${startLine}` : ''}`, '_blank')
    }
  }, [node])

  if (!node) {
    return (
      <div className="entity-detail flex h-full min-h-0 items-center justify-center border-l border-border bg-card p-4" data-testid="entity-detail">
        <div className="text-center">
          <svg className="w-10 h-10 mx-auto mb-2 text-muted-foreground/30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="3" /><circle cx="19" cy="5" r="2" /><circle cx="5" cy="5" r="2" />
            <circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" />
            <line x1="12" y1="9" x2="12" y2="5" /><line x1="14.5" y1="10.5" x2="17.5" y2="6.5" />
          </svg>
          <p className="text-sm text-muted-foreground">Select a node to view details</p>
        </div>
      </div>
    )
  }

  const props = node.properties
  const color = NODE_COLORS[node.type] ?? '#64748b'
  const filePath = props.filePath as string | undefined
  const startLine = props.startLine as number | undefined
  const endLine = props.endLine as number | undefined
  const isExported = props.isExported === true
  const isAsync = props.isAsync === true
  const isArrow = props.isArrow === true
  const isAbstract = props.isAbstract === true
  const extendsName = typeof props.extends === 'string' ? props.extends : undefined
  const docstring = props.docstring as string | undefined
  const bodySnippet = props.bodySnippet as string | undefined
  const params = props.params
  const returnType = props.returnType as string | undefined

  return (
    <div className="entity-detail flex h-full min-h-0 flex-col border-l border-border bg-card overflow-y-auto" data-testid="entity-detail">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <div className="w-3 h-3 rounded shrink-0 mt-1" style={{ backgroundColor: color }} />
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold" style={{ overflowWrap: 'anywhere' }}>
                {node.label}
              </h2>
              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                <Badge variant="secondary" className="text-xs">{node.type}</Badge>
                {isExported && <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-400/30">exported</Badge>}
                {isAsync && <Badge variant="outline" className="text-xs text-purple-400 border-purple-400/30">async</Badge>}
                {isArrow && <Badge variant="outline" className="text-xs text-sky-400 border-sky-400/30">arrow</Badge>}
              </div>
            </div>
          </div>
        </div>

        <Separator />

        {/* Location */}
        {filePath && (
          <Section title="Location" icon={<LocationIcon />}>
            <div className="rounded-lg border border-border bg-background/50 p-2.5">
              <div className="text-xs font-mono text-muted-foreground" style={{ overflowWrap: 'anywhere' }}>
                {filePath.replace(/^.*\/packages\//, 'packages/').replace(/^.*\/src\//, 'src/')}
              </div>
              {startLine != null && endLine != null && (
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                    L{startLine}–{endLine}
                  </span>
                  <span className="text-[10px] text-subtle">{endLine - startLine + 1} lines</span>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Signature */}
        {(node.type === 'Function' || node.type === 'Component') && (
          <Section title="Signature" icon={<FnIcon />}>
            <div className="rounded-lg border border-border bg-background/50 p-2.5 font-mono text-xs" style={{ overflowWrap: 'anywhere' }}>
              {isAsync && <span className="text-purple-400">async </span>}
              <span className="text-emerald-400 font-semibold">{node.label}</span>
              <span className="text-muted-foreground">(</span>
              <ParamsDisplay params={params} />
              <span className="text-muted-foreground">)</span>
              <span className="text-muted-foreground">: </span>
              <span className="text-cyan-400">{returnType ?? 'void'}</span>
            </div>
          </Section>
        )}

        {node.type === 'Class' && (
          <Section title="Signature" icon={<FnIcon />}>
            <div className="rounded-lg border border-border bg-background/50 p-2.5 font-mono text-xs" style={{ overflowWrap: 'anywhere' }}>
              {isAbstract && <span className="text-purple-400">abstract </span>}
              <span className="text-amber-400 font-semibold">class {node.label}</span>
              {extendsName && <span className="text-muted-foreground"> extends <span className="text-cyan-400">{extendsName}</span></span>}
            </div>
          </Section>
        )}

        {/* Docstring */}
        {docstring && docstring.trim() && (
          <div className="rounded-lg bg-cyan-500/5 border border-cyan-500/15 p-2.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <DocIcon />
              <span className="text-[10px] uppercase tracking-wider text-cyan-500/70 font-medium">Documentation</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed" style={{ overflowWrap: 'anywhere' }}>
              {docstring}
            </p>
          </div>
        )}

        {/* Metrics + Properties */}
        <Section title="Details" icon={<MetricIcon />}>
          <MetricsAndProperties props={props} />
        </Section>

        {/* Where this symbol is used */}
        {(referencesLoading || references) && (
          <Section title="References" icon={<ReferencesIcon />}>
            <ReferenceList
              references={references ?? null}
              loading={referencesLoading === true}
              declaringFile={filePath}
              onSelect={onSelectReference}
            />
          </Section>
        )}

        {node.type === 'File' && fileRelationshipsState && fileRelationshipsState.status !== 'idle' && (
          <Section title="File relationships" icon={<ReferencesIcon />}>
            <FileRelationshipsContent
              state={fileRelationshipsState}
              onSelect={onSelectReference}
            />
          </Section>
        )}

        {/* Code Preview with syntax highlighting */}
        {filePath && startLine != null && (
          <Section title="Code Preview">
            <CodePreview
              key={`${node.id}:${filePath}:${startLine}:${endLine ?? ''}`}
              apiUrl={API_URL}
              filePath={filePath}
              startLine={startLine}
              endLine={endLine}
              nodeId={node.id}
            />
          </Section>
        )}

        {!filePath && bodySnippet && (
          <Section title="Code">
            <div className="bg-background rounded-lg border border-border overflow-hidden">
              <pre className="text-xs font-mono p-3 overflow-x-auto max-h-[250px] overflow-y-auto">
                <code className="text-muted-foreground">{bodySnippet}</code>
              </pre>
            </div>
          </Section>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-2">
          {filePath && (
            <>
              <Button variant="outline" size="sm" className="text-xs h-7" onClick={handleOpenInEditor}>
                Open in Editor
              </Button>
              <Button
                variant="outline"
                size="sm"
                className={`text-xs h-7 ${copied ? 'text-emerald-400 border-emerald-400/50' : ''}`}
                onClick={handleCopyPath}
              >
                {copied ? 'Copied!' : 'Copy Path'}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// --- Helper Components ---

function Section({ title, children, defaultCollapsed = false, icon }: { title: string; children: React.ReactNode; defaultCollapsed?: boolean; icon?: React.ReactNode }) {
  const [open, setOpen] = useState(!defaultCollapsed)
  const contentId = useId()

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex items-center justify-between w-full group py-0.5"
      >
        <div className="flex items-center gap-1.5">
          {icon && <span className="text-muted-foreground/40">{icon}</span>}
          <h3 className="text-[11px] font-medium text-subtle uppercase tracking-wider">{title}</h3>
        </div>
        <svg
          className={`w-3.5 h-3.5 text-muted-foreground/30 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div id={contentId} className="mt-2">{children}</div>}
    </div>
  )
}

function ParamsDisplay({ params }: { params: unknown }) {
  const parsed = parseParams(params)
  if (parsed.length === 0) return null
  return (
    <>
      {parsed.map((p, i) => (
        <span key={i}>
          {i > 0 && <span className="text-muted-foreground">, </span>}
          <span className="text-orange-300">{p.name}</span>
          {p.type && <span className="text-muted-foreground/60">: <span className="text-cyan-400">{p.type}</span></span>}
        </span>
      ))}
    </>
  )
}

function MetricsAndProperties({ props }: { props: Record<string, unknown> }) {
  const complexity = props.complexity as number | undefined
  const cognitiveComplexity = props.cognitiveComplexity as number | undefined
  const nestingDepth = props.nestingDepth as number | undefined
  const callerCount = props.callerCount as number | undefined
  const importerCount = props.importerCount as number | undefined
  const params = props.params

  // Metric pills with inline styles (Tailwind can't handle dynamic class names)
  const metrics: Array<{ label: string; value: string | number; style: { color: string; background: string; borderColor: string } }> = []
  if (complexity != null) {
    const s = complexity > 10
      ? { color: '#f87171', background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.2)' }
      : complexity > 5
      ? { color: '#facc15', background: 'rgba(234,179,8,0.1)', borderColor: 'rgba(234,179,8,0.2)' }
      : { color: '#34d399', background: 'rgba(16,185,129,0.1)', borderColor: 'rgba(16,185,129,0.2)' }
    metrics.push({ label: 'Complexity', value: complexity, style: s })
  }
  if (cognitiveComplexity != null) {
    const s = cognitiveComplexity > 15
      ? { color: '#f87171', background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.2)' }
      : cognitiveComplexity > 5
      ? { color: '#facc15', background: 'rgba(234,179,8,0.1)', borderColor: 'rgba(234,179,8,0.2)' }
      : { color: '#a1a1aa', background: 'rgba(161,161,170,0.08)', borderColor: 'rgba(161,161,170,0.15)' }
    metrics.push({ label: 'Cognitive', value: cognitiveComplexity, style: s })
  }
  if (nestingDepth != null) metrics.push({ label: 'Depth', value: nestingDepth, style: { color: '#a1a1aa', background: 'rgba(161,161,170,0.08)', borderColor: 'rgba(161,161,170,0.15)' } })
  if (callerCount != null) metrics.push({ label: 'Callers', value: callerCount, style: { color: '#60a5fa', background: 'rgba(59,130,246,0.1)', borderColor: 'rgba(59,130,246,0.2)' } })
  if (importerCount != null) metrics.push({ label: 'Importers', value: importerCount, style: { color: '#818cf8', background: 'rgba(99,102,241,0.1)', borderColor: 'rgba(99,102,241,0.2)' } })

  // Params as structured list
  const parsedParams = parseParams(params)

  // Other props
  const skipKeys = new Set(['id', 'label', 'type', 'filePath', 'startLine', 'endLine', 'isExported', 'isAsync', 'isArrow', 'docstring', 'bodySnippet', 'signature', 'embedding', 'complexity', 'cognitiveComplexity', 'nestingDepth', 'callerCount', 'importerCount', 'params', 'returnType', 'name'])
  const otherProps = Object.entries(props).filter(([key, value]) => !skipKeys.has(key) && value != null && value !== '' && value !== '{}')

  return (
    <div className="space-y-3">
      {/* Metric pills */}
      {metrics.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {metrics.map((m) => (
            <span
              key={m.label}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium"
              style={{ color: m.style.color, backgroundColor: m.style.background, borderColor: m.style.borderColor }}
            >
              <span>{m.label}</span>
              <span className="font-bold">{m.value}</span>
            </span>
          ))}
        </div>
      )}

      {/* Parameters */}
      {parsedParams.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-subtle mb-1.5">Parameters</div>
          <div className="space-y-1 pl-0.5">
            {parsedParams.map((p, i) => (
              <div key={i} className="flex items-baseline gap-1.5 text-xs">
                <span className="text-orange-300 font-mono">{p.name}</span>
                {p.type && (
                  <>
                    <span className="text-muted-foreground/30">:</span>
                    <span className="text-cyan-400/80 font-mono text-[11px]">{p.type}</span>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Other properties */}
      {otherProps.length > 0 && (
        <div className="space-y-1">
          {otherProps.map(([key, value]) => (
            <div key={key} className="flex items-baseline justify-between gap-2 text-xs">
              <span className="text-subtle">{key}</span>
              <span className="text-muted-foreground font-mono text-[11px] text-right truncate max-w-[60%]">
                {typeof value === 'boolean'
                  ? <span className={value ? 'text-emerald-400' : 'text-subtle'}>{String(value)}</span>
                  : String(value)}
              </span>
            </div>
          ))}
        </div>
      )}

      {metrics.length === 0 && parsedParams.length === 0 && otherProps.length === 0 && (
        <div className="text-xs text-subtle italic">No additional properties</div>
      )}
    </div>
  )
}

function parseParams(params: unknown): Array<{ name: string; type?: string }> {
  if (!params) return []
  let parsed = params
  if (typeof params === 'string') {
    try { parsed = JSON.parse(params) } catch { return [] }
  }
  if (!Array.isArray(parsed)) return []
  return parsed.map((p: { name: string; type?: string }) => ({ name: p.name, type: p.type }))
}

// Section icons (tiny inline SVGs)
function LocationIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
}
function FnIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="4,17 10,11 4,5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
}
function DocIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/></svg>
}
function MetricIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
}

function CodePreview({ apiUrl, filePath, startLine, endLine, nodeId }: {
  apiUrl: string
  filePath: string
  startLine: number
  endLine?: number
  nodeId: string
}) {
  const [lines, setLines] = useState<Array<{ number: number; content: string }> | null>(null)
  const [highlightedHtml, setHighlightedHtml] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [entityStart, setEntityStart] = useState(startLine)
  const [entityEnd, setEntityEnd] = useState(endLine ?? startLine)
  const highlightRef = useRef<HTMLDivElement>(null)

  // Fetch source code
  useEffect(() => {
    const el = endLine ?? startLine
    fetch(`${apiUrl}/api/source?path=${encodeURIComponent(filePath)}&startLine=${startLine}&endLine=${el}&context=5`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.lines) {
          setLines(data.lines)
          setEntityStart(data.entityStartLine ?? startLine)
          setEntityEnd(data.entityEndLine ?? el)

          // Syntax highlight with shiki
          const ext = filePath.split('.').pop()?.toLowerCase() ?? 'text'
          const langMap: Record<string, string> = {
            ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
            py: 'python', go: 'go', rs: 'rust', css: 'css', json: 'json',
            html: 'html', md: 'markdown', yaml: 'yaml', yml: 'yaml',
          }
          const lang = langMap[ext] ?? 'text'
          const fullCode = data.lines.map((l: { content: string }) => l.content).join('\n')

          // Loaded on demand: keeps the syntax highlighter out of the initial bundle.
          import('@/lib/highlighter').then(({ highlightCode }) => highlightCode(fullCode, lang)).then(html => {
            if (html === null) {
              setHighlightedHtml(null)
              return
            }
            const parser = new DOMParser()
            const doc = parser.parseFromString(html, 'text/html')
            const lineSpans = doc.querySelectorAll('.line')
            const htmlLines: string[] = []
            lineSpans.forEach(span => htmlLines.push(span.innerHTML))
            setHighlightedHtml(htmlLines)
          }).catch(() => setHighlightedHtml(null))
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [apiUrl, filePath, startLine, endLine, nodeId])

  // Scroll to highlighted entity
  useEffect(() => {
    if (highlightRef.current) {
      requestAnimationFrame(() => {
        highlightRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      })
    }
  }, [highlightedHtml, nodeId])

  if (loading) {
    return <div className="text-xs text-subtle animate-pulse p-3">Loading code...</div>
  }

  if (!lines || lines.length === 0) {
    return <div className="text-xs text-subtle italic p-3">No source code available</div>
  }

  const useHighlighting = highlightedHtml != null && highlightedHtml.length === lines.length

  return (
    <div className="bg-background rounded-lg border border-border overflow-hidden">
      <div className="max-h-[350px] overflow-y-auto overflow-x-auto">
        <pre className="text-xs min-w-max font-mono">
          <code>
            {lines.map((line, idx) => {
              const isEntity = line.number >= entityStart && line.number <= entityEnd
              const isFirst = line.number === entityStart
              return (
                <div
                  key={line.number}
                  ref={isFirst ? highlightRef : undefined}
                  style={isEntity ? { backgroundColor: 'rgba(99, 102, 241, 0.15)', borderLeft: '3px solid #6366f1' } : undefined}
                  className={`flex ${isEntity ? '' : 'hover:bg-accent/30'}`}
                >
                  <span
                    style={isEntity ? { color: '#818cf8', fontWeight: 600 } : { color: '#a1a1aa' }}
                    className="w-10 shrink-0 text-right pr-3 select-none border-r border-border"
                  >
                    {line.number}
                  </span>
                  {useHighlighting ? (
                    <span
                      className="pl-3 whitespace-pre [&>span]:!bg-transparent"
                      dangerouslySetInnerHTML={{ __html: highlightedHtml[idx] ?? '' }}
                    />
                  ) : (
                    <span className="pl-3 text-muted-foreground whitespace-pre">{line.content}</span>
                  )}
                </div>
              )
            })}
          </code>
        </pre>
      </div>
    </div>
  )
}

export default EntityDetail


function ReferencesIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
    </svg>
  )
}

/** Short label per edge kind, so a row reads as a sentence about the symbol. */
const EDGE_LABELS: Record<SymbolReference['edgeType'], string> = {
  CALLS: 'calls',
  USES_TYPE: 'uses type',
  EXTENDS: 'extends',
  IMPLEMENTS: 'implements',
  RENDERS: 'renders',
}

function shortenPath(filePath: string, declaringFile?: string): string {
  if (!filePath) return 'unknown file'
  if (declaringFile) {
    // Trim the shared prefix so the part that differs is what the reader sees.
    const a = filePath.split('/')
    const b = declaringFile.split('/')
    let i = 0
    while (i < a.length - 1 && i < b.length - 1 && a[i] === b[i]) i++
    if (i > 0) return a.slice(i).join('/')
  }
  return filePath.split('/').slice(-2).join('/')
}

function ReferenceList({ references, loading, declaringFile, onSelect }: {
  references: SymbolReferences | null
  loading: boolean
  declaringFile?: string
  onSelect?: (node: GraphNode) => void
}) {
  if (loading) {
    return <p className="text-xs text-muted-foreground">Looking for usages...</p>
  }
  if (!references || references.references.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Nothing in the index uses this symbol.
      </p>
    )
  }

  const elsewhere = references.references.filter((r) => !r.sameFile)
  const sameFile = references.references.filter((r) => r.sameFile)
  const fileCount = references.referencingFiles.length

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {references.references.length} usage{references.references.length === 1 ? '' : 's'}
        {fileCount > 0 && ` across ${fileCount} other file${fileCount === 1 ? '' : 's'}`}
        {references.truncated && ' (showing the first page)'}
      </p>

      {elsewhere.length > 0 && (
        <ReferenceGroup
          label="Other files"
          items={elsewhere}
          declaringFile={declaringFile}
          onSelect={onSelect}
        />
      )}
      {sameFile.length > 0 && (
        <ReferenceGroup
          label="Same file"
          items={sameFile}
          declaringFile={declaringFile}
          onSelect={onSelect}
        />
      )}
    </div>
  )
}

function ReferenceGroup({ label, items, declaringFile, onSelect }: {
  label: string
  items: SymbolReference[]
  declaringFile?: string
  onSelect?: (node: GraphNode) => void
}) {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-medium uppercase tracking-wide text-subtle">
        {label}
      </p>
      <ul className="space-y-1">
        {items.map((ref) => (
          <li key={`${ref.id}:${ref.edgeType}`}>
            <button
              type="button"
              className="w-full rounded-md border border-border/60 bg-background px-2 py-1.5 text-left transition-colors hover:border-border hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onSelect?.(symbolReferenceToGraphNode(ref))}
            >
              <span className="flex items-baseline gap-1.5">
                <span className="truncate font-mono text-xs text-foreground">{ref.name}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {EDGE_LABELS[ref.edgeType]}
                </span>
              </span>
              <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                {shortenPath(ref.filePath, declaringFile)}
                {ref.startLine != null && `:${ref.startLine}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function symbolReferenceToGraphNode(ref: SymbolReference): GraphNode {
  return {
    id: ref.id,
    label: ref.name,
    type: ref.nodeType,
    properties: {
      name: ref.name,
      nodeType: ref.nodeType,
      filePath: ref.filePath,
      ...(ref.startLine != null ? { startLine: ref.startLine } : {}),
    },
  }
}

export function relationshipNodeToGraphNode(node: FileRelationshipNode): GraphNode {
  return {
    id: node.id,
    label: node.displayName,
    type: node.label,
    properties: {
      ...node.data,
      ...(node.filePath !== undefined ? { filePath: node.filePath } : {}),
    },
  }
}

const FILE_RELATIONSHIP_GROUPS: ReadonlyArray<{
  key: keyof Pick<FileRelationships, 'containedSymbols' | 'imports' | 'importers' | 'knowledgeEntities'>
  label: string
}> = [
  { key: 'containedSymbols', label: 'Contained symbols' },
  { key: 'imports', label: 'Imports' },
  { key: 'importers', label: 'Importers' },
  { key: 'knowledgeEntities', label: 'Knowledge entities' },
]

export function FileRelationshipsContent({
  state,
  onSelect,
}: {
  state: FileRelationshipsState
  onSelect?: (node: GraphNode) => void
}) {
  if (state.status === 'idle') return null
  if (state.status === 'loading') {
    return <p role="status" className="text-xs text-muted-foreground">Loading file relationships...</p>
  }
  if (state.status === 'error') {
    return <p role="alert" className="text-xs text-red-400">{state.message}</p>
  }

  return (
    <div className="space-y-3">
      {FILE_RELATIONSHIP_GROUPS.map((group) => {
        const items = state.data[group.key]
        return (
          <div key={group.key} className="space-y-1">
            <h4 className="text-[10px] font-medium uppercase tracking-wide text-subtle">
              {group.label}
            </h4>
            {items.length === 0 ? (
              <p className="text-xs text-subtle">Nothing found</p>
            ) : (
              <ul className="space-y-1">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="w-full rounded-md border border-border/60 bg-background px-2 py-1.5 text-left transition-colors hover:border-border hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => onSelect?.(relationshipNodeToGraphNode(item))}
                    >
                      <span className="block truncate font-mono text-xs text-foreground">
                        {item.displayName}
                      </span>
                      <span className="mt-0.5 block truncate text-[10px] text-subtle">
                        {item.label}
                        {item.filePath ? ` in ${shortenPath(item.filePath, state.data.filePath)}` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}
