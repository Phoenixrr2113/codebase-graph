import { Hono } from 'hono';
import { codeGraphService, getGraphClient } from '@codegraph/core';

export const searchRoutes = new Hono();

/** GET /api/search?q=X&types=Y&limit=N — search code symbols */
searchRoutes.get('/api/search', async (c) => {
  try {
    const query = c.req.query('q');
    if (!query) return c.json({ error: 'q parameter is required' }, 400);

    const limit = Number(c.req.query('limit') ?? 20);
    const scope = c.req.query('scope');
    const types = c.req.query('types');

    const opts: { limit: number; scope?: string } = { limit };
    if (scope) opts.scope = scope;

    // Try vector search first (requires embeddings)
    const result = await codeGraphService.search(query, opts);

    if (result.hits.length > 0) {
      return c.json({
        results: result.hits,
        total: result.hits.length,
        durationMs: result.meta.durationMs,
      });
    }

    // Fallback: text-based Cypher search when vector search returns nothing
    // (no embeddings configured, or no matches)
    const start = Date.now();
    const client = await getGraphClient();

    const typeFilter = types
      ? types.split(',').map(t => `n:${t.trim()}`).join(' OR ')
      : 'n:Function OR n:Class OR n:Interface OR n:Component OR n:Type OR n:Variable OR n:File';

    const rows = await client.roQuery<{
      name: string;
      nodeType: string;
      filePath: string | null;
      startLine: number | null;
      endLine: number | null;
      isExported: boolean | null;
    }>(
      `MATCH (n)
       WHERE (${typeFilter})
         AND (toLower(n.name) CONTAINS toLower($q) OR toLower(n.filePath) CONTAINS toLower($q))
       RETURN n.name AS name,
              labels(n)[0] AS nodeType,
              n.filePath AS filePath,
              n.startLine AS startLine,
              n.endLine AS endLine,
              n.isExported AS isExported
       ORDER BY CASE WHEN toLower(n.name) = toLower($q) THEN 0 ELSE 1 END, n.name
       LIMIT $limit`,
      { params: { q: query, limit } },
    );

    const durationMs = Date.now() - start;

    return c.json({
      results: rows.data.map(r => ({
        name: r.name,
        nodeType: r.nodeType,
        filePath: r.filePath,
        startLine: r.startLine,
        endLine: r.endLine,
        isExported: r.isExported,
      })),
      total: rows.data.length,
      durationMs,
      fallback: true,
      notice: result.meta.notice,
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Search failed' }, 500);
  }
});
