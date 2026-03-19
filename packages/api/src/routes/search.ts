/**
 * Search routes - /api/search
 * Code search via enrichedSearchV2
 * @module routes/search
 */

import { Hono } from 'hono';
import type { SearchResult, NodeLabel } from '@codegraph/types';
import { codeGraphService } from '@codegraph/core';

const search = new Hono();

/**
 * GET /api/search
 * Search code by name or meaning.
 *
 * @query q - Search query string (required)
 * @query limit - Maximum results (default: 20)
 * @query scope - Path prefix to scope search
 */
search.get('/', async (c) => {
  const q = c.req.query('q') ?? '';
  const limitParam = c.req.query('limit');
  const scope = c.req.query('scope');

  if (!q.trim()) {
    return c.json({ query: q, results: [] as SearchResult[], count: 0 });
  }

  const limit = limitParam ? Math.min(parseInt(limitParam, 10), 100) : 20;

  const result = await codeGraphService.search(q, {
    limit,
    ...(scope ? { scope } : {}),
  });

  const results: SearchResult[] = result.hits.map(h => {
    const sr: SearchResult = {
      id: `${h.nodeType}:${h.filePath}:${h.name}:${h.startLine ?? 0}`,
      name: h.name,
      type: h.nodeType as NodeLabel,
      filePath: h.filePath ?? '',
    };
    if (h.startLine != null) sr.line = h.startLine;
    return sr;
  });

  return c.json({
    query: q,
    results,
    count: results.length,
    durationMs: result.meta.durationMs,
  });
});

export { search };
