'use client'

import { useState, useCallback } from 'react'
import type { GraphNode } from './graph-canvas'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { NODE_COLORS } from '@/lib/cytoscape-config'

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
          <Section title="Location">
            <div className="text-xs text-muted-foreground font-mono" style={{ overflowWrap: 'anywhere' }}>
              {filePath}
            </div>
            {startLine != null && endLine != null && (
              <div className="text-xs text-muted-foreground/60 mt-1">Lines {startLine} - {endLine}</div>
            )}
          </Section>
        )}

        {/* Signature */}
        {(node.type === 'Function' || node.type === 'Component') && (
          <Section title="Signature">
            <code className="text-xs text-emerald-400 font-mono block bg-background p-2 rounded border border-border" style={{ overflowWrap: 'anywhere' }}>
              {isAsync && <span className="text-purple-400">async </span>}
              {node.label}({formatParams(params)}): {returnType ?? 'void'}
            </code>
          </Section>
        )}

        {node.type === 'Class' && (
          <Section title="Signature">
            <code className="text-xs text-amber-400 font-mono block bg-background p-2 rounded border border-border" style={{ overflowWrap: 'anywhere' }}>
              {props.isAbstract && <span className="text-purple-400">abstract </span>}
              class {node.label}
              {props.extends && <span className="text-muted-foreground"> extends {String(props.extends)}</span>}
            </code>
          </Section>
        )}

        {/* Docstring */}
        {docstring && docstring.trim() && (
          <div className="bg-background/50 border-l-2 border-cyan-500/50 rounded-r p-2">
            <div className="text-[10px] uppercase tracking-wider text-cyan-500/70 mb-1">Documentation</div>
            <p className="text-xs text-muted-foreground italic leading-relaxed" style={{ overflowWrap: 'anywhere' }}>
              {docstring}
            </p>
          </div>
        )}

        {/* Properties */}
        <Section title="Properties" defaultCollapsed>
          <PropertiesDisplay props={props} />
        </Section>

        {/* Code Preview */}
        {bodySnippet && (
          <Section title="Code Preview">
            <div className="bg-background rounded-lg border border-border overflow-hidden">
              <pre className="text-xs font-mono p-3 overflow-x-auto max-h-[250px] overflow-y-auto">
                <code className="text-muted-foreground">{bodySnippet}</code>
              </pre>
            </div>
          </Section>
        )}

        {signature && !bodySnippet && (
          <Section title="Signature">
            <code className="text-xs font-mono block bg-background p-2 rounded border border-border text-muted-foreground" style={{ overflowWrap: 'anywhere' }}>
              {signature}
            </code>
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

function Section({ title, children, defaultCollapsed = false }: { title: string; children: React.ReactNode; defaultCollapsed?: boolean }) {
  const [open, setOpen] = useState(!defaultCollapsed)

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full group"
      >
        <h3 className="text-xs uppercase tracking-wider text-muted-foreground/60">{title}</h3>
        <svg
          className={`w-3 h-3 text-muted-foreground/40 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  )
}

function PropertiesDisplay({ props }: { props: Record<string, unknown> }) {
  const skipKeys = new Set(['id', 'label', 'type', 'filePath', 'startLine', 'endLine', 'isExported', 'isAsync', 'isArrow', 'docstring', 'bodySnippet', 'signature', 'embedding'])

  const entries = Object.entries(props).filter(
    ([key, value]) => !skipKeys.has(key) && value != null && value !== '' && value !== '{}',
  )

  if (entries.length === 0) {
    return <div className="text-xs text-muted-foreground/50 italic">No additional properties</div>
  }

  return (
    <div className="space-y-1.5">
      {entries.map(([key, value]) => (
        <div key={key} className="text-xs">
          <span className="text-muted-foreground/60">{key}: </span>
          <span className="text-muted-foreground">{formatValue(key, value)}</span>
        </div>
      ))}
    </div>
  )
}

function formatParams(params: unknown): string {
  if (!params) return ''
  if (typeof params === 'string') {
    try {
      const parsed = JSON.parse(params)
      if (Array.isArray(parsed)) {
        return parsed.map((p: { name: string; type?: string }) =>
          `${p.name}${p.type ? `: ${p.type}` : ''}`
        ).join(', ')
      }
    } catch { /* not JSON */ }
    return params
  }
  if (Array.isArray(params)) {
    return params.map((p: { name: string; type?: string }) =>
      `${p.name}${p.type ? `: ${p.type}` : ''}`
    ).join(', ')
  }
  return String(params)
}

function formatValue(key: string, value: unknown): string {
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (Array.isArray(value)) {
    if (value.length === 0) return 'none'
    if (key === 'params') {
      return value.map((p: { name: string; type?: string }) =>
        `${p.name}${p.type ? `: ${p.type}` : ''}`
      ).join(', ')
    }
    return value.join(', ')
  }
  if (typeof value === 'object' && value !== null) {
    try { return JSON.stringify(value) } catch { return String(value) }
  }
  return String(value)
}

export default EntityDetail
