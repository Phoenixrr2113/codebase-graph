/**
 * Neighbors routes - /api/neighbors/*
 * @module routes/neighbors
 */

import { Hono } from 'hono';
import type { EdgeLabel } from '@codegraph/types';
import { HttpError } from '../middleware/errorHandler';
import * as neighborsModel from '../model/neighborsModel';

const neighbors = new Hono();

/**
 * GET /api/neighbors/:id
 * Get neighboring nodes with optional filters
 * 
 * @param id - Entity identifier
 * @query direction - "in", "out", or "both" (default: both)
 * @query edgeTypes - Comma-separated edge types
 * @query depth - Traversal depth (default: 1)
 * @throws {HttpError} 400 if ID missing or invalid direction
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

  const result = await neighborsModel.getNeighbors(
    id,
    direction as neighborsModel.Direction,
    edgeTypes,
    depth
  );

  return c.json(result);
});

export { neighbors };

