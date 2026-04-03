import { Hono } from 'hono';
import { codeGraphService, knowledgeService, getGraphClient, embedAllNodes } from '@codegraph/core';

export const statsRoutes = new Hono();

/** GET /api/stats — code graph statistics */
statsRoutes.get('/api/stats', async (c) => {
  try {
    const stats = await codeGraphService.getGraphStats();
    return c.json(stats);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to fetch stats' }, 500);
  }
});

/** GET /api/knowledge/stats — knowledge graph statistics */
statsRoutes.get('/api/knowledge/stats', async (c) => {
  try {
    const stats = await knowledgeService.getKnowledgeStats();
    return c.json(stats);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to fetch knowledge stats' }, 500);
  }
});

/** GET /api/embeddings/status — embedding coverage per label */
statsRoutes.get('/api/embeddings/status', async (c) => {
  try {
    const client = await getGraphClient();

    // Get counts of nodes with and without embeddings per label
    const result = await client.roQuery<{
      label: string;
      total: number;
      withEmbedding: number;
    }>(
      `MATCH (n)
       WHERE labels(n)[0] IS NOT NULL
       WITH labels(n)[0] AS label, n
       RETURN label,
              count(n) AS total,
              sum(CASE WHEN n.embedding IS NOT NULL THEN 1 ELSE 0 END) AS withEmbedding
       ORDER BY total DESC`,
    );

    const labels = result.data.map((row) => ({
      label: row.label,
      total: row.total,
      withEmbedding: row.withEmbedding,
      coverage: row.total > 0 ? Math.round((row.withEmbedding / row.total) * 100) : 0,
    }));

    return c.json({ labels });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to fetch embedding status' }, 500);
  }
});

/** POST /api/embeddings/generate — generate embeddings for all nodes */
statsRoutes.post('/api/embeddings/generate', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const force = (body as Record<string, unknown>).force === true;

    const result = await embedAllNodes({ force });

    return c.json({
      ...result,
      message: `Embedded ${result.embedded} nodes in ${(result.durationMs / 1000).toFixed(1)}s (${result.skipped} skipped, ${result.errors} errors)`,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Failed to generate embeddings';
    if (msg.includes('not configured') || msg.includes('not available')) {
      return c.json({
        error: msg,
        hint: 'Set CODEGRAPH_EMBEDDING_PROVIDER=local for free local embeddings, or set VOYAGE_API_KEY for cloud embeddings.',
      }, 400);
    }
    return c.json({ error: msg }, 500);
  }
});
