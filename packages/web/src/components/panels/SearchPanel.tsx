'use client';

/**
 * SearchPanel Component
 * Server-side search with virtualized infinite scroll for graph nodes
 * Supports text search (paginated) and hybrid search (vector + text + graph)
 */

import { useRef, useCallback, useState, useEffect, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores';
import { useNodeSearch } from '@/hooks/useNodeSearch';
import { searchHybrid, type HybridSearchHit } from '@/services/api';
import { NODE_COLORS } from '@/lib/cytoscapeConfig';
import type { NodeLabel, GraphNode } from '@codegraph/types';
import { cn } from '@/lib/utils';

const NODE_TYPES: NodeLabel[] = [
  'File', 'Class', 'Interface', 'Function', 'Component', 'Variable', 'Type'
];

type SearchMode = 'text' | 'hybrid';

/** Badge config for hybrid search source types */
const SOURCE_BADGES: Record<string, { icon: string; label: string }> = {
  text:   { icon: '\u{1F524}', label: 'Text' },
  vector: { icon: '\u{1F9E0}', label: 'Vector' },
  graph:  { icon: '\u{1F517}', label: 'Graph' },
};

/** Map a HybridSearchHit to a GraphNode-compatible object for selection */
function hitToGraphNode(hit: HybridSearchHit): GraphNode {
  return {
    id: hit.key,
    label: hit.nodeType as NodeLabel,
    displayName: hit.name,
    filePath: hit.filePath,
    data: hit.properties,
  } as unknown as GraphNode;
}

export interface SearchPanelProps {
  onNodeSelect?: (node: GraphNode) => void;
  selectedProjectId?: string | null;
}

export function SearchPanel({ onNodeSelect, selectedProjectId }: SearchPanelProps) {
  const { searchQuery, setSearchQuery, nodeTypeFilters, toggleNodeTypeFilter, clearFilters } = useUIStore();
  const parentRef = useRef<HTMLDivElement>(null);

  // ---------------------------------------------------------------------------
  // Search mode toggle
  // ---------------------------------------------------------------------------
  const [searchMode, setSearchMode] = useState<SearchMode>('text');

  // ---------------------------------------------------------------------------
  // Text search (existing behaviour)
  // ---------------------------------------------------------------------------
  const {
    nodes,
    totalCount,
    isLoading: isTextLoading,
    isFetchingNextPage,
    hasNextPage,
    fetchNextPage,
  } = useNodeSearch({
    query: searchQuery,
    types: Array.from(nodeTypeFilters) as NodeLabel[],
    projectId: selectedProjectId ?? null,
    limit: 50,
    enabled: searchMode === 'text',
  });

  // ---------------------------------------------------------------------------
  // Hybrid search (new)
  // ---------------------------------------------------------------------------
  const [debouncedHybridQuery, setDebouncedHybridQuery] = useState(searchQuery);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedHybridQuery(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const {
    data: hybridData,
    isLoading: isHybridLoading,
  } = useQuery({
    queryKey: ['hybridSearch', debouncedHybridQuery, selectedProjectId] as const,
    queryFn: () =>
      searchHybrid(debouncedHybridQuery, {
        projectId: selectedProjectId!,
        limit: 50,
      }),
    enabled: searchMode === 'hybrid' && !!debouncedHybridQuery && !!selectedProjectId,
    staleTime: 30_000,
  });

  const hybridHits: HybridSearchHit[] = useMemo(
    () => hybridData?.hits ?? [],
    [hybridData],
  );

  // ---------------------------------------------------------------------------
  // Unified display list for virtualizer
  // ---------------------------------------------------------------------------
  const isHybrid = searchMode === 'hybrid';
  const displayCount = isHybrid ? hybridHits.length : nodes.length;
  const isLoading = isHybrid ? isHybridLoading : isTextLoading;

  // Virtualizer for efficient rendering
  const virtualizer = useVirtualizer({
    count: displayCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => isHybrid ? 56 : 48, // hybrid rows slightly taller for badges
    overscan: 10,
  });

  // Load more when scrolling near bottom (text mode only)
  const handleScroll = useCallback(() => {
    if (isHybrid) return; // hybrid search is not paginated
    const container = parentRef.current;
    if (!container) return;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const nearBottom = scrollTop + clientHeight >= scrollHeight - 200;

    if (nearBottom && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [isHybrid, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-3 border-b border-slate-800">
        <h2 className="text-sm font-medium text-slate-300 mb-2">Search</h2>
        <Input
          type="search"
          placeholder={isHybrid ? 'Smart search across code...' : 'Search nodes...'}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-8 text-sm bg-slate-900 border-slate-700"
        />

        {/* Search mode toggle */}
        <div className="flex gap-1.5 mt-2">
          <button
            onClick={() => setSearchMode('text')}
            className={cn(
              'flex-1 px-2 py-1 text-xs rounded-md transition-colors',
              searchMode === 'text'
                ? 'bg-slate-800 text-white'
                : 'bg-slate-900 text-slate-500 hover:text-slate-300',
            )}
          >
            Text Search
          </button>
          <button
            onClick={() => setSearchMode('hybrid')}
            className={cn(
              'flex-1 px-2 py-1 text-xs rounded-md transition-colors',
              searchMode === 'hybrid'
                ? 'bg-indigo-900/60 text-indigo-300'
                : 'bg-slate-900 text-slate-500 hover:text-slate-300',
            )}
          >
            Smart Search
          </button>
        </div>
      </div>

      {/* Type filters (text mode only) */}
      {!isHybrid && (
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
      )}

      {/* Results count */}
      <div className="px-3 py-2 flex items-center justify-between text-xs text-slate-500 border-b border-slate-800">
        <span>
          {isLoading
            ? 'Loading...'
            : isHybrid
              ? `${hybridHits.length} result${hybridHits.length !== 1 ? 's' : ''}`
              : `${nodes.length} of ${totalCount} nodes`
          }
        </span>
        {!isHybrid && isFetchingNextPage && (
          <span className="text-indigo-400">Loading more...</span>
        )}
        {isHybrid && hybridData?.stats && (
          <span className="text-slate-600">
            V:{hybridData.stats.vectorHits} T:{hybridData.stats.textHits} G:{hybridData.stats.graphHits}
          </span>
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
            // ---- Hybrid mode row ----
            if (isHybrid) {
              const hit = hybridHits[virtualRow.index];
              if (!hit) return null;
              const nodeLabel = hit.nodeType as NodeLabel;
              const color = NODE_COLORS[nodeLabel] ?? '#64748b';
              const pct = Math.round(hit.score * 100);

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
                    onClick={() => onNodeSelect?.(hitToGraphNode(hit))}
                    className="w-full h-full text-left px-2 py-1.5 rounded hover:bg-slate-800 transition-colors group"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-sm text-slate-300 truncate group-hover:text-white flex-1">
                        {hit.name}
                      </span>

                      {/* Source badges */}
                      <div className="flex items-center gap-1 shrink-0">
                        {hit.sources.map((src) => {
                          const badge = SOURCE_BADGES[src];
                          if (!badge) return null;
                          return (
                            <span
                              key={src}
                              className="text-[10px] leading-none"
                              title={badge.label}
                            >
                              {badge.icon}
                            </span>
                          );
                        })}
                      </div>

                      {/* Score badge */}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 tabular-nums shrink-0">
                        {pct}%
                      </span>
                    </div>

                    {hit.filePath && (
                      <div className="text-xs text-slate-600 truncate ml-4 mt-0.5">
                        {hit.filePath.split('/').slice(-2).join('/')}
                      </div>
                    )}
                  </button>
                </div>
              );
            }

            // ---- Text mode row (unchanged) ----
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
        {!isLoading && displayCount === 0 && (
          <div className="text-xs text-slate-500 text-center py-4">
            {searchQuery
              ? isHybrid
                ? 'No results found. Try a different query.'
                : 'No nodes match your search'
              : isHybrid
                ? 'Type a query to search across code, vectors, and graph'
                : 'No nodes found'
            }
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

        {/* Load more trigger (text mode only) */}
        {!isHybrid && hasNextPage && !isFetchingNextPage && (
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
