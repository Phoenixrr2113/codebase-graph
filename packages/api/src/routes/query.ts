import { Hono } from 'hono';
import { getGraphClient } from '@codegraph/core';

export const queryRoutes = new Hono();

/** Mutation keywords to reject in read-only Cypher endpoint */
const MUTATION_KEYWORDS = /\b(CREATE|MERGE|SET|DELETE|DETACH|REMOVE|DROP)\b/i;

/** POST /api/query/cypher — execute read-only Cypher query */
queryRoutes.post('/api/query/cypher', async (c) => {
  try {
    const body = await c.req.json();
    const query = body.query as string;
    const rawParams = (body.params ?? {}) as Record<string, string | number | boolean | unknown[] | null>;

    if (!query) return c.json({ error: 'query field is required' }, 400);

    // Reject mutations
    if (MUTATION_KEYWORDS.test(query)) {
      return c.json({ error: 'Only read-only queries are allowed. Mutation keywords detected.' }, 400);
    }

    const client = await getGraphClient();
    const result = await client.roQuery(query, { params: rawParams });

    return c.json({ results: result.data });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Query failed' }, 500);
  }
});
