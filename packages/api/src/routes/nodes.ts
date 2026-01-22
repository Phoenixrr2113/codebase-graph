/**
 * Nodes routes - /api/nodes
 * Paginated node listing for sidebar with server-side search
 * @module routes/nodes
 */

import { Hono } from 'hono';
import type { NodeLabel } from '@codegraph/types';
import * as nodesModel from '../model/nodesModel';
import { getOperations } from '../model';

const nodes = new Hono();

/**
 * GET /api/nodes
 * Get paginated list of nodes with optional filtering
 * 
 * @query page - Page number (default: 1)
 * @query limit - Items per page (default: 50, max: 100)
 * @query types - Comma-separated node types (e.g., "Function,Class")
 * @query q - Search query (matches name or path)
 * @query projectId - Project ID to filter by
 * 
 * @example
 * GET /api/nodes?page=1&limit=50&types=Function,Class&q=Button&projectId=abc-123
 */
nodes.get('/', async (c) => {
  const pageParam = c.req.query('page');
  const limitParam = c.req.query('limit');
  const typesParam = c.req.query('types');
  const query = c.req.query('q');
  const projectId = c.req.query('projectId');

  const page = pageParam ? parseInt(pageParam, 10) : 1;
  const limit = limitParam ? parseInt(limitParam, 10) : 50;
  const types = typesParam
    ? (typesParam.split(',').filter(Boolean) as NodeLabel[])
    : undefined;

  // Resolve projectId to rootPath
  let rootPath: string | undefined;
  if (projectId) {
    const ops = await getOperations();
    const projects = await ops.getProjects();
    const project = projects.find(p => p.id === projectId);
    rootPath = project?.rootPath;
  }

  const result = await nodesModel.getNodes({
    page,
    limit,
    types,
    query: query ?? undefined,
    rootPath,
  });

  return c.json(result);
});

export { nodes };
