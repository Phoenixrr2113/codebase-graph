/**
 * Neighbors routes - /api/neighbors/*
 * Endpoints for retrieving neighboring nodes
 */

import { Hono } from 'hono';
import { HttpError } from '../middleware/errorHandler.js';

const neighbors = new Hono();

/**
 * GET /api/neighbors/:id
 * Get neighboring nodes
 */
neighbors.get('/:id', async (c) => {
  const id = c.req.param('id');
  const direction = c.req.query('direction') ?? 'both';
  const edgeTypesParam = c.req.query('edgeTypes');
  const depthParam = c.req.query('depth');
  void edgeTypesParam; // Will be used when graph queries are available
  void depthParam;

  if (!id) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Entity ID is required');
  }

  if (!['in', 'out', 'both'].includes(direction)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Direction must be "in", "out", or "both"');
  }

  // TODO: Call graph queries when available
  // const client = await createClient();
  // const edgeTypes = edgeTypesParam ? edgeTypesParam.split(',') : undefined;
  // const depth = depthParam ? parseInt(depthParam, 10) : 1;
  // const data = await getNeighbors(client, id, { direction, edgeTypes, depth });

  return c.json({
    nodes: [],
    edges: [],
    centerId: id,
    direction,
    message: 'Graph queries not yet available - waiting for GRAPH-004',
  });
});

export { neighbors };
