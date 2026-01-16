/**
 * Search routes - /api/search
 * Endpoints for searching entities
 */

import { Hono } from 'hono';
import { createClient, createQueries, type SearchResult, type NodeLabel } from '@codegraph/graph';

const search = new Hono();

/**
 * GET /api/search
 * Search entities by name
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

  const client = await createClient();
  const queries = createQueries(client);

  const results = await queries.search(q, types, limit);

  return c.json({
    query: q,
    results,
    count: results.length,
  });
});

export { search };
