/**
 * Graph routes - /api/graph/*
 * Endpoints for retrieving graph data
 */

import { Hono } from 'hono';
import { createClient, createQueries } from '@codegraph/graph';
import { HttpError } from '../middleware/errorHandler.js';

const graph = new Hono();

/**
 * GET /api/graph/full
 * Get entire graph (for small projects)
 */
graph.get('/full', async (c) => {
  const limitParam = c.req.query('limit');
  const limit = limitParam ? parseInt(limitParam, 10) : 1000;

  try {
    const client = await createClient();
    const queries = createQueries(client);
    const data = await queries.getFullGraph(limit);

    return c.json(data);
  } catch (error) {
    console.error('[Graph] Failed to get full graph:', error);
    return c.json({
      nodes: [],
      edges: [],
      error: 'Failed to fetch graph data',
    });
  }
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

  try {
    const client = await createClient();
    const queries = createQueries(client);
    const data = await queries.getFileSubgraph(filePath);

    return c.json({
      ...data,
      filePath,
    });
  } catch (error) {
    console.error('[Graph] Failed to get file subgraph:', error);
    return c.json({
      nodes: [],
      edges: [],
      filePath,
      error: 'Failed to fetch file subgraph',
    });
  }
});

export { graph };
