/**
 * Search routes - /api/search
 * Full-text search across graph entities
 * @module routes/search
 */

import { Hono } from 'hono';
import type { SearchResult, NodeLabel } from '@codegraph/graph';
import { getQueries } from '../model';

const search = new Hono();

/**
 * GET /api/search
 * Search entities by name using fuzzy matching
 * 
 * @query q - Search query string (required)
 * @query types - Comma-separated node types to filter (e.g., "Function,Class")
 * @query limit - Maximum results to return (default: 50)
 * @returns Search results with query echo and count
 * 
 * @example
 * GET /api/search?q=processPayment&types=Function&limit=10
 */
search.get('/', async (c) => {
  const q = c.req.query('q') ?? '';
  const typesParam = c.req.query('types');
  const limitParam = c.req.query('limit');

  if (!q.trim()) {
    return c.json({
      query: q,
      results: [] as SearchResult[],
      count: 0,
    });
  }

  const types = typesParam
    ? (typesParam.split(',') as NodeLabel[])
    : undefined;
  const limit = limitParam ? parseInt(limitParam, 10) : 50;

  const queries = await getQueries();
  const results = await queries.search(q, types, limit);

  return c.json({
    query: q,
    results,
    count: results.length,
  });
});

export { search };

