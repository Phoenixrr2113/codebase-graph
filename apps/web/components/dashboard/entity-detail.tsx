'use client'

import { useState, useCallback, useEffect, useRef } from 'react'
import type { GraphNode } from './graph-canvas'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { NODE_COLORS } from '@/lib/cytoscape-config'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

interface EntityDetailProps {
  node: GraphNode | null
}

export function EntityDetail({ node }: EntityDetailProps) {
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
  const docstring = props.docstring as string | undefined
  const bodySnippet = props.bodySnippet as string | undefined
  const signature = props.signature as string | undefined
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
                  <span className="text-[10px] text-muted-foreground/50">{endLine - startLine + 1} lines</span>
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
              {props.isAbstract && <span className="text-purple-400">abstract </span>}
              <span className="text-amber-400 font-semibold">class {node.label}</span>
              {props.extends && <span className="text-muted-foreground"> extends <span className="text-cyan-400">{String(props.extends)}</span></span>}
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

        {/* Code Preview with syntax highlighting */}
        {filePath && startLine != null && (
          <Section title="Code Preview">
            <CodePreview
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

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full group py-0.5"
      >
        <div className="flex items-center gap-1.5">
          {icon && <span className="text-muted-foreground/40">{icon}</span>}
          <h3 className="text-[11px] font-medium text-muted-foreground/70 uppercase tracking-wider">{title}</h3>
        </div>
        <svg
          className={`w-3.5 h-3.5 text-muted-foreground/30 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="mt-2">{children}</div>}
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

  // Metric pills
  const metrics: Array<{ label: string; value: string | number; color: string }> = []
  if (complexity != null) {
    const c = complexity > 10 ? 'text-red-400 bg-red-500/10 border-red-500/20' : complexity > 5 ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20' : 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
    metrics.push({ label: 'Complexity', value: complexity, color: c })
  }
  if (cognitiveComplexity != null) metrics.push({ label: 'Cognitive', value: cognitiveComplexity, color: 'text-muted-foreground bg-muted/50 border-border' })
  if (nestingDepth != null) metrics.push({ label: 'Depth', value: nestingDepth, color: 'text-muted-foreground bg-muted/50 border-border' })
  if (callerCount != null) metrics.push({ label: 'Callers', value: callerCount, color: 'text-blue-400 bg-blue-500/10 border-blue-500/20' })
  if (importerCount != null) metrics.push({ label: 'Importers', value: importerCount, color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20' })

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
            <span key={m.label} className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium ${m.color}`}>
              <span className="opacity-70">{m.label}</span>
              <span className="font-bold">{m.value}</span>
            </span>
          ))}
        </div>
      )}

      {/* Parameters */}
      {parsedParams.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/50 mb-1.5">Parameters</div>
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
              <span className="text-muted-foreground/50">{key}</span>
              <span className="text-muted-foreground font-mono text-[11px] text-right truncate max-w-[60%]">
                {typeof value === 'boolean'
                  ? <span className={value ? 'text-emerald-400' : 'text-muted-foreground/40'}>{String(value)}</span>
                  : String(value)}
              </span>
            </div>
          ))}
        </div>
      )}

      {metrics.length === 0 && parsedParams.length === 0 && otherProps.length === 0 && (
        <div className="text-xs text-muted-foreground/40 italic">No additional properties</div>
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
    setLoading(true)
    setLines(null)
    setHighlightedHtml(null)

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

          import('shiki').then(({ codeToHtml }) => {
            codeToHtml(fullCode, { lang, theme: 'github-dark' }).then(html => {
              const parser = new DOMParser()
              const doc = parser.parseFromString(html, 'text/html')
              const lineSpans = doc.querySelectorAll('.line')
              const htmlLines: string[] = []
              lineSpans.forEach(span => htmlLines.push(span.innerHTML))
              setHighlightedHtml(htmlLines)
            }).catch(() => setHighlightedHtml(null))
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
    return <div className="text-xs text-muted-foreground/50 animate-pulse p-3">Loading code...</div>
  }

  if (!lines || lines.length === 0) {
    return <div className="text-xs text-muted-foreground/50 italic p-3">No source code available</div>
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
                    style={isEntity ? { color: '#818cf8', fontWeight: 600 } : { color: 'rgba(161,161,170,0.3)' }}
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
