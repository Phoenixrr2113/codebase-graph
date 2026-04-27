/**
 * GET /api/profile — codebase wake-up endpoint
 *
 * Returns a static + dynamic snapshot of the project in <200ms.
 * Lets agents hydrate their understanding before tool loops kick in.
 *
 * Pattern: supermemory's /v4/profile.
 */

import { Hono } from 'hono';

export const profileRoutes = new Hono();

// ============================================================================
// Types
// ============================================================================

export interface CodebaseProfile {
  stats: { nodes: number; edges: number; files: number };
  static: {
    topImports: Array<{ name: string; importCount: number }>;
    topCallers: Array<{ name: string; callCount: number }>;
    languages: Array<{ name: string; fileCount: number }>;
  };
  dynamic: {
    recentFiles: Array<{ filePath: string; lastModified: number }>;
    recentEntities: Array<{ text: string; type: string; createdAt: number }>;
  };
}

export interface ProfileService {
  getStats(): Promise<{ nodes: number; edges: number; files: number }>;
  query(cypher: string, opts?: { params?: Record<string, unknown> }): Promise<{ data: unknown[] }>;
}

// ============================================================================
// Core function (also used by MCP codebase.profile action)
// ============================================================================

/**
 * Build a codebase profile from a ProfileService.
 *
 * Runs all queries in parallel — targets <200ms against a warm FalkorDB.
 */
export async function getProfile(
  service: ProfileService,
  opts: { projectPath?: string; limit?: number } = {},
): Promise<CodebaseProfile> {
  const limit = opts.limit ?? 10;
  const projectPath = opts.projectPath;

  // FalkorDB filter clauses
  const nodeFilter = projectPath
    ? 'WHERE n.filePath STARTS WITH $projectPath'
    : '';
  const fileFilter = projectPath
    ? 'WHERE f.path STARTS WITH $projectPath'
    : '';
  const params: Record<string, unknown> = { projectPath: projectPath ?? null, limit };

  const [
    rawStats,
    topImportsRes,
    topCallersRes,
    langsRes,
    recentFilesRes,
    recentEntitiesRes,
  ] = await Promise.all([
    service.getStats(),

    service
      .query(
        `MATCH (n)<-[:IMPORTS]-(m) ${nodeFilter}
         RETURN n.name AS name, count(m) AS importCount
         ORDER BY importCount DESC LIMIT $limit`,
        { params },
      )
      .catch(() => ({ data: [] as unknown[] })),

    service
      .query(
        `MATCH (n)<-[:CALLS]-(m) ${nodeFilter}
         RETURN n.name AS name, count(m) AS callCount
         ORDER BY callCount DESC LIMIT $limit`,
        { params },
      )
      .catch(() => ({ data: [] as unknown[] })),

    service
      .query(
        `MATCH (f:File) ${fileFilter}
         RETURN f.language AS name, count(f) AS fileCount
         ORDER BY fileCount DESC LIMIT $limit`,
        { params },
      )
      .catch(() => ({ data: [] as unknown[] })),

    service
      .query(
        `MATCH (f:File) ${fileFilter}
         RETURN f.path AS filePath, f.lastModified AS lastModified
         ORDER BY f.lastModified DESC LIMIT $limit`,
        { params },
      )
      .catch(() => ({ data: [] as unknown[] })),

    service
      .query(
        `MATCH (e:Entity)
         RETURN e.text AS text, e.type AS type, e.createdAt AS createdAt
         ORDER BY e.createdAt DESC LIMIT $limit`,
        { params },
      )
      .catch(() => ({ data: [] as unknown[] })),
  ]);

  return {
    stats: rawStats,
    static: {
      topImports: topImportsRes.data as Array<{ name: string; importCount: number }>,
      topCallers: topCallersRes.data as Array<{ name: string; callCount: number }>,
      languages: langsRes.data as Array<{ name: string; fileCount: number }>,
    },
    dynamic: {
      recentFiles: recentFilesRes.data as Array<{ filePath: string; lastModified: number }>,
      recentEntities: recentEntitiesRes.data as Array<{ text: string; type: string; createdAt: number }>,
    },
  };
}

// ============================================================================
// Hono route
// ============================================================================

/** GET /api/profile?projectPath=...&limit=... */
profileRoutes.get('/api/profile', async (c) => {
  try {
    const projectPath = c.req.query('projectPath') || undefined;
    const limitStr = c.req.query('limit');
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;

    // Dynamic import keeps @codegraph/core out of the test-time module graph
    const { codeGraphService, getGraphClient } = await import('@codegraph/core');
    const client = await getGraphClient();

    const service: ProfileService = {
      getStats: async () => {
        const stats = await codeGraphService.getGraphStats();
        return {
          nodes: stats.totalNodes,
          edges: stats.totalEdges,
          files: (stats.nodesByType as Record<string, number>)['File'] ?? 0,
        };
      },
      query: async (cypher, opts) => {
        return client.roQuery(cypher, opts) as Promise<{ data: unknown[] }>;
      },
    };

    const profile = await getProfile(service, { projectPath, limit });
    return c.json(profile);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : 'Failed to build profile' },
      500,
    );
  }
});
