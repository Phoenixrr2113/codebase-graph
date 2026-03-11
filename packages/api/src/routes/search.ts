/**
 * Search routes - /api/search
 * Full-text search across graph entities
 * @module routes/search
 */

import { Hono } from 'hono';
import type { SearchResult, NodeLabel } from '@codegraph/types';
import { codeGraphService } from '@codegraph/core';

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
    rootPath = await codeGraphService.resolveProjectRootPath(projectId);
  }

  // Map multi-type filter to service single-type (or 'all' with client-side filtering)
  let serviceType: 'all' | 'file' | 'function' | 'class' | 'interface' | 'component' = 'all';
  if (types && types.length === 1) {
    serviceType = types[0]!.toLowerCase() as typeof serviceType;
  }

  const result = await codeGraphService.search(q, { type: serviceType, limit: limit * page });

  // Map service results to SearchResult format (with generated id)
  let allResults: SearchResult[] = result.results.map(r => {
    const sr: SearchResult = {
      id: r.type === 'File' ? `File:${r.filePath}` : `${r.type}:${r.filePath}:${r.name}:${r.line ?? 0}`,
      name: r.name,
      type: r.type as NodeLabel,
      filePath: r.filePath,
    };
    if (r.line !== undefined) sr.line = r.line;
    return sr;
  });

  // Filter by types client-side if multiple types specified
  if (types && types.length > 1) {
    allResults = allResults.filter(r => types.includes(r.type));
  }

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
