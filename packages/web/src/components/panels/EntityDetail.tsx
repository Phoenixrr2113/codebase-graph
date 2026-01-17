'use client';

/**
 * EntityDetail Panel
 * Shows selected node details with code preview
 * 
 * Layout Strategy for Resizable Panels:
 * - Root uses w-full to fill resizable panel
 * - All containers use w-full and overflow-x-hidden to prevent horizontal overflow
 * - Text uses overflow-wrap: anywhere for aggressive word breaking
 */

import { useCallback, useRef, useEffect, useState } from 'react';
import type { GraphNode, FunctionEntity, ClassEntity, ComponentEntity } from '@codegraph/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { NODE_COLORS } from '@/lib/cytoscapeConfig';
import { useSourceCode } from '@/hooks/useGraphData';
import { cn } from '@/lib/utils';

export interface EntityDetailProps {
  node: GraphNode | null;
  onFocusNode?: (nodeId: string) => void;
  onShowConnections?: (nodeId: string) => void;
}

export function EntityDetail({ node, onFocusNode, onShowConnections }: EntityDetailProps) {
  const handleCopyPath = useCallback(() => {
    if (node?.filePath) {
      navigator.clipboard.writeText(node.filePath);
    }
  }, [node?.filePath]);

  const handleFocus = useCallback(() => {
    if (node && onFocusNode) {
      onFocusNode(node.id);
    }
  }, [node, onFocusNode]);

  const handleShowConnections = useCallback(() => {
    if (node && onShowConnections) {
      onShowConnections(node.id);
    }
  }, [node, onShowConnections]);

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
    <div className="h-full w-full overflow-hidden">
      <ScrollArea className="h-full w-full">
        <div className="p-4 space-y-4 w-full">
          {/* Header */}
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <div
                className="w-3 h-3 rounded shrink-0 mt-1"
                style={{ backgroundColor: color }}
              />
              <div className="flex-1 min-w-0">
                <h2 className="text-base font-semibold text-white" style={{ overflowWrap: 'anywhere' }}>
                  {node.displayName}
                </h2>
                <div className="flex flex-wrap items-center gap-1.5 mt-1">
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
              <div
                className="text-xs text-slate-400 font-mono"
                style={{ overflowWrap: 'anywhere' }}
              >
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

          {/* Code Preview */}
          <Section title="Code Preview">
            <CodePreview node={node} />
          </Section>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 pt-2">
            <Button variant="outline" size="sm" className="text-xs" onClick={handleFocus}>
              Focus in Graph
            </Button>
            <Button variant="outline" size="sm" className="text-xs" onClick={handleShowConnections}>
              Show Connections
            </Button>
            <Button variant="outline" size="sm" className="text-xs" onClick={handleCopyPath}>
              Copy Path
            </Button>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

// Helper components
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="w-full">
      <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">
        {title}
      </h3>
      <div className="w-full">
        {children}
      </div>
    </div>
  );
}

function SignatureDisplay({ node }: { node: GraphNode }) {
  const data = node.data as FunctionEntity | ClassEntity | ComponentEntity;
  
  if (node.label === 'Function' || node.label === 'Component') {
    const fn = data as FunctionEntity;
    const params = Array.isArray(fn.params)
      ? fn.params.map((p) => `${p.name}${p.type ? `: ${p.type}` : ''}`).join(', ')
      : '';
    const returnType = fn.returnType || 'void';
    
    return (
      <code
        className="text-xs text-emerald-400 font-mono block bg-slate-950 p-2 rounded border border-slate-800"
        style={{ overflowWrap: 'anywhere' }}
      >
        {fn.isAsync && <span className="text-purple-400">async </span>}
        {node.displayName}({params}): {returnType}
      </code>
    );
  }
  
  if (node.label === 'Class') {
    const cls = data as ClassEntity;
    return (
      <code
        className="text-xs text-amber-400 font-mono block bg-slate-950 p-2 rounded border border-slate-800"
        style={{ overflowWrap: 'anywhere' }}
      >
        {cls.isAbstract && <span className="text-purple-400">abstract </span>}
        class {node.displayName}
        {cls.extends && <span className="text-slate-400"> extends {cls.extends}</span>}
        {Array.isArray(cls.implements) && cls.implements.length > 0 && (
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

  // Format a value for display
  const formatValue = (key: string, value: unknown): React.ReactNode => {
    // Try to parse JSON strings
    let parsedValue = value;
    if (typeof value === 'string' && (value.startsWith('[') || value.startsWith('{'))) {
      try {
        parsedValue = JSON.parse(value);
      } catch {
        // Keep original string
      }
    }

    // Special handling for params array
    if (key === 'params' && Array.isArray(parsedValue)) {
      if (parsedValue.length === 0) return <span className="text-slate-500 italic">none</span>;
      return (
        <div className="mt-1 space-y-0.5">
          {parsedValue.map((param: { name: string; type?: string }, idx: number) => (
            <div key={idx} className="flex flex-wrap gap-1 text-xs">
              <span className="text-cyan-400">{param.name}</span>
              {param.type && (
                <span className="text-slate-500">: {param.type}</span>
              )}
            </div>
          ))}
        </div>
      );
    }

    // Arrays (other than params)
    if (Array.isArray(parsedValue)) {
      if (parsedValue.length === 0) return <span className="text-slate-500 italic">none</span>;
      return <span style={{ overflowWrap: 'anywhere' }}>{parsedValue.join(', ')}</span>;
    }

    // Objects - pretty print
    if (typeof parsedValue === 'object' && parsedValue !== null) {
      return (
        <pre className="text-[10px] text-slate-400 bg-slate-900 rounded p-1 mt-1 whitespace-pre-wrap" style={{ overflowWrap: 'anywhere' }}>
          {JSON.stringify(parsedValue, null, 2)}
        </pre>
      );
    }

    // Booleans
    if (typeof parsedValue === 'boolean') {
      return <span className={parsedValue ? 'text-emerald-400' : 'text-slate-500'}>{String(parsedValue)}</span>;
    }

    return <span style={{ overflowWrap: 'anywhere' }}>{String(parsedValue)}</span>;
  };

  return (
    <div className="space-y-1.5">
      {entries.map(([key, value]) => (
        <div key={key} className="text-xs">
          <span className="text-slate-500">{key}: </span>
          <span className="text-slate-300">
            {formatValue(key, value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function CodePreview({ node }: { node: GraphNode }) {
  const entityStartLine = getStartLine(node);
  const entityEndLine = (node.data as { endLine?: number }).endLine;
  const highlightRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [highlightedLines, setHighlightedLines] = useState<string[]>([]);

  const { data, isLoading, error } = useSourceCode(
    node.filePath,
    undefined, // Fetch full file for context
    undefined
  );

  // Generate syntax highlighted lines using shiki
  useEffect(() => {
    if (!data?.lines?.length || !node.filePath) return;

    const highlight = async () => {
      try {
        const { codeToHtml } = await import('shiki');
        const fullCode = data.lines.map(l => l.content).join('\n');

        // Detect language from file extension
        const ext = node.filePath?.split('.').pop()?.toLowerCase() || 'text';
        const langMap: Record<string, string> = {
          ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
          py: 'python', css: 'css', json: 'json', html: 'html',
          md: 'markdown', yaml: 'yaml', yml: 'yaml', sh: 'bash',
          sql: 'sql', graphql: 'graphql', go: 'go', rs: 'rust',
        };
        const lang = langMap[ext] || 'text';

        const html = await codeToHtml(fullCode, {
          lang,
          theme: 'github-dark',
        });

        // Parse the HTML to extract individual line contents
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const lineSpans = doc.querySelectorAll('.line');

        const lines: string[] = [];
        lineSpans.forEach((span) => {
          lines.push(span.innerHTML);
        });

        setHighlightedLines(lines);
      } catch (err) {
        console.warn('Shiki highlighting failed, using fallback:', err);
        setHighlightedLines([]);
      }
    };

    highlight();
  }, [data, node.filePath]);

  // Auto-scroll to highlighted entity when node changes
  useEffect(() => {
    if (!highlightRef.current || !scrollContainerRef.current) return;

    const scrollToHighlight = () => {
      if (highlightRef.current) {
        highlightRef.current.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    };

    // Use double RAF to ensure layout is complete
    requestAnimationFrame(() => {
      requestAnimationFrame(scrollToHighlight);
    });
  }, [node.id, highlightedLines.length]);

  // Check if a line is within the entity's range
  const isEntityLine = (lineNum: number) =>
    entityStartLine != null && entityEndLine != null &&
    lineNum >= entityStartLine && lineNum <= entityEndLine;

  if (!node.filePath) {
    return (
      <div className="text-xs text-slate-500 italic">
        No file path available
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="bg-slate-950 rounded-lg border border-slate-800 p-3">
        <div className="text-xs text-slate-500 animate-pulse">Loading code...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-slate-950 rounded-lg border border-slate-800 p-3">
        <div className="text-xs text-red-400">Failed to load code</div>
      </div>
    );
  }

  if (!data?.lines?.length) {
    return (
      <div className="bg-slate-950 rounded-lg border border-slate-800 p-3">
        <div className="text-xs text-slate-500 italic">No code available</div>
      </div>
    );
  }

  // Use highlighted lines if available, otherwise plain text
  const useHighlighting = highlightedLines.length === data.lines.length;

  return (
    <div className="bg-slate-950 rounded-lg border border-slate-800 overflow-hidden">
      <div
        ref={scrollContainerRef}
        className="max-h-[350px] overflow-y-auto overflow-x-auto"
      >
        <pre className="text-xs min-w-max font-mono">
          <code>
            {data.lines.map((line, idx) => {
              const isHighlighted = isEntityLine(line.number);
              const isFirstLine = line.number === entityStartLine;

              return (
                <div
                  key={line.number}
                  ref={isFirstLine ? highlightRef : undefined}
                  className={cn(
                    "flex hover:bg-slate-800/50",
                    isHighlighted && "bg-indigo-900/40 border-l-2 border-indigo-500"
                  )}
                >
                  <span className={cn(
                    "w-10 shrink-0 text-right pr-3 select-none border-r border-slate-800",
                    isHighlighted ? "text-indigo-400 font-medium" : "text-slate-600"
                  )}>
                    {line.number}
                  </span>
                  {useHighlighting ? (
                    <span
                      className="pl-3 whitespace-pre [&>span]:!bg-transparent"
                      dangerouslySetInnerHTML={{ __html: highlightedLines[idx] ?? '' }}
                    />
                  ) : (
                      <span className="pl-3 text-slate-300 whitespace-pre">{line.content}</span>
                  )}
                </div>
              );
            })}
          </code>
        </pre>
      </div>
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
