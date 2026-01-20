/**
 * Graph routes - /api/graph/*
 * Endpoints for retrieving graph visualization data
 * @module routes/graph
 */

import { Hono } from 'hono';
import { createLogger } from '@codegraph/logger';
import { HttpError } from '../middleware/errorHandler';
import { getQueries, getOperations } from '../model';

const logger = createLogger({ namespace: 'API:Graph' });

const graph = new Hono();

/**
 * GET /api/graph/full
 * Retrieve the complete graph or a project-filtered subset
 * 
 * @query limit - Maximum nodes to return (default: 100000)
 * @query projectId - Optional project UUID to filter by
 * @returns Graph data with nodes and edges arrays
 * 
 * @example
 * GET /api/graph/full?limit=500&projectId=abc-123
 */
graph.get('/full', async (c) => {
  const limitParam = c.req.query('limit');
  const projectId = c.req.query('projectId');
  const limit = limitParam ? parseInt(limitParam, 10) : 100000;

  try {
    const queries = await getQueries();

    let rootPath: string | undefined;
    if (projectId) {
      const ops = await getOperations();
      const projects = await ops.getProjects();
      const project = projects.find(p => p.id === projectId);
      rootPath = project?.rootPath;
    }

    const data = await queries.getFullGraph(limit, rootPath);

    return c.json(data);
  } catch (error) {
    logger.error('Failed to get full graph', error);
    return c.json({
      nodes: [],
      edges: [],
      error: 'Failed to fetch graph data',
    });
  }
});

/**
 * GET /api/graph/file/:path
 * Retrieve subgraph for a specific file and its connections
 * 
 * @param path - Absolute file path (URL encoded)
 * @returns File's nodes, edges, and relationships
 * @throws {HttpError} 400 if path is missing
 * 
 * @example
 * GET /api/graph/file/%2Fsrc%2Findex.ts
 */
graph.get('/file/:path{.*}', async (c) => {
  const filePath = c.req.param('path');
  
  if (!filePath) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'File path is required');
  }

  try {
    const queries = await getQueries();
    const data = await queries.getFileSubgraph(filePath);

    return c.json({
      ...data,
      filePath,
    });
  } catch (error) {
    logger.error('Failed to get file subgraph', error);
    return c.json({
      nodes: [],
      edges: [],
      filePath,
      error: 'Failed to fetch file subgraph',
    });
  }
});

export { graph };
