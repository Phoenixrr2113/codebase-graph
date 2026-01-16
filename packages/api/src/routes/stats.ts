/**
 * Stats routes - /api/stats
 * Endpoints for graph statistics
 */

import { Hono } from 'hono';
import type { GraphStats } from '@codegraph/types';

const stats = new Hono();

/**
 * GET /api/stats
 * Get graph statistics
 */
stats.get('/', async (c) => {
  // TODO: Call graph queries when available
  // const client = await createClient();
  // const stats = await getStats(client);

  const emptyStats: GraphStats = {
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
  };

  return c.json(emptyStats);
});

export { stats };
