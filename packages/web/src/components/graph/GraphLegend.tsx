'use client';

/**
 * GraphLegend Component
 * Shows node and edge type color/shape legend
 */

import { NODE_COLORS, EDGE_COLORS } from '@/lib/cytoscapeConfig';
import { cn } from '@/lib/utils';

interface LegendItem {
  label: string;
  color: string;
  shape?: 'circle' | 'diamond' | 'rectangle' | 'hexagon';
  dashed?: boolean;
}

const NODE_LEGEND: LegendItem[] = [
  { label: 'File', color: NODE_COLORS.File, shape: 'rectangle' },
  { label: 'Class', color: NODE_COLORS.Class, shape: 'diamond' },
  { label: 'Interface', color: NODE_COLORS.Interface, shape: 'diamond', dashed: true },
  { label: 'Function', color: NODE_COLORS.Function, shape: 'circle' },
  { label: 'Component', color: NODE_COLORS.Component, shape: 'rectangle' },
  { label: 'Variable', color: NODE_COLORS.Variable, shape: 'circle' },
  { label: 'Type', color: NODE_COLORS.Type, shape: 'hexagon' },
];

const EDGE_LEGEND: LegendItem[] = [
  { label: 'Calls', color: EDGE_COLORS.CALLS },
  { label: 'Imports', color: EDGE_COLORS.IMPORTS, dashed: true },
  { label: 'Extends', color: EDGE_COLORS.EXTENDS },
  { label: 'Implements', color: EDGE_COLORS.IMPLEMENTS, dashed: true },
  { label: 'Renders', color: EDGE_COLORS.RENDERS },
];

export interface GraphLegendProps {
  className?: string;
  collapsed?: boolean;
  onToggle?: () => void;
}

export function GraphLegend({ className, collapsed = false, onToggle }: GraphLegendProps) {
  return (
    <div
      className={cn(
        'bg-slate-900/95 border border-slate-800 rounded-lg overflow-hidden',
        className
      )}
    >
      <button
        onClick={onToggle}
        className="w-full px-3 py-2 flex items-center justify-between text-xs font-medium text-slate-400 hover:text-white hover:bg-slate-800/50 transition-colors"
      >
        <span>Legend</span>
        <ChevronIcon collapsed={collapsed} />
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-3">
          {/* Nodes */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
              Nodes
            </div>
            <div className="grid grid-cols-2 gap-1">
              {NODE_LEGEND.map((item) => (
                <LegendNodeItem key={item.label} {...item} />
              ))}
            </div>
          </div>

          {/* Edges */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 mb-1.5">
              Edges
            </div>
            <div className="space-y-1">
              {EDGE_LEGEND.map((item) => (
                <LegendEdgeItem key={item.label} {...item} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LegendNodeItem({ label, color, shape, dashed }: LegendItem) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={cn(
          'w-3 h-3 shrink-0',
          shape === 'circle' && 'rounded-full',
          shape === 'rectangle' && 'rounded-sm',
          shape === 'diamond' && 'rotate-45 scale-75',
          shape === 'hexagon' && 'clip-hexagon',
          dashed && 'border border-dashed'
        )}
        style={{
          backgroundColor: dashed ? 'transparent' : color,
          borderColor: color,
        }}
      />
      <span className="text-[10px] text-slate-400">{label}</span>
    </div>
  );
}

function LegendEdgeItem({ label, color, dashed }: LegendItem) {
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-4 h-0.5 relative shrink-0">
        <div
          className={cn('absolute inset-0', dashed && 'border-t border-dashed')}
          style={{
            backgroundColor: dashed ? 'transparent' : color,
            borderColor: color,
          }}
        />
        {/* Arrow */}
        <div
          className="absolute right-0 top-1/2 -translate-y-1/2 w-0 h-0 border-l-[4px] border-y-[2px] border-y-transparent"
          style={{ borderLeftColor: color }}
        />
      </div>
      <span className="text-[10px] text-slate-400">{label}</span>
    </div>
  );
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={cn('transition-transform', collapsed ? 'rotate-180' : '')}
    >
      <polyline points="3,8 6,5 9,8" />
    </svg>
  );
}

export default GraphLegend;
