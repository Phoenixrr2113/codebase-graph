/**
 * Search routes - /api/search
 * Endpoints for searching entities
 */

import { Hono } from 'hono';
import type { SearchResult } from '@codegraph/types';

const search = new Hono();

/**
 * GET /api/search
 * Search entities by name
 */
search.get('/', async (c) => {
  const q = c.req.query('q') ?? '';
  const typesParam = c.req.query('types');
  const limitParam = c.req.query('limit');
  void typesParam; // Will be used when graph search is available
  void limitParam;

  // TODO: Execute fulltext search when graph package supports it
  // const client = await createClient();
  // const types = typesParam ? typesParam.split(',') : undefined;
  // const limit = limitParam ? parseInt(limitParam, 10) : 50;
  // const results = await searchEntities(client, { q, types, limit });

  const results: SearchResult[] = [];

  return c.json({
    query: q,
    results,
    count: results.length,
    message: 'Search not yet available - waiting for GRAPH-004',
  });
});

export { search };
