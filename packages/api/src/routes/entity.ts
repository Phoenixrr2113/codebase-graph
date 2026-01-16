/**
 * Entity routes - /api/entity/*
 * Endpoints for retrieving entity details and neighbors
 */

import { Hono } from 'hono';
import { HttpError } from '../middleware/errorHandler.js';

const entity = new Hono();

/**
 * GET /api/entity/:id
 * Get single entity with connections
 */
entity.get('/:id', async (c) => {
  const id = c.req.param('id');
  const depthParam = c.req.query('depth');
  void depthParam; // Will be used when graph queries are available

  if (!id) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Entity ID is required');
  }

  // TODO: Call graph queries when available
  // const client = await createClient();
  // const depth = depthParam ? parseInt(depthParam, 10) : 1;
  // const data = await getEntityWithConnections(client, id, depth);

  return c.json({
    entity: null,
    connections: {
      incoming: [],
      outgoing: [],
    },
    message: 'Graph queries not yet available - waiting for GRAPH-004',
  });
});

export { entity };
