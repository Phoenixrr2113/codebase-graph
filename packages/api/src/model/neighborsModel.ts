/**
 * Neighbors model - Data access for neighboring nodes
 * @module model/neighborsModel
 */

import type { GraphNode, GraphEdge, NodeLabel, EdgeLabel } from '@codegraph/types';
import { getClient } from './graphClient';

/** Direction for neighbor traversal */
export type Direction = 'in' | 'out' | 'both';

/**
 * Neighbors result with nodes, edges, and metadata
 */
export interface NeighborsResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  centerId: string;
  direction: Direction;
}

/**
 * Get neighboring nodes with direction and edge type filtering
 * @param id - Center entity identifier (format: Label:path or Label:filePath:name:line)
 * @param direction - Traversal direction
 * @param edgeTypes - Optional edge type filter
 * @param depth - Traversal depth multiplier
 * @returns Nodes and edges connected to center entity
 */
export async function getNeighbors(
  id: string,
  direction: Direction = 'both',
  edgeTypes?: EdgeLabel[],
  depth: number = 1
): Promise<NeighborsResult> {
  const client = await getClient();

  // Parse the generated ID to extract the actual path/name
  // File IDs: "File:/path/to/file.ts"
  // Other IDs: "Function:/path:functionName:42"
  const isFileId = id.startsWith('File:');
  const actualPath = isFileId ? id.substring(5) : null;
  const parts = id.split(':');

  // Build direction-specific query (bidirectional to get all edge types)
  // We want both incoming and outgoing edges to see IMPORTS, CONTAINS, CALLS, etc.
  let cypherMatch: string;
  if (direction === 'in') {
    cypherMatch = '(neighbor)-[r]->(center)';
  } else if (direction === 'out') {
    cypherMatch = '(center)-[r]->(neighbor)';
  } else {
    cypherMatch = '(center)-[r]-(neighbor)';
  }

  // Add edge type filter if specified
  const edgeTypeFilter = edgeTypes && edgeTypes.length > 0
    ? `AND type(r) IN [${edgeTypes.map(t => `'${t}'`).join(', ')}]`
    : '';

  // Build WHERE clause to match center node by path or name+filePath+line
  // For File nodes: match by path
  // For other nodes: match by filePath + name + startLine
  // Fallback: match by name or path directly
  let centerMatch: string;
  const queryParams: {
    limit: number;
    actualPath?: string;
    filePath?: string;
    name?: string;
    line?: number;
    simpleId?: string;
  } = { limit: depth * 50 };

  if (isFileId && actualPath) {
    centerMatch = 'center.path = $actualPath';
    queryParams.actualPath = actualPath;
  } else if (parts.length >= 4) {
    // Format: Label:filePath:name:line
    centerMatch = '(center.filePath = $filePath AND center.name = $name AND (center.startLine = $line OR center.line = $line))';
    queryParams.filePath = parts[1] ?? '';
    queryParams.name = parts[2] ?? '';
    queryParams.line = parseInt(parts[3] ?? '0', 10) || 0;
  } else {
    // Fallback: try matching by name or path directly
    centerMatch = '(center.name = $simpleId OR center.path = $simpleId)';
    queryParams.simpleId = id;
  }

  const result = await client.roQuery<{
    neighbor: Record<string, unknown>;
    neighborLabels: string[];
    r: Record<string, unknown>;
    rType: string;
  }>(`
    MATCH (center)
    WHERE ${centerMatch}
    MATCH ${cypherMatch}
    WHERE neighbor.path IS NOT NULL OR neighbor.name IS NOT NULL ${edgeTypeFilter}
    RETURN DISTINCT neighbor, labels(neighbor) as neighborLabels, r, type(r) as rType
    LIMIT $limit
  `, { params: queryParams });

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seenNodes = new Set<string>();
  const seenEdges = new Set<string>();

  // Helper to extract node properties from FalkorDB result (may be nested)
  function extractNodeProps(node: Record<string, unknown>): Record<string, unknown> {
    if (node['properties'] && typeof node['properties'] === 'object') {
      return node['properties'] as Record<string, unknown>;
    }
    return node;
  }

  // Helper to generate consistent node IDs (matching nodesModel pattern)
  function generateNodeId(label: string, props: Record<string, unknown>): string {
    if (label === 'File') {
      return `File:${props['path'] ?? ''}`;
    }
    const name = props['name'] ?? '';
    const filePath = props['filePath'] ?? '';
    const line = props['startLine'] ?? props['line'] ?? 0;
    return `${label}:${filePath}:${name}:${line}`;
  }

  for (const row of result.data ?? []) {
    // Extract properties from potentially nested FalkorDB node structure
    const neighborProps = extractNodeProps(row.neighbor as Record<string, unknown>);
    const nodeLabel = (row.neighborLabels[0] ?? 'File') as NodeLabel;
    const nodeId = generateNodeId(nodeLabel, neighborProps);

    if (nodeId && !seenNodes.has(nodeId)) {
      seenNodes.add(nodeId);
      nodes.push({
        id: nodeId,
        label: nodeLabel,
        displayName: (neighborProps['name'] as string) ?? (neighborProps['path'] as string) ?? 'unknown',
        filePath: (neighborProps['filePath'] as string) ?? (neighborProps['path'] as string),
        data: neighborProps as unknown as GraphNode['data'],
      } as GraphNode);
    }

    const edgeId = `${row.rType}:${id}:${nodeId}`;
    if (!seenEdges.has(edgeId)) {
      seenEdges.add(edgeId);
      edges.push({
        id: edgeId,
        source: direction === 'in' ? nodeId : id,
        target: direction === 'in' ? id : nodeId,
        label: row.rType as EdgeLabel,
        data: row.r as unknown as GraphEdge['data'],
      } as GraphEdge);
    }
  }

  return { nodes, edges, centerId: id, direction };
}
