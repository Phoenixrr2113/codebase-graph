'use client';

/**
 * EntityDetail Panel
 * Shows selected node details with code preview
 */

import type { GraphNode, FunctionEntity, ClassEntity, ComponentEntity } from '@codegraph/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { NODE_COLORS } from '@/lib/cytoscapeConfig';

export interface EntityDetailProps {
  node: GraphNode | null;
}

export function EntityDetail({ node }: EntityDetailProps) {
  if (!node) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="text-center text-slate-500">
          <NodeIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-sm">Select a node to view details</p>
        </div>
      </div>
    );
  }

  const color = NODE_COLORS[node.label] || '#64748b';

  return (
    <ScrollArea className="h-full">
      <div className="p-4 space-y-4">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <div
              className="w-4 h-4 rounded shrink-0 mt-1"
              style={{ backgroundColor: color }}
            />
            <div className="flex-1 min-w-0">
              <h2 className="text-lg font-semibold text-white break-all">
                {node.displayName}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="secondary" className="text-xs">
                  {node.label}
                </Badge>
                {isExported(node) && (
                  <Badge variant="outline" className="text-xs text-emerald-400 border-emerald-400/30">
                    exported
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </div>

        <Separator className="bg-slate-800" />

        {/* Location */}
        {node.filePath && (
          <Section title="Location">
            <div className="text-sm text-slate-400 break-all font-mono">
              {node.filePath}
            </div>
            {hasLineRange(node) && (
              <div className="text-xs text-slate-500 mt-1">
                Lines {(node.data as { startLine: number }).startLine} - {(node.data as { endLine: number }).endLine}
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              className="mt-2 text-xs"
              onClick={() => openInEditor(node.filePath!, getStartLine(node))}
            >
              Open in Editor
            </Button>
          </Section>
        )}

        {/* Signature (for functions/classes) */}
        {hasSignature(node) && (
          <Section title="Signature">
            <SignatureDisplay node={node} />
          </Section>
        )}

        {/* Properties based on type */}
        <Section title="Properties">
          <PropertiesDisplay node={node} />
        </Section>

        {/* Code Preview Placeholder */}
        <Section title="Code Preview">
          <div className="bg-slate-950 rounded-lg border border-slate-800 p-3">
            <div className="text-xs text-slate-500 italic">
              Code preview will be available when connected to the API
            </div>
          </div>
        </Section>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="outline" size="sm" className="text-xs">
            Focus in Graph
          </Button>
          <Button variant="outline" size="sm" className="text-xs">
            Show Connections
          </Button>
          <Button variant="outline" size="sm" className="text-xs">
            Copy Path
          </Button>
        </div>
      </div>
    </ScrollArea>
  );
}

// Helper components
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">
        {title}
      </h3>
      {children}
    </div>
  );
}

function SignatureDisplay({ node }: { node: GraphNode }) {
  const data = node.data as FunctionEntity | ClassEntity | ComponentEntity;
  
  if (node.label === 'Function' || node.label === 'Component') {
    const fn = data as FunctionEntity;
    const params = fn.params?.map((p) => `${p.name}${p.type ? `: ${p.type}` : ''}`).join(', ') || '';
    const returnType = fn.returnType || 'void';
    
    return (
      <code className="text-xs text-emerald-400 font-mono block bg-slate-950 p-2 rounded border border-slate-800 break-all">
        {fn.isAsync && <span className="text-purple-400">async </span>}
        {node.displayName}({params}): {returnType}
      </code>
    );
  }
  
  if (node.label === 'Class') {
    const cls = data as ClassEntity;
    return (
      <code className="text-xs text-amber-400 font-mono block bg-slate-950 p-2 rounded border border-slate-800 break-all">
        {cls.isAbstract && <span className="text-purple-400">abstract </span>}
        class {node.displayName}
        {cls.extends && <span className="text-slate-400"> extends {cls.extends}</span>}
        {cls.implements && cls.implements.length > 0 && (
          <span className="text-slate-400"> implements {cls.implements.join(', ')}</span>
        )}
      </code>
    );
  }
  
  return null;
}

function PropertiesDisplay({ node }: { node: GraphNode }) {
  const data = node.data;
  
  // Filter out common display fields
  const skipKeys = ['id', 'name', 'displayName', 'filePath', 'label'];
  const entries = Object.entries(data).filter(
    ([key, value]) => !skipKeys.includes(key) && value !== undefined && value !== null
  );
  
  if (entries.length === 0) {
    return <div className="text-xs text-slate-500 italic">No additional properties</div>;
  }
  
  return (
    <div className="space-y-1">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-start gap-2 text-xs">
          <span className="text-slate-500 shrink-0">{key}:</span>
          <span className="text-slate-300 break-all">
            {typeof value === 'object' ? JSON.stringify(value) : String(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function NodeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="12" cy="12" r="3" />
      <circle cx="19" cy="5" r="2" />
      <circle cx="5" cy="5" r="2" />
      <circle cx="5" cy="19" r="2" />
      <circle cx="19" cy="19" r="2" />
      <line x1="12" y1="9" x2="12" y2="5" />
      <line x1="14.5" y1="10.5" x2="17.5" y2="6.5" />
      <line x1="14.5" y1="13.5" x2="17.5" y2="17.5" />
      <line x1="9.5" y1="13.5" x2="6.5" y2="17.5" />
      <line x1="9.5" y1="10.5" x2="6.5" y2="6.5" />
    </svg>
  );
}

// Helper functions
function isExported(node: GraphNode): boolean {
  return (node.data as { isExported?: boolean }).isExported === true;
}

function hasLineRange(node: GraphNode): boolean {
  const data = node.data as { startLine?: number; endLine?: number };
  return typeof data.startLine === 'number' && typeof data.endLine === 'number';
}

function getStartLine(node: GraphNode): number | undefined {
  return (node.data as { startLine?: number }).startLine;
}

function hasSignature(node: GraphNode): boolean {
  return ['Function', 'Class', 'Component'].includes(node.label);
}

function openInEditor(filePath: string, line?: number) {
  // VSCode URL scheme
  const url = `vscode://file/${filePath}${line ? `:${line}` : ''}`;
  window.open(url, '_blank');
}

export default EntityDetail;
