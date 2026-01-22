'use client';

/**
 * SearchPanel Component
 * Server-side search with virtualized infinite scroll for graph nodes
 */

import { useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores';
import { useNodeSearch } from '@/hooks/useNodeSearch';
import { NODE_COLORS } from '@/lib/cytoscapeConfig';
import type { NodeLabel, GraphNode } from '@codegraph/types';
import { cn } from '@/lib/utils';

const NODE_TYPES: NodeLabel[] = [
  'File', 'Class', 'Interface', 'Function', 'Component', 'Variable', 'Type'
];

export interface SearchPanelProps {
  onNodeSelect?: (node: GraphNode) => void;
  selectedProjectId?: string | null;
}

export function SearchPanel({ onNodeSelect, selectedProjectId }: SearchPanelProps) {
  const { searchQuery, setSearchQuery, nodeTypeFilters, toggleNodeTypeFilter, clearFilters } = useUIStore();
  const parentRef = useRef<HTMLDivElement>(null);

  // Server-side search with pagination
  const {
    nodes,
    totalCount,
    isLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useNodeSearch({
    query: searchQuery,
    types: Array.from(nodeTypeFilters) as NodeLabel[],
    projectId: selectedProjectId ?? null,
    limit: 50,
  });

  // Virtualizer for efficient rendering
  const virtualizer = useVirtualizer({
    count: nodes.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48, // Estimated row height
    overscan: 10,
  });

  // Load more when scrolling near bottom
  const handleScroll = useCallback(() => {
    const container = parentRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const nearBottom = scrollTop + clientHeight >= scrollHeight - 200;

    if (nearBottom && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-slate-800">
        <h2 className="text-sm font-medium text-slate-300 mb-2">Search</h2>
        <Input
          type="search"
          placeholder="Search nodes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-8 text-sm bg-slate-900 border-slate-700"
        />
      </div>

      {/* Type filters */}
      <div className="p-3 border-b border-slate-800">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-slate-500 uppercase tracking-wider">
            Filter by type
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={clearFilters}
            className="h-6 text-xs text-slate-500 hover:text-white"
          >
            Reset
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {NODE_TYPES.map((type) => {
            const isActive = nodeTypeFilters.has(type);
            const color = NODE_COLORS[type];
            
            return (
              <button
                key={type}
                onClick={() => toggleNodeTypeFilter(type)}
                className={cn(
                  'px-2 py-1 text-xs rounded-md flex items-center gap-1.5 transition-colors',
                  isActive
                    ? 'bg-slate-800 text-white'
                    : 'bg-slate-900 text-slate-500 hover:text-slate-300'
                )}
              >
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: isActive ? color : '#64748b' }}
                />
                {type}
              </button>
            );
          })}
        </div>
      </div>

      {/* Results count */}
      <div className="px-3 py-2 flex items-center justify-between text-xs text-slate-500 border-b border-slate-800">
        <span>
          {isLoading ? 'Loading...' : `${nodes.length} of ${totalCount} nodes`}
        </span>
        {isFetchingNextPage && (
          <span className="text-indigo-400">Loading more...</span>
        )}
      </div>

      {/* Virtualized Results */}
      <div
        ref={parentRef}
        className="flex-1 overflow-auto"
        onScroll={handleScroll}
      >
        <div
          className="relative w-full"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const node = nodes[virtualRow.index];
            if (!node) return null;

            return (
              <div
                key={virtualRow.key}
                className="absolute top-0 left-0 w-full px-2"
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <button
                  onClick={() => onNodeSelect?.(node)}
                  className="w-full h-full text-left px-2 py-1.5 rounded hover:bg-slate-800 transition-colors group"
                >
                  <div className="flex items-center gap-2">
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: NODE_COLORS[node.label] }}
                    />
                    <span className="text-sm text-slate-300 truncate group-hover:text-white">
                      {node.displayName}
                    </span>
                  </div>
                  {node.filePath && (
                    <div className="text-xs text-slate-600 truncate ml-4 mt-0.5">
                      {node.filePath.split('/').slice(-2).join('/')}
                    </div>
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {/* Empty state */}
        {!isLoading && nodes.length === 0 && (
          <div className="text-xs text-slate-500 text-center py-4">
            {searchQuery ? 'No nodes match your search' : 'No nodes found'}
          </div>
        )}

        {/* Loading skeleton */}
        {isLoading && (
          <div className="p-2 space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 bg-slate-800/50 rounded animate-pulse" />
            ))}
          </div>
        )}

        {/* Load more trigger */}
        {hasNextPage && !isFetchingNextPage && (
          <div className="p-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchNextPage()}
              className="w-full text-xs text-slate-400"
            >
              Load more
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default SearchPanel;
