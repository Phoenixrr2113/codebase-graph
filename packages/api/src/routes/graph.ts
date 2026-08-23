import { Hono } from 'hono';
import { codeGraphService, getGraphClient } from '@codegraph/core';
import { createQueries } from '@codegraph/graph';
import { safeErrorMessage } from '../safe-error.js';
import { readBlockedSetupStatus } from '../storage-state.js';

export const graphRoutes = new Hono();

const FULL_GRAPH_LIMIT_MAX = 1000;
const FILE_GRAPH_LIMIT_MAX = 1000;
const INDUCED_EDGE_IDS_MAX = 2000;
const NEIGHBOR_LIMIT_MAX = 1000;
const FILE_RELATIONSHIP_LIMIT_MAX = 1000;
const REFERENCE_LIMIT_MAX = 1000;
const DEPENDENCY_DEPTH_MAX = 10;
const SYMBOL_ID_PATTERN = /^sym:v1:[a-f0-9]{64}$/;

type BoundedIntegerResult =
  | { valid: true; value?: number }
  | { valid: false; error: string };

function boundedPositiveInteger(
  raw: string | undefined,
  name: string,
  max: number,
): BoundedIntegerResult {
  if (raw === undefined) return { valid: true };
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > max) {
    return { valid: false, error: `${name} must be a positive integer between 1 and ${max}` };
  }
  return { valid: true, value };
}

function nonNegativeInteger(raw: string | undefined, name: string): BoundedIntegerResult {
  if (raw === undefined) return { valid: true };
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    return { valid: false, error: `${name} must be a non-negative integer` };
  }
  return { valid: true, value };
}

async function resolveProjectRootPath(projectId: string): Promise<string | null> {
  const client = await getGraphClient();
  const projectResult = await client.roQuery<{ rootPath: string | null }>(
    'MATCH (p:Project {id: $id}) RETURN p.rootPath AS rootPath',
    { params: { id: projectId } },
  );
  return projectResult.data[0]?.rootPath ?? null;
}

function projectFullGraphResponse<T extends {
  edges: Array<{ source: string; target: string; label: string }>;
}>(data: T): Omit<T, 'edges'> & {
  edges: Array<{ source: string; target: string; label: string }>;
} {
  return {
    ...data,
    edges: data.edges.map(({ source, target, label }) => ({ source, target, label })),
  };
}

/** GET /api/graph/full?limit=N&offset=N&projectId=X returns a degree-ordered page with scoped totals. */
graphRoutes.get('/api/graph/full', async (c) => {
  let limit = 100;
  let offset = 0;
  try {
    const parsedLimit = boundedPositiveInteger(c.req.query('limit'), 'limit', FULL_GRAPH_LIMIT_MAX);
    if (!parsedLimit.valid) return c.json({ error: parsedLimit.error }, 400);
    const parsedOffset = nonNegativeInteger(c.req.query('offset'), 'offset');
    if (!parsedOffset.valid) return c.json({ error: parsedOffset.error }, 400);
    limit = parsedLimit.value ?? limit;
    offset = parsedOffset.value ?? offset;
    const projectId = c.req.query('projectId');

    if (projectId) {
      const rootPath = await resolveProjectRootPath(projectId);
      if (!rootPath) return c.json({ error: 'Project not found' }, 404);
      const data = await codeGraphService.getFullGraph(limit, rootPath, offset);
      return c.json(projectFullGraphResponse(data));
    }

    // No project filter — return all
    const rootPath = c.req.query('rootPath') ?? undefined;
    const data = await codeGraphService.getFullGraph(limit, rootPath, offset);
    return c.json(projectFullGraphResponse(data));
  } catch (error) {
    const setup = await readBlockedSetupStatus();
    if (setup !== null) {
      return c.json({
        nodes: [],
        edges: [],
        totalNodes: 0,
        totalEdges: 0,
        windowOrder: 'degree-desc,id-asc',
        degreeScope: 'global',
        offset,
        limit,
        returned: 0,
        hasMore: false,
        nextOffset: null,
        truncated: false,
        storage: setup.storage,
      });
    }
    return c.json({ error: safeErrorMessage('GET /api/graph/full', error, 'Failed to fetch graph.') }, 500);
  }
});

/** GET /api/graph/files?projectId=X&limit=N&offset=N - bounded File-to-File IMPORTS graph. */
graphRoutes.get('/api/graph/files', async (c) => {
  try {
    const parsedLimit = boundedPositiveInteger(c.req.query('limit'), 'limit', FILE_GRAPH_LIMIT_MAX);
    if (!parsedLimit.valid) return c.json({ error: parsedLimit.error }, 400);
    const parsedOffset = nonNegativeInteger(c.req.query('offset'), 'offset');
    if (!parsedOffset.valid) return c.json({ error: parsedOffset.error }, 400);
    const limit = parsedLimit.value ?? 100;
    const offset = parsedOffset.value ?? 0;

    const projectId = c.req.query('projectId');
    let rootPath: string | undefined;
    if (projectId) {
      const resolvedRootPath = await resolveProjectRootPath(projectId);
      if (!resolvedRootPath) return c.json({ error: 'Project not found' }, 404);
      rootPath = resolvedRootPath;
    }

    const client = await getGraphClient();
    const data = await createQueries(client).getFileGraph(limit, rootPath, offset);
    return c.json(data);
  } catch (error) {
    return c.json({
      error: safeErrorMessage('GET /api/graph/files', error, 'Failed to fetch file graph.'),
    }, 500);
  }
});

/** POST /api/graph/induced-edges returns public edges among the requested persisted node ids. */
graphRoutes.post('/api/graph/induced-edges', async (c) => {
  try {
    const body: unknown = await c.req.json().catch(() => undefined);
    if (
      body === null
      || typeof body !== 'object'
      || !('ids' in body)
      || !Array.isArray(body.ids)
      || !body.ids.every((id): id is string => typeof id === 'string')
    ) {
      return c.json({ error: 'body must be an object with an ids string array' }, 400);
    }
    if (body.ids.length > INDUCED_EDGE_IDS_MAX) {
      return c.json({ error: `ids must contain at most ${INDUCED_EDGE_IDS_MAX} items` }, 400);
    }

    const projectId = c.req.query('projectId');
    let rootPath: string | undefined;
    if (projectId) {
      const resolvedRootPath = await resolveProjectRootPath(projectId);
      if (!resolvedRootPath) return c.json({ error: 'Project not found' }, 404);
      rootPath = resolvedRootPath;
    }

    const client = await getGraphClient();
    const edges = await createQueries(client).getInducedEdges(body.ids, rootPath);
    return c.json({
      edges: edges.map(({ source, target, label }) => ({ source, target, label })),
    });
  } catch (error) {
    return c.json({
      error: safeErrorMessage(
        'POST /api/graph/induced-edges',
        error,
        'Failed to fetch induced graph edges.',
      ),
    }, 500);
  }
});

/** GET /api/graph/neighbors?id=X&limit=N - direct neighbors and their induced graph. */
graphRoutes.get('/api/graph/neighbors', async (c) => {
  try {
    const parsedLimit = boundedPositiveInteger(c.req.query('limit'), 'limit', NEIGHBOR_LIMIT_MAX);
    if (!parsedLimit.valid) return c.json({ error: parsedLimit.error }, 400);

    const id = c.req.query('id');
    if (!id) return c.json({ error: 'id parameter is required' }, 400);

    const client = await getGraphClient();
    const data = await createQueries(client).getNodeNeighbors(id, parsedLimit.value ?? 100);
    if (!data) return c.json({ error: 'Graph node not found' }, 404);
    return c.json(data);
  } catch (error) {
    return c.json({
      error: safeErrorMessage('GET /api/graph/neighbors', error, 'Failed to fetch node neighbors.'),
    }, 500);
  }
});

/**
 * GET /api/graph/file-relationships?path=X&limit=N
 *
 * Returns the four relationship collections consumed by the File detail panel.
 * Each collection is independently bounded to 1..1000 items; the default is 100.
 */
graphRoutes.get('/api/graph/file-relationships', async (c) => {
  try {
    const filePath = c.req.query('path');
    if (!filePath) return c.json({ error: 'path parameter is required' }, 400);

    const parsedLimit = boundedPositiveInteger(
      c.req.query('limit'),
      'limit',
      FILE_RELATIONSHIP_LIMIT_MAX,
    );
    if (!parsedLimit.valid) return c.json({ error: parsedLimit.error }, 400);

    const client = await getGraphClient();
    const data = await createQueries(client).getFileRelationships(filePath, parsedLimit.value ?? 100);
    return c.json(data);
  } catch (error) {
    return c.json({
      error: safeErrorMessage(
        'GET /api/graph/file-relationships',
        error,
        'Failed to fetch file relationships.',
      ),
    }, 500);
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
    return c.json({ error: safeErrorMessage('GET /api/graph/file', error, 'Failed to fetch subgraph.') }, 500);
  }
});

/**
 * GET /api/graph/references?id=X&limit=M
 *
 * Where a symbol is used. The persisted symbol id is the sole declaration
 * identity accepted by this endpoint.
 */
graphRoutes.get('/api/graph/references', async (c) => {
  try {
    const parsedLimit = boundedPositiveInteger(c.req.query('limit'), 'limit', REFERENCE_LIMIT_MAX);
    if (!parsedLimit.valid) return c.json({ error: parsedLimit.error }, 400);

    const id = c.req.query('id');
    if (!id) return c.json({ error: 'id parameter is required' }, 400);
    if (!SYMBOL_ID_PATTERN.test(id)) {
      return c.json({ error: 'id must be a persisted sym:v1 identifier' }, 400);
    }

    const data = await codeGraphService.getSymbolReferences({
      id,
      limit: parsedLimit.value,
    });
    return c.json(data);
  } catch (error) {
    return c.json(
      { error: safeErrorMessage('GET /api/graph/references', error, 'Failed to fetch references.') },
      500,
    );
  }
});

/** GET /api/graph/dependencies?path=X&depth=N — returns dependency tree */
graphRoutes.get('/api/graph/dependencies', async (c) => {
  try {
    const filePath = c.req.query('path');
    if (!filePath) return c.json({ error: 'path parameter is required' }, 400);
    const parsedDepth = boundedPositiveInteger(c.req.query('depth'), 'depth', DEPENDENCY_DEPTH_MAX);
    if (!parsedDepth.valid) return c.json({ error: parsedDepth.error }, 400);
    const depth = parsedDepth.value ?? 3;
    const data = await codeGraphService.getDependencyTree(filePath, depth);
    return c.json(data);
  } catch (error) {
    return c.json({ error: safeErrorMessage('GET /api/graph/dependencies', error, 'Failed to fetch dependency tree.') }, 500);
  }
});
