import { Hono } from 'hono';
import { codeGraphService } from '@codegraph/core';

export const searchRoutes = new Hono();

/** GET /api/search?q=X&types=Y&limit=N — search code symbols */
searchRoutes.get('/api/search', async (c) => {
  try {
    const query = c.req.query('q');
    if (!query) return c.json({ error: 'q parameter is required' }, 400);

    const limit = Number(c.req.query('limit') ?? 20);
    const scope = c.req.query('scope');

    const opts: { limit: number; scope?: string } = { limit };
    if (scope) opts.scope = scope;

    const result = await codeGraphService.search(query, opts);

    return c.json({
      results: result.hits,
      total: result.hits.length,
      durationMs: result.meta.durationMs,
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Search failed' }, 500);
  }
});
