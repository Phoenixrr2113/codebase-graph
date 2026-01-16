'use client';

/**
 * QueryPanel Component
 * Cypher query input for direct graph queries
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

export interface QueryPanelProps {
  onExecute?: (query: string) => void;
  results?: unknown[];
  loading?: boolean;
  error?: string | null;
}

export function QueryPanel({ onExecute, results, loading, error }: QueryPanelProps) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'cypher' | 'natural'>('cypher');

  const handleExecute = () => {
    if (query.trim() && onExecute) {
      onExecute(query);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header with mode toggle */}
      <div className="p-3 border-b border-slate-800">
        <div className="flex items-center gap-2 mb-2">
          <button
            onClick={() => setMode('cypher')}
            className={cn(
              'px-2 py-1 text-xs rounded transition-colors',
              mode === 'cypher'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-white'
            )}
          >
            Cypher
          </button>
          <button
            onClick={() => setMode('natural')}
            className={cn(
              'px-2 py-1 text-xs rounded transition-colors',
              mode === 'natural'
                ? 'bg-indigo-600 text-white'
                : 'text-slate-400 hover:text-white'
            )}
          >
            Natural Language
          </button>
        </div>

        {/* Query input */}
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
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
          </span>
          <Button
            onClick={handleExecute}
            disabled={!query.trim() || loading}
            size="sm"
            className="h-7 text-xs"
          >
            {loading ? 'Running...' : 'Execute'}
          </Button>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="p-3 border-b border-slate-800 bg-red-500/10">
          <div className="text-sm text-red-400">{error}</div>
        </div>
      )}

      {/* Results */}
      <ScrollArea className="flex-1">
        <div className="p-3">
          {results && results.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs text-slate-500">
                {results.length} result{results.length !== 1 ? 's' : ''}
              </div>
              <pre className="text-xs text-slate-300 font-mono bg-slate-900 p-3 rounded border border-slate-800 overflow-x-auto">
                {JSON.stringify(results, null, 2)}
              </pre>
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
