'use client';

/**
 * QueryPanel Component
 * Self-contained Cypher / Natural Language query panel.
 * Manages its own query execution via useMutation + the API client.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { executeCypher, queryNatural } from '@/services/api';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { Loader2, Copy, Check, Terminal, MessageSquare } from 'lucide-react';

export interface QueryPanelProps {
  className?: string;
}

export function QueryPanel({ className }: QueryPanelProps) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'cypher' | 'natural'>('cypher');
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ---- Cypher mutation ----
  const cypherMutation = useMutation({
    mutationFn: (q: string) => executeCypher(q),
  });

  // ---- Natural language mutation ----
  const naturalMutation = useMutation({
    mutationFn: (q: string) => queryNatural(q),
  });

  const activeMutation = mode === 'cypher' ? cypherMutation : naturalMutation;
  const isLoading = activeMutation.isPending;
  const error = activeMutation.error;
  const data = activeMutation.data;

  // Derive results array from whichever mutation succeeded
  const results: unknown[] | undefined = data
    ? 'results' in data
      ? (data as { results: unknown[] }).results
      : undefined
    : undefined;

  // Natural language extras
  const dataRecord = data as Record<string, unknown> | undefined;
  const nlExplanation =
    mode === 'natural' && dataRecord && typeof dataRecord.explanation === 'string'
      ? dataRecord.explanation
      : undefined;
  const nlCypher =
    mode === 'natural' && dataRecord && typeof dataRecord.cypher === 'string'
      ? dataRecord.cypher
      : undefined;

  // ---- Execute handler ----
  const handleExecute = useCallback(() => {
    const trimmed = query.trim();
    if (!trimmed) return;

    if (mode === 'cypher') {
      cypherMutation.mutate(trimmed);
    } else {
      naturalMutation.mutate(trimmed);
    }
  }, [query, mode, cypherMutation, naturalMutation]);

  // ---- Ctrl+Enter shortcut ----
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleExecute();
      }
    },
    [handleExecute],
  );

  // ---- Copy JSON ----
  const handleCopyJson = useCallback(async () => {
    if (!results) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(results, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard write can fail in some contexts
    }
  }, [results]);

  // Auto-focus textarea on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  return (
    <div className={cn('h-full flex flex-col', className)}>
      {/* Header with mode toggle */}
      <div className="p-3 border-b border-slate-800">
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => setMode('cypher')}
            className={cn(
              'px-2 py-1 text-xs rounded transition-colors flex items-center gap-1.5',
              mode === 'cypher'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-white',
            )}
          >
            <Terminal className="w-3 h-3" />
            Cypher
          </button>
          <button
            onClick={() => setMode('natural')}
            className={cn(
              'px-2 py-1 text-xs rounded transition-colors flex items-center gap-1.5',
              mode === 'natural'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-white',
            )}
          >
            <MessageSquare className="w-3 h-3" />
            Natural Language
          </button>
        </div>

        {/* Natural language note */}
        {mode === 'natural' && (
          <div className="mb-2 px-2 py-1.5 text-xs text-amber-400/80 bg-amber-500/10 border border-amber-500/20 rounded">
            Natural language queries are coming soon. The backend currently returns 501 (Not Implemented).
          </div>
        )}

        {/* Query input */}
        <textarea
          ref={textareaRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            mode === 'cypher'
              ? 'MATCH (n:Function) RETURN n.name LIMIT 10'
              : 'What functions call processPayment?'
          }
          className="w-full h-24 px-3 py-2 text-sm font-mono bg-slate-900 border border-slate-700 rounded-md text-slate-300 placeholder:text-slate-600 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />

        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-slate-500">
            {mode === 'cypher' ? 'Enter Cypher query' : 'Ask a question'}
            <span className="ml-2 text-slate-600">Ctrl+Enter to run</span>
          </span>
          <Button
            onClick={handleExecute}
            disabled={!query.trim() || isLoading}
            size="sm"
            className="h-7 text-xs"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                Running...
              </>
            ) : (
              'Execute'
            )}
          </Button>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="p-3 border-b border-slate-800 bg-red-500/10">
          <div className="text-sm text-red-400">{error.message}</div>
        </div>
      )}

      {/* Results */}
      <ScrollArea className="flex-1">
        <div className="p-3">
          {results && results.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-500">
                  {results.length} result{results.length !== 1 ? 's' : ''}
                </div>
                <button
                  onClick={handleCopyJson}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 text-xs rounded transition-colors',
                    copied
                      ? 'text-emerald-400 bg-emerald-500/10'
                      : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800',
                  )}
                >
                  {copied ? (
                    <>
                      <Check className="w-3 h-3" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      Copy JSON
                    </>
                  )}
                </button>
              </div>

              {/* Natural language extras */}
              {nlExplanation && (
                <div className="text-xs text-cyan-400/80 bg-cyan-500/10 border border-cyan-500/20 rounded p-2">
                  {nlExplanation}
                </div>
              )}
              {nlCypher && (
                <div className="text-xs text-slate-400 font-mono bg-slate-900 border border-slate-800 rounded p-2">
                  <span className="text-slate-600 select-none">Generated: </span>
                  {nlCypher}
                </div>
              )}

              <pre className="text-xs text-slate-300 font-mono bg-slate-900 p-3 rounded border border-slate-800 overflow-x-auto">
                {JSON.stringify(results, null, 2)}
              </pre>
            </div>
          ) : data && results?.length === 0 ? (
            <div className="text-xs text-slate-500 text-center py-8">
              Query executed successfully but returned no results
            </div>
          ) : (
            <div className="text-xs text-slate-500 text-center py-8">
              Execute a query to see results
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export default QueryPanel;
