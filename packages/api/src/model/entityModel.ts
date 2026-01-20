/**
 * Entity model - Data access for individual entities
 * @module model/entityModel
 */

import type { GraphNode, GraphEdge } from '@codegraph/types';
import { getClient } from './graphClient';

/**
 * Entity with its connections
 */
export interface EntityWithConnections {
  entity: {
    id: string;
    label: GraphNode['label'];
    displayName: string;
    filePath: string;
    data: GraphNode['data'];
  };
  connections: {
    incoming: GraphEdge[];
    outgoing: GraphEdge[];
  };
}

/**
 * Get an entity by ID with its incoming and outgoing connections
 * @param id - Entity identifier (path, elementId, or name:filePath)
 * @param depth - Traversal depth multiplier
 * @returns Entity with connections or null if not found
 */
export async function getWithConnections(
  id: string,
  depth: number = 1
): Promise<EntityWithConnections | null> {
  const client = await getClient();

  const result = await client.roQuery<{
    n: Record<string, unknown>;
    labels: string[];
    inEdge: Record<string, unknown> | null;
    inType: string | null;
    inNode: Record<string, unknown> | null;
    inLabels: string[] | null;
    outEdge: Record<string, unknown> | null;
    outType: string | null;
    outNode: Record<string, unknown> | null;
    outLabels: string[] | null;
  }>(`
    MATCH (n)
    WHERE elementId(n) = $id OR n.path = $id OR (n.name + ':' + n.filePath) = $id
    OPTIONAL MATCH (inNode)-[inEdge]->(n)
    OPTIONAL MATCH (n)-[outEdge]->(outNode)
    RETURN n, labels(n) as labels,
           inEdge, type(inEdge) as inType, inNode, labels(inNode) as inLabels,
           outEdge, type(outEdge) as outType, outNode, labels(outNode) as outLabels
    LIMIT $depth
  `, { params: { id, depth: depth * 10 } });

  if (!result.data || result.data.length === 0) {
    return null;
  }

  const firstRow = result.data[0]!;
  const entity = {
    id,
    label: (firstRow.labels[0] ?? 'Unknown') as GraphNode['label'],
    displayName: (firstRow.n['name'] as string) ?? (firstRow.n['path'] as string) ?? 'unknown',
    filePath: (firstRow.n['filePath'] as string) ?? (firstRow.n['path'] as string),
    data: firstRow.n as unknown as GraphNode['data'],
  };

  const incomingEdges: GraphEdge[] = [];
  const outgoingEdges: GraphEdge[] = [];
  const seenEdges = new Set<string>();

  for (const row of result.data) {
    if (row.inEdge && row.inType && row.inNode) {
      const edgeId = `${row.inType}:in:${JSON.stringify(row.inNode)}`;
      if (!seenEdges.has(edgeId)) {
        seenEdges.add(edgeId);
        incomingEdges.push({
          id: edgeId,
          source: (row.inNode['name'] as string) ?? (row.inNode['path'] as string) ?? 'unknown',
          target: id,
          label: row.inType as GraphEdge['label'],
          data: row.inEdge as unknown as GraphEdge['data'],
        });
      }
    }

    if (row.outEdge && row.outType && row.outNode) {
      const edgeId = `${row.outType}:out:${JSON.stringify(row.outNode)}`;
      if (!seenEdges.has(edgeId)) {
        seenEdges.add(edgeId);
        outgoingEdges.push({
          id: edgeId,
          source: id,
          target: (row.outNode['name'] as string) ?? (row.outNode['path'] as string) ?? 'unknown',
          label: row.outType as GraphEdge['label'],
          data: row.outEdge as unknown as GraphEdge['data'],
        });
      }
    }
  }

  return {
    entity,
    connections: {
      incoming: incomingEdges,
      outgoing: outgoingEdges,
    },
  };
}
