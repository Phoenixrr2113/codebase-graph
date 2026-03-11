/**
 * Stats routes - /api/stats
 * Endpoints for graph statistics
 * @module routes/stats
 */

import { Hono } from 'hono';
import { createLogger } from '@codegraph/logger';
import { codeGraphService } from '@codegraph/core';

const logger = createLogger({ namespace: 'API:Stats' });

const stats = new Hono();

/**
 * GET /api/stats
 * Get graph statistics including node/edge counts by type
 * 
 * @returns Graph statistics object with counts and top entities
 */
stats.get('/', async (c) => {
  try {
    const graphStats = await codeGraphService.getGraphStats();

    return c.json(graphStats);
  } catch (error) {
    logger.error('Failed to get stats', error);
    return c.json({
      totalNodes: 0,
      totalEdges: 0,
      nodesByType: {
        File: 0,
        Class: 0,
        Interface: 0,
        Function: 0,
        Variable: 0,
        Import: 0,
        Type: 0,
        Component: 0,
      },
      edgesByType: {
        CONTAINS: 0,
        IMPORTS: 0,
        IMPORTS_SYMBOL: 0,
        CALLS: 0,
        EXTENDS: 0,
        IMPLEMENTS: 0,
        USES_TYPE: 0,
        RETURNS: 0,
        HAS_PARAM: 0,
        HAS_METHOD: 0,
        HAS_PROPERTY: 0,
        RENDERS: 0,
        USES_HOOK: 0,
      },
      largestFiles: [],
      mostConnected: [],
    });
  }
});

/**
 * GET /api/stats/embeddings
 * Get embedding coverage statistics across node types
 *
 * @returns Embedding stats with total counts and per-type breakdown
 *
 * @example Response:
 * {
 *   totalWithEmbeddings: 142,
 *   totalNodes: 500,
 *   byType: { Function: 80, Class: 30, Interface: 32 }
 * }
 */
stats.get('/embeddings', async (c) => {
  try {
    const [embeddingResult, totalResult] = await Promise.all([
      codeGraphService.executeReadQuery(
        'MATCH (n) WHERE n.embedding IS NOT NULL RETURN labels(n)[0] AS type, count(n) AS count',
      ),
      codeGraphService.executeReadQuery(
        'MATCH (n) RETURN count(n) AS total',
      ),
    ]);

    const byType: Record<string, number> = {};
    let totalWithEmbeddings = 0;

    for (const row of embeddingResult.results as Array<{ type: string; count: number }>) {
      byType[row.type] = row.count;
      totalWithEmbeddings += row.count;
    }

    const totalNodes = ((totalResult.results as Array<{ total: number }>)[0]?.total) ?? 0;

    return c.json({ totalWithEmbeddings, totalNodes, byType });
  } catch (error) {
    logger.error('Failed to get embedding stats', error);
    return c.json({ totalWithEmbeddings: 0, totalNodes: 0, byType: {} });
  }
});

export { stats };

