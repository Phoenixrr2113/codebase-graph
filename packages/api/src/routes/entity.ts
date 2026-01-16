/**
 * Entity routes - /api/entity/*
 * Endpoints for retrieving entity details and neighbors
 */

import { Hono } from 'hono';
import { createClient } from '@codegraph/graph';
import type { GraphNode, GraphEdge } from '@codegraph/types';
import { HttpError } from '../middleware/errorHandler.js';

const entity = new Hono();

/**
 * GET /api/entity/:id
 * Get single entity with connections
 */
entity.get('/:id', async (c) => {
  const id = decodeURIComponent(c.req.param('id') ?? '');
  const depthParam = c.req.query('depth');
  const depth = depthParam ? parseInt(depthParam, 10) : 1;

  if (!id) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Entity ID is required');
  }

  const client = await createClient();

  // Query for the entity and its connections
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
    throw new HttpError(404, 'NOT_FOUND', `Entity not found: ${id}`);
  }

  // Extract entity from first row
  const firstRow = result.data[0]!;
  const entityNode = {
    id,
    label: (firstRow.labels[0] ?? 'Unknown') as GraphNode['label'],
    displayName: (firstRow.n['name'] as string) ?? (firstRow.n['path'] as string) ?? 'unknown',
    filePath: (firstRow.n['filePath'] as string) ?? (firstRow.n['path'] as string),
    data: firstRow.n as unknown as GraphNode['data'],
  };

  // Collect unique incoming and outgoing edges
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

  return c.json({
    entity: entityNode,
    connections: {
      incoming: incomingEdges,
      outgoing: outgoingEdges,
    },
  });
});

export { entity };
