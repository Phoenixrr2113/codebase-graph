import { Hono } from 'hono';
import { codeGraphService, getGraphClient } from '@codegraph/core';

export const graphRoutes = new Hono();

/** GET /api/graph/full?limit=N&projectId=X — returns { nodes, edges } optionally filtered by project */
graphRoutes.get('/api/graph/full', async (c) => {
  try {
    const limit = Number(c.req.query('limit') ?? 100);
    const projectId = c.req.query('projectId');

    // If projectId given, resolve rootPath and filter
    if (projectId) {
      const client = await getGraphClient();

      // Get project rootPath
      const projectResult = await client.roQuery<{ rootPath: string | null }>(
        `MATCH (p:Project {id: $id}) RETURN p.rootPath AS rootPath`,
        { params: { id: projectId } },
      );
      const rootPath = projectResult.data[0]?.rootPath;

      if (rootPath) {
        // Fetch only nodes belonging to this project (by file path prefix)
        const data = await codeGraphService.getFullGraph(limit, rootPath);
        return c.json({ nodes: data.nodes, edges: data.edges });
      }
    }

    // No project filter — return all
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

/**
 * GET /api/graph/references?name=X&path=Y&startLine=N&limit=M
 *
 * Where a symbol is used. Matches every node with this name, not just one, so
 * references that land on a type-reference proxy node are included alongside
 * ones that land on the declaration itself. `path` and `startLine` are
 * optional and disambiguate between distinct declarations that share a name;
 * a matched node with no location of its own (a proxy node) is never excluded
 * by them.
 */
graphRoutes.get('/api/graph/references', async (c) => {
  try {
    const name = c.req.query('name');
    if (!name) return c.json({ error: 'name parameter is required' }, 400);

    const rawLine = c.req.query('startLine');
    const parsedLine = rawLine === undefined ? undefined : Number.parseInt(rawLine, 10);
    const startLine = parsedLine !== undefined && Number.isFinite(parsedLine) ? parsedLine : undefined;

    const rawLimit = c.req.query('limit');
    const parsedLimit = rawLimit === undefined ? undefined : Number.parseInt(rawLimit, 10);
    const limit = parsedLimit !== undefined && Number.isFinite(parsedLimit) ? parsedLimit : undefined;

    const data = await codeGraphService.getSymbolReferences({
      name,
      filePath: c.req.query('path'),
      startLine,
      limit,
    });
    return c.json(data);
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : 'Failed to fetch references' },
      500,
    );
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
