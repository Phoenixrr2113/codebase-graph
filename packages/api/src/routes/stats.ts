/**
 * Stats routes - /api/stats
 * Endpoints for graph statistics
 * @module routes/stats
 */

import { Hono } from 'hono';
import { createLogger } from '@codegraph/logger';
import { getQueries } from '../model';

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
    const queries = await getQueries();
    const graphStats = await queries.getStats();

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

export { stats };

