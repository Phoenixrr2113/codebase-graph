import { Hono } from 'hono';
import { codeGraphService, getGraphClient } from '@codegraph/core';

export const searchRoutes = new Hono();

/**
 * Node labels the fallback Cypher search may filter on. Cypher has no way to
 * parameterize a label, so a caller-supplied type name cannot go straight
 * into the query string: `types=Function) OR (true` turns the WHERE clause
 * into `(n:Function) OR (true) AND (...)`, which matches every node
 * regardless of label. Validating against this allowlist first closes that
 * off. Kept in sync with the label set `searchByVector` validates against in
 * packages/graph/src/operations.ts (the same idea, applied here because this
 * route builds its own filter clause rather than calling that function).
 */
const VALID_NODE_TYPES = new Set([
  'File', 'Function', 'Class', 'Interface', 'Variable', 'Type', 'Component',
]);

/**
 * Parse and validate a comma-separated `types` query parameter against the
 * label allowlist. Returns the list of requested labels, or an error naming
 * the first unrecognized one so the caller can fix their request.
 */
export function parseTypeFilter(
  types: string | undefined,
): { ok: true; labels: string[] | null } | { ok: false; message: string } {
  if (!types) return { ok: true, labels: null };

  const requested = types.split(',').map(t => t.trim()).filter(t => t !== '');
  const invalid = requested.filter(t => !VALID_NODE_TYPES.has(t));

  if (invalid.length > 0) {
    return {
      ok: false,
      message: `Unknown node type(s): ${invalid.join(', ')}. Valid types are: ${[...VALID_NODE_TYPES].sort().join(', ')}.`,
    };
  }

  return { ok: true, labels: requested };
}

/** GET /api/search?q=X&types=Y&limit=N — search code symbols */
searchRoutes.get('/api/search', async (c) => {
  try {
    const query = c.req.query('q');
    if (!query) return c.json({ error: 'q parameter is required' }, 400);

    const limit = Number(c.req.query('limit') ?? 20);
    const scope = c.req.query('scope');
    const types = c.req.query('types');

    // Validate the type filter before doing any work: an unrecognized label
    // means a typo or an injection attempt, and both should fail fast rather
    // than silently falling through to an unfiltered query.
    const typeFilterResult = parseTypeFilter(types);
    if (!typeFilterResult.ok) {
      return c.json({ error: typeFilterResult.message }, 400);
    }

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

    const typeFilter = typeFilterResult.labels
      ? typeFilterResult.labels.map(t => `n:${t}`).join(' OR ')
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
