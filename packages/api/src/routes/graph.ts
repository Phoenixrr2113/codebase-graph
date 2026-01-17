/**
 * Graph routes - /api/graph/*
 * Endpoints for retrieving graph data
 */

import { Hono } from 'hono';
import { createClient, createQueries, createOperations } from '@codegraph/graph';
import { HttpError } from '../middleware/errorHandler';

const graph = new Hono();

/**
 * GET /api/graph/full
 * Get entire graph (optionally filtered by project)
 */
graph.get('/full', async (c) => {
  const limitParam = c.req.query('limit');
  const projectId = c.req.query('projectId');
  // Removed 1000-node limit to see full graph
  const limit = limitParam ? parseInt(limitParam, 10) : 100000;

  try {
    const client = await createClient();
    const queries = createQueries(client);

    // If projectId provided, get project's rootPath for database-level filtering
    let rootPath: string | undefined;
    if (projectId) {
      const ops = createOperations(client);
      const projects = await ops.getProjects();
      const project = projects.find(p => p.id === projectId);
      rootPath = project?.rootPath;
    }

    // Pass rootPath to query - filtering happens at database level
    const data = await queries.getFullGraph(limit, rootPath);

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
