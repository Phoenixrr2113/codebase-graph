/**
 * Neighbors routes - /api/neighbors/*
 * Endpoints for retrieving neighboring nodes
 */

import { Hono } from 'hono';
import { createClient } from '@codegraph/graph';
import type { GraphNode, GraphEdge, NodeLabel, EdgeLabel } from '@codegraph/types';
import { HttpError } from '../middleware/errorHandler';

const neighbors = new Hono();

/**
 * GET /api/neighbors/:id
 * Get neighboring nodes
 */
neighbors.get('/:id', async (c) => {
  const id = decodeURIComponent(c.req.param('id') ?? '');
  const direction = c.req.query('direction') ?? 'both';
  const edgeTypesParam = c.req.query('edgeTypes');
  const depthParam = c.req.query('depth');

  if (!id) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Entity ID is required');
  }

  if (!['in', 'out', 'both'].includes(direction)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Direction must be "in", "out", or "both"');
  }

  const edgeTypes = edgeTypesParam ? edgeTypesParam.split(',') as EdgeLabel[] : undefined;
  const depth = depthParam ? parseInt(depthParam, 10) : 1;

  const client = await createClient();

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

  return c.json({
    nodes,
    edges,
    centerId: id,
    direction,
  });
});

export { neighbors };
