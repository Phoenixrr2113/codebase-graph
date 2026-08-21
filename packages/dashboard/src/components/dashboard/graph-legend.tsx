import { useState } from 'react'
import { EMBEDDABLE_LABELS, type EmbeddableLabel } from '@codegraph/types'
import { EDGE_COLORS } from '@/lib/cytoscape-config'

interface GraphLegendProps {
  hiddenEdgeTypes: Set<string>
  onToggleEdgeType: (edgeType: string) => void
  hiddenNodeTypes: Set<string>
  onToggleNodeType: (nodeType: string) => void
}

type LegendShape = 'ellipse' | 'diamond' | 'round-rectangle' | 'hexagon'

interface NodeLegendItem {
  label: string
  color: string
  shape: LegendShape
  dashed?: boolean
}

const LEGEND_NODE_STYLES = {
  File: { color: '#6366f1', shape: 'round-rectangle' },
  Function: { color: '#10b981', shape: 'ellipse' },
  Class: { color: '#f59e0b', shape: 'diamond' },
  Interface: { color: '#f59e0b', shape: 'diamond', dashed: true },
  Component: { color: '#06b6d4', shape: 'round-rectangle' },
  Variable: { color: '#8b5cf6', shape: 'ellipse' },
  Type: { color: '#ec4899', shape: 'hexagon' },
  Entity: { color: '#f97316', shape: 'round-rectangle' },
} satisfies Record<EmbeddableLabel, Omit<NodeLegendItem, 'label'>>

export function buildNodeLegend(labels: readonly string[]): NodeLegendItem[] {
  return labels.map((label) => {
    const style = LEGEND_NODE_STYLES[label as EmbeddableLabel]
    if (!style) throw new Error(`Missing graph legend style for ${label}`)
    return { label, ...style }
  })
}

const NODE_LEGEND = buildNodeLegend(EMBEDDABLE_LABELS)

const EDGE_LEGEND = [
  { label: 'Calls', type: 'CALLS' },
  { label: 'Imports', type: 'IMPORTS', dashed: true },
  { label: 'Contains', type: 'CONTAINS' },
  { label: 'Extends', type: 'EXTENDS' },
  { label: 'Implements', type: 'IMPLEMENTS', dashed: true },
  { label: 'About', type: 'ABOUT', dashed: true },
]

function shapeClass(shape: string) {
  switch (shape) {
    case 'ellipse': return 'rounded-full'
    case 'diamond': return 'rotate-45 scale-75'
    case 'round-rectangle': return 'rounded-sm'
    case 'hexagon': return '[clip-path:polygon(25%_0,75%_0,100%_50%,75%_100%,25%_100%,0_50%)]'
    default: return 'rounded-full'
  }
}

export function GraphLegend({ hiddenEdgeTypes, onToggleEdgeType, hiddenNodeTypes, onToggleNodeType }: GraphLegendProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <div className="rounded-lg border border-border bg-card/90 backdrop-blur-sm overflow-hidden" style={{ maxWidth: 200 }}>
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        aria-controls="graph-legend-content"
        className="w-full px-3 py-1.5 flex items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>Legend</span>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"
          className={`transition-transform ${collapsed ? 'rotate-180' : ''}`}>
          <polyline points="3,8 6,5 9,8" />
        </svg>
      </button>

      {!collapsed && (
        <div id="graph-legend-content" className="px-3 pb-2 space-y-2">
          {/* Nodes (clickable to filter) */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-subtle mb-1">
              Nodes <span className="normal-case">(click to filter)</span>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
              {NODE_LEGEND.map((item) => {
                const hidden = hiddenNodeTypes.has(item.label)
                return (
                  <button
                    type="button"
                    key={item.label}
                    onClick={() => onToggleNodeType(item.label)}
                    aria-pressed={!hidden}
                    aria-label={`${hidden ? 'Show' : 'Hide'} ${item.label} nodes`}
                    className={`flex items-center gap-1.5 transition-opacity ${hidden ? 'opacity-30' : ''}`}
                  >
                    <div
                      className={`w-2.5 h-2.5 shrink-0 ${shapeClass(item.shape)}`}
                      style={{
                        backgroundColor: item.dashed ? 'transparent' : item.color,
                        borderColor: item.color,
                        ...(item.dashed ? { border: '1.5px dashed' } : {}),
                      }}
                    />
                    <span className={`text-[10px] text-muted-foreground ${hidden ? 'line-through' : ''}`}>{item.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Edges (clickable to filter) */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-subtle mb-1">
              Edges <span className="normal-case">(click to filter)</span>
            </div>
            <div className="space-y-0.5">
              {EDGE_LEGEND.map((item) => {
                const color = EDGE_COLORS[item.type] ?? '#64748b'
                const hidden = hiddenEdgeTypes.has(item.type)
                return (
                  <button
                    type="button"
                    key={item.type}
                    onClick={() => onToggleEdgeType(item.type)}
                    aria-pressed={!hidden}
                    aria-label={`${hidden ? 'Show' : 'Hide'} ${item.label} edges`}
                    className={`flex items-center gap-1.5 w-full text-left transition-opacity ${hidden ? 'opacity-30' : ''}`}
                  >
                    <div className="w-4 h-0.5 shrink-0 relative">
                      <div
                        className="absolute inset-0"
                        style={{
                          backgroundColor: item.dashed ? 'transparent' : color,
                          borderTop: item.dashed ? `1.5px dashed ${color}` : 'none',
                        }}
                      />
                      <div
                        className="absolute right-0 top-1/2 -translate-y-1/2 w-0 h-0"
                        style={{
                          borderLeft: `4px solid ${color}`,
                          borderTop: '2px solid transparent',
                          borderBottom: '2px solid transparent',
                        }}
                      />
                    </div>
                    <span className={`text-[10px] text-muted-foreground ${hidden ? 'line-through' : ''}`}>
                      {item.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
