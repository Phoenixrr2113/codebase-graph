import { Hono } from 'hono';
import { codeGraphService, knowledgeService, getGraphClient, embedAllNodes } from '@codegraph/core';
import { safeErrorMessage } from '../safe-error';

export const statsRoutes = new Hono();

/** GET /api/projects — list indexed projects */
statsRoutes.get('/api/projects', async (c) => {
  try {
    const client = await getGraphClient();
    // The node records lastParsed and createdAt. There is no indexedAt property,
    // so asking for one returned null for every project.
    const result = await client.roQuery<{
      id: string;
      name: string;
      rootPath: string | null;
      lastParsed: string | null;
      createdAt: string | null;
      fileCount: number | null;
    }>(
      `MATCH (p:Project)
       RETURN p.id AS id, p.name AS name, p.rootPath AS rootPath,
              p.lastParsed AS lastParsed, p.createdAt AS createdAt, p.fileCount AS fileCount
       ORDER BY p.name`,
    );
    const projects = result.data.map((project) => ({
      id: project.id,
      name: project.name,
      rootPath: project.rootPath,
      // A project parsed once has only createdAt, and that is still when it was indexed.
      indexedAt: project.lastParsed ?? project.createdAt,
      fileCount: project.fileCount ?? 0,
    }));
    return c.json({ projects });
  } catch (error) {
    return c.json(
      { projects: [], error: safeErrorMessage('GET /api/projects', error, 'Failed to list projects.') },
      500,
    );
  }
});

/** GET /api/stats — code graph statistics */
statsRoutes.get('/api/stats', async (c) => {
  try {
    const stats = await codeGraphService.getGraphStats();
    return c.json(stats);
  } catch (error) {
    return c.json({ error: safeErrorMessage('GET /api/stats', error, 'Failed to fetch stats.') }, 500);
  }
});

/** GET /api/knowledge/stats — knowledge graph statistics */
statsRoutes.get('/api/knowledge/stats', async (c) => {
  try {
    const stats = await knowledgeService.getKnowledgeStats();
    return c.json(stats);
  } catch (error) {
    return c.json({ error: safeErrorMessage('GET /api/knowledge/stats', error, 'Failed to fetch knowledge stats.') }, 500);
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
    return c.json({ error: safeErrorMessage('GET /api/embeddings/status', error, 'Failed to fetch embedding status.') }, 500);
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
    // This message is authored by our own embedAllNodes(), not raw engine
    // output, so echoing it back in the 400 case below is safe: it is a
    // known, controlled string, not a leak. Only the unexpected-error
    // fallback goes through safeErrorMessage.
    const msg = error instanceof Error ? error.message : 'Failed to generate embeddings';
    if (msg.includes('not configured') || msg.includes('not available')) {
      return c.json({
        error: msg,
        hint: 'Set CODEGRAPH_EMBEDDING_PROVIDER=local for free local embeddings, or set VOYAGE_API_KEY for cloud embeddings.',
      }, 400);
    }
    return c.json({ error: safeErrorMessage('POST /api/embeddings/generate', error, 'Failed to generate embeddings.') }, 500);
  }
});
