/**
 * GET /api/profile: codebase wake-up endpoint
 *
 * Returns a static + dynamic snapshot of the project in <200ms.
 * Lets agents hydrate their understanding before tool loops kick in.
 *
 * Pattern: supermemory's /v4/profile.
 */

import { Hono } from 'hono';
import { isAbsolute } from 'node:path';
import { safeErrorMessage } from '../safe-error.js';

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
    /** lastModified is the File node's ISO 8601 timestamp string, not epoch millis. */
    recentFiles: Array<{ filePath: string; lastModified: string }>;
    recentEntities: Array<{ text: string; type: string; createdAt: number }>;
  };
}

// ============================================================================
// Extension -> language display name
// ============================================================================

/**
 * File nodes only carry an `extension` property (see fileToNodeProps in
 * packages/graph/src/schema.ts) - there is no `language` property in the
 * graph. This maps common bare extensions (no leading dot) to a
 * human-readable language name for display; anything not listed falls back
 * to the bare extension itself.
 */
const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  go: 'Go',
  rs: 'Rust',
  java: 'Java',
  rb: 'Ruby',
  php: 'PHP',
  c: 'C',
  h: 'C',
  cpp: 'C++',
  cc: 'C++',
  cxx: 'C++',
  hpp: 'C++',
  cs: 'C#',
  swift: 'Swift',
  kt: 'Kotlin',
  kts: 'Kotlin',
  scala: 'Scala',
  sh: 'Shell',
  bash: 'Shell',
  md: 'Markdown',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  sql: 'SQL',
  vue: 'Vue',
  svelte: 'Svelte',
};

/** Maps a bare file extension to a display language name, falling back to the extension itself. */
export function languageNameForExtension(extension: string | null | undefined): string {
  if (!extension) return 'Unknown';
  return EXTENSION_LANGUAGE_MAP[extension] ?? extension;
}

export interface ProfileService {
  getStats(): Promise<{ nodes: number; edges: number; files: number }>;
  query(
    cypher: string,
    params?: Record<string, string | number | boolean | unknown[] | null>,
  ): Promise<{ data: unknown[] }>;
}

// ============================================================================
// projectPath validation
// ============================================================================

/**
 * Reject a projectPath that isn't absolute instead of letting it silently
 * build a filter that matches nothing. A relative path never matches an
 * indexed File's filePath (those are always absolute), so the old behavior
 * was a quiet empty profile with no sign anything was wrong.
 */
export function validateProjectPath(
  projectPath: string | undefined,
): { valid: true } | { valid: false; error: string } {
  if (!projectPath) return { valid: true };
  if (!isAbsolute(projectPath)) {
    return {
      valid: false,
      error: 'projectPath must be an absolute path: a relative path would not match any indexed file',
    };
  }
  return { valid: true };
}

function validateLimit(
  rawLimit: string | undefined,
): { valid: true; value?: number } | { valid: false; error: string } {
  if (rawLimit === undefined) return { valid: true };

  const limit = Number(rawLimit);
  if (!/^\d+$/.test(rawLimit) || !Number.isFinite(limit) || !Number.isSafeInteger(limit)) {
    return { valid: false, error: 'limit must be an integer between 1 and 1000' };
  }
  if (limit < 1 || limit > 1_000) {
    return { valid: false, error: 'limit must be an integer between 1 and 1000' };
  }
  return { valid: true, value: limit };
}

// ============================================================================
// Core function (also used by MCP codebase.profile action)
// ============================================================================

/**
 * Build a codebase profile from a ProfileService.
 *
 * Runs all queries in parallel and targets <200ms against a warm FalkorDB.
 */
export async function getProfile(
  service: ProfileService,
  opts: { projectPath?: string; limit?: number } = {},
): Promise<CodebaseProfile> {
  const limit = opts.limit ?? 10;
  const projectPath = opts.projectPath;

  const pathCheck = validateProjectPath(projectPath);
  if (!pathCheck.valid) {
    throw new Error(pathCheck.error);
  }

  // Strip a trailing slash so the prefix match below is boundary-safe: without
  // this, a filter built from "/proj/" would look for the literal (and
  // never-occurring) prefix "/proj//".
  const normalizedProjectPath = projectPath ? projectPath.replace(/\/+$/, '') : undefined;
  const projectPathPrefix = normalizedProjectPath ? `${normalizedProjectPath}/` : undefined;

  // FalkorDB filter clauses. A plain `STARTS WITH $projectPath` also matches
  // a sibling directory that merely shares the prefix (projectPath
  // "/x/project" would match "/x/project-extra/file.ts" too), so require
  // either an exact match on the root itself or containment under "root/".
  const nodeFilter = normalizedProjectPath
    ? 'WHERE (n.filePath = $projectPath OR n.filePath STARTS WITH $projectPathPrefix)'
    : '';
  const fileFilter = normalizedProjectPath
    ? 'WHERE (f.filePath = $projectPath OR f.filePath STARTS WITH $projectPathPrefix)'
    : '';
  const params: Record<string, string | number | boolean | null | unknown[]> = {
    projectPath: normalizedProjectPath ?? null,
    projectPathPrefix: projectPathPrefix ?? null,
    limit,
  };

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
        params,
      )
      .catch(() => ({ data: [] as unknown[] })),

    service
      .query(
        `MATCH (n)<-[:CALLS]-(m) ${nodeFilter}
         RETURN n.name AS name, count(m) AS callCount
         ORDER BY callCount DESC LIMIT $limit`,
        params,
      )
      .catch(() => ({ data: [] as unknown[] })),

    service
      .query(
        `MATCH (f:File) ${fileFilter}
         RETURN f.extension AS extension, count(f) AS fileCount
         ORDER BY fileCount DESC LIMIT $limit`,
        params,
      )
      .catch(() => ({ data: [] as unknown[] })),

    service
      .query(
        `MATCH (f:File) ${fileFilter}
         RETURN f.filePath AS filePath, f.lastModified AS lastModified
         ORDER BY f.lastModified DESC LIMIT $limit`,
        params,
      )
      .catch(() => ({ data: [] as unknown[] })),

    service
      .query(
        `MATCH (e:Entity)
         RETURN e.text AS text, e.type AS type, e.createdAt AS createdAt
         ORDER BY e.createdAt DESC LIMIT $limit`,
        params,
      )
      .catch(() => ({ data: [] as unknown[] })),
  ]);

  const languages = (langsRes.data as Array<{ extension: string; fileCount: number }>).map(
    (row) => ({ name: languageNameForExtension(row.extension), fileCount: row.fileCount }),
  );

  return {
    stats: rawStats,
    static: {
      topImports: topImportsRes.data as Array<{ name: string; importCount: number }>,
      topCallers: topCallersRes.data as Array<{ name: string; callCount: number }>,
      languages,
    },
    dynamic: {
      recentFiles: recentFilesRes.data as Array<{ filePath: string; lastModified: string }>,
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

    // Validate before touching the graph: a relative path can never match an
    // indexed File's filePath, so let this fail loudly instead of returning
    // a silently empty profile.
    const pathCheck = validateProjectPath(projectPath);
    if (!pathCheck.valid) {
      return c.json({ error: pathCheck.error }, 400);
    }

    // Profile sections share one bounded result limit. Validate before graph
    // access so malformed requests cannot reach query construction.
    const limitCheck = validateLimit(c.req.query('limit'));
    if (!limitCheck.valid) {
      return c.json({ error: limitCheck.error }, 400);
    }
    const limit = limitCheck.value;

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
      query: async (cypher, params) => {
        const result = await client.roQuery(cypher, params ? { params } : undefined);
        return { data: result.data };
      },
    };

    // Build args object conditionally to respect exactOptionalPropertyTypes
    const args: { projectPath?: string; limit?: number } = {};
    if (projectPath !== undefined) args.projectPath = projectPath;
    if (limit !== undefined) args.limit = limit;
    const profile = await getProfile(service, args);
    return c.json(profile);
  } catch (err) {
    return c.json(
      { error: safeErrorMessage('GET /api/profile', err, 'Failed to build profile.') },
      500,
    );
  }
});
