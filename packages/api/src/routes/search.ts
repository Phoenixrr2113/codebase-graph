/**
 * Search routes - /api/search
 * Full-text search across graph entities
 * @module routes/search
 */

import { Hono } from 'hono';
import type { SearchResult, NodeLabel } from '@codegraph/graph';
import { getQueries, getOperations } from '../model';

const search = new Hono();

/**
 * GET /api/search
 * Search entities by name using fuzzy matching
 * 
 * @query q - Search query string (required)
 * @query types - Comma-separated node types to filter (e.g., "Function,Class")
 * @query limit - Maximum results to return (default: 50)
 * @query page - Page number for pagination (default: 1)
 * @query projectId - Project ID to filter by
 * @returns Search results with query echo, count, and pagination
 * 
 * @example
 * GET /api/search?q=processPayment&types=Function&limit=10&projectId=abc-123
 */
search.get('/', async (c) => {
  const q = c.req.query('q') ?? '';
  const typesParam = c.req.query('types');
  const limitParam = c.req.query('limit');
  const pageParam = c.req.query('page');
  const projectId = c.req.query('projectId');

  if (!q.trim()) {
    return c.json({
      query: q,
      results: [] as SearchResult[],
      count: 0,
      pagination: {
        page: 1,
        limit: 50,
        totalCount: 0,
        totalPages: 0,
        hasMore: false,
      },
    });
  }

  const types = typesParam
    ? (typesParam.split(',') as NodeLabel[])
    : undefined;
  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 100) : 50;
  const page = pageParam ? parseInt(pageParam, 10) : 1;

  // Resolve projectId to rootPath for filtering
  let rootPath: string | undefined;
  if (projectId) {
    const ops = await getOperations();
    const projects = await ops.getProjects();
    const project = projects.find(p => p.id === projectId);
    rootPath = project?.rootPath;
  }

  const queries = await getQueries();
  // Note: The underlying search doesn't support pagination yet, 
  // so we fetch more and slice. For true pagination, use /api/nodes.
  const allResults = await queries.search(q, types, limit * page);

  // Filter by rootPath if specified
  const filteredResults = rootPath
    ? allResults.filter(r => r.filePath?.startsWith(rootPath!))
    : allResults;

  // Apply client-side pagination
  const startIdx = (page - 1) * limit;
  const results = filteredResults.slice(startIdx, startIdx + limit);
  const totalCount = filteredResults.length;
  const totalPages = Math.ceil(totalCount / limit);

  return c.json({
    query: q,
    results,
    count: results.length,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages,
      hasMore: page < totalPages,
    },
  });
});

export { search };

