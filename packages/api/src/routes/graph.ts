/**
 * Graph routes - /api/graph/*
 * Endpoints for retrieving graph data
 */

import { Hono } from 'hono';
import { HttpError } from '../middleware/errorHandler.js';

const graph = new Hono();

// Note: Full implementation requires @codegraph/graph queries module (GRAPH-004)
// Currently returns placeholder responses until graph package exports are updated

/**
 * GET /api/graph/full
 * Get entire graph (for small projects)
 */
graph.get('/full', async (c) => {
  const limitParam = c.req.query('limit');
  void limitParam; // Will be used when graph queries are available

  // TODO: Call graph queries when available
  // const client = await createClient();
  // const limit = limitParam ? parseInt(limitParam, 10) : 1000;
  // const data = await getFullGraph(client, limit);

  return c.json({
    nodes: [],
    edges: [],
    message: 'Graph queries not yet available - waiting for GRAPH-004',
  });
});

/**
 * GET /api/graph/file/:path
 * Get subgraph for a specific file
 */
graph.get('/file/:path{.*}', async (c) => {
  const filePath = c.req.param('path');
  
  if (!filePath) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'File path is required');
  }

  // TODO: Call graph queries when available
  // const client = await createClient();
  // const data = await getFileSubgraph(client, filePath);

  return c.json({
    nodes: [],
    edges: [],
    filePath,
    message: 'Graph queries not yet available - waiting for GRAPH-004',
  });
});

export { graph };
