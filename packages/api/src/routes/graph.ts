import { Hono } from 'hono';
import { codeGraphService } from '@codegraph/core';

export const graphRoutes = new Hono();

/** GET /api/graph/full?limit=N — returns { nodes, edges } */
graphRoutes.get('/api/graph/full', async (c) => {
  try {
    const limit = Number(c.req.query('limit') ?? 100);
    const rootPath = c.req.query('rootPath') ?? undefined;
    const data = await codeGraphService.getFullGraph(limit, rootPath);
    return c.json({ nodes: data.nodes, edges: data.edges });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to fetch graph' }, 500);
  }
});

/** GET /api/graph/file?path=X — returns subgraph for a file */
graphRoutes.get('/api/graph/file', async (c) => {
  try {
    const filePath = c.req.query('path');
    if (!filePath) return c.json({ error: 'path parameter is required' }, 400);
    const data = await codeGraphService.getFileSubgraph(filePath);
    return c.json(data);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to fetch subgraph' }, 500);
  }
});

/** GET /api/graph/dependencies?path=X&depth=N — returns dependency tree */
graphRoutes.get('/api/graph/dependencies', async (c) => {
  try {
    const filePath = c.req.query('path');
    if (!filePath) return c.json({ error: 'path parameter is required' }, 400);
    const depth = Number(c.req.query('depth') ?? 3);
    const data = await codeGraphService.getDependencyTree(filePath, depth);
    return c.json(data);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to fetch dependency tree' }, 500);
  }
});
