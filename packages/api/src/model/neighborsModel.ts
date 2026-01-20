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
 * @param id - Center entity identifier
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

  // Build direction-specific query
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

  const result = await client.roQuery<{
    neighbor: Record<string, unknown>;
    neighborLabels: string[];
    r: Record<string, unknown>;
    rType: string;
  }>(`
    MATCH (center)
    WHERE center.path = $id OR (center.name IS NOT NULL AND center.filePath IS NOT NULL)
    MATCH ${cypherMatch}
    WHERE (neighbor.path = $id OR neighbor.name IS NOT NULL) ${edgeTypeFilter}
    RETURN neighbor, labels(neighbor) as neighborLabels, r, type(r) as rType
    LIMIT $limit
  `, { params: { id, limit: depth * 50 } });

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seenNodes = new Set<string>();
  const seenEdges = new Set<string>();

  for (const row of result.data ?? []) {
    const nodeId = (row.neighbor['name'] as string) ?? (row.neighbor['path'] as string) ?? '';
    const nodeLabel = (row.neighborLabels[0] ?? 'Unknown') as NodeLabel;

    if (nodeId && !seenNodes.has(nodeId)) {
      seenNodes.add(nodeId);
      nodes.push({
        id: nodeId,
        label: nodeLabel,
        displayName: (row.neighbor['name'] as string) ?? (row.neighbor['path'] as string) ?? 'unknown',
        filePath: (row.neighbor['filePath'] as string) ?? (row.neighbor['path'] as string),
        data: row.neighbor as unknown as GraphNode['data'],
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
