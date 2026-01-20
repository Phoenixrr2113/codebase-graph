/**
 * Entity routes - /api/entity/*
 * @module routes/entity
 */

import { Hono } from 'hono';
import { HttpError } from '../middleware/errorHandler';
import * as entityModel from '../model/entityModel';

const entity = new Hono();

/**
 * GET /api/entity/:id
 * Retrieve a single entity with its connections
 * 
 * @param id - Entity identifier
 * @query depth - Connection traversal depth (default: 1)
 * @returns Entity data with incoming/outgoing edge arrays
 * @throws {HttpError} 400 if ID missing, 404 if not found
 */
entity.get('/:id', async (c) => {
  const id = decodeURIComponent(c.req.param('id') ?? '');
  const depthParam = c.req.query('depth');
  const depth = depthParam ? parseInt(depthParam, 10) : 1;

  if (!id) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'Entity ID is required');
  }

  const result = await entityModel.getWithConnections(id, depth);

  if (!result) {
    throw new HttpError(404, 'NOT_FOUND', `Entity not found: ${id}`);
  }

  return c.json(result);
});

export { entity };

