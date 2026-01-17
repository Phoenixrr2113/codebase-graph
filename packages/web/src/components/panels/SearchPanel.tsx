'use client';

/**
 * SearchPanel Component
 * Search input and type filters for graph nodes
 */

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useUIStore } from '@/stores';
import { useGraphData } from '@/hooks/useGraphData';
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

  // Get nodes from TanStack Query - must use same projectId as AppShell for cache consistency
  const { data: graphData } = useGraphData(undefined, selectedProjectId);
  const nodes = graphData?.nodes ?? [];
  
  // Filter nodes based on search and type filters
  const filteredNodes = nodes.filter((node) => {
    // Check type filter
    if (!nodeTypeFilters.has(node.label)) return false;
    
    // Check search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      return (
        node.displayName.toLowerCase().includes(query) ||
        node.filePath?.toLowerCase().includes(query)
      );
    }
    
    return true;
  });

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

      {/* Results */}
      <div className="flex-1 min-h-0">
        <div className="px-3 py-2 flex items-center justify-between text-xs text-slate-500 border-b border-slate-800">
          <span>{filteredNodes.length} nodes</span>
        </div>
        <ScrollArea className="h-[calc(100%-32px)]">
          <div className="p-2 space-y-1">
            {filteredNodes.slice(0, 100).map((node) => (
              <button
                key={node.id}
                onClick={() => onNodeSelect?.(node)}
                className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-800 transition-colors group"
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
            ))}
            {filteredNodes.length > 100 && (
              <div className="text-xs text-slate-500 text-center py-2">
                Showing first 100 of {filteredNodes.length} nodes
              </div>
            )}
            {filteredNodes.length === 0 && (
              <div className="text-xs text-slate-500 text-center py-4">
                No nodes match your search
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

export default SearchPanel;
