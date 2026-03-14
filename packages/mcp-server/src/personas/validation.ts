/**
 * Shared input validation for persona handlers.
 *
 * Centralizes path validation, result limits, and query size limits
 * so all personas apply consistent guardrails.
 */

import path from 'node:path';
import { loadConfig } from '@codegraph/core';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'MCP:Persona:Validation' });

/** Max query/cypher string length (10KB) */
export const MAX_QUERY_LENGTH = 10_000;

/** Max results any persona will return */
export const MAX_RESULT_LIMIT = 1000;

/** Default result limit when not specified */
export const DEFAULT_RESULT_LIMIT = 20;

// ============================================================================
// Config cache — avoids disk reads on every persona call
// ============================================================================

/** Cached active project paths */
let cachedActiveProjects: string[] | null = null;
/** When the cache was last refreshed */
let cacheTimestamp = 0;
/** Cache TTL: 30 seconds — balances freshness vs disk I/O */
const CACHE_TTL_MS = 30_000;

async function getActiveProjects(): Promise<string[]> {
  const now = Date.now();
  if (cachedActiveProjects !== null && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedActiveProjects;
  }
  const config = await loadConfig();
  cachedActiveProjects = config?.activeProjects ?? [];
  cacheTimestamp = now;
  return cachedActiveProjects;
}

/** Force-refresh the cache (call after config changes) */
export function invalidateConfigCache(): void {
  cachedActiveProjects = null;
  cacheTimestamp = 0;
}

/**
 * Validate and resolve a file path against active project directories.
 * Returns the resolved path if valid, or an error string if invalid.
 */
export async function validateFilePath(filePath: string): Promise<{ valid: true; resolved: string } | { valid: false; error: string }> {
  if (!filePath || typeof filePath !== 'string') {
    return { valid: false, error: 'File path is required and must be a string' };
  }

  // Resolve to absolute path
  const resolved = path.resolve(filePath);

  // Check for path traversal patterns
  if (filePath.includes('..') && resolved !== path.resolve(filePath)) {
    return { valid: false, error: 'Path traversal detected' };
  }

  // Get active project directories (cached)
  const activeProjects = await getActiveProjects();

  // If no projects configured, allow any path (setup not complete)
  if (activeProjects.length === 0) {
    return { valid: true, resolved };
  }

  // Check that the path is within an active project directory
  const isWithinProject = activeProjects.some(projectDir => {
    const resolvedProject = path.resolve(projectDir);
    return resolved.startsWith(resolvedProject + path.sep) || resolved === resolvedProject;
  });

  if (!isWithinProject) {
    logger.warn('Path validation failed: path outside active projects', { filePath: resolved, activeProjects });
    return { valid: false, error: `Path "${filePath}" is outside active project directories` };
  }

  return { valid: true, resolved };
}

/**
 * Clamp a result limit to a safe range.
 */
export function clampLimit(limit: number | undefined, defaultLimit = DEFAULT_RESULT_LIMIT): number {
  if (limit === undefined || limit === null) return defaultLimit;
  if (typeof limit !== 'number' || limit < 1) return defaultLimit;
  return Math.min(limit, MAX_RESULT_LIMIT);
}

/**
 * Validate query string length.
 */
export function validateQueryLength(query: string): { valid: true } | { valid: false; error: string } {
  if (!query || typeof query !== 'string') {
    return { valid: false, error: 'Query is required and must be a string' };
  }
  if (query.length > MAX_QUERY_LENGTH) {
    return { valid: false, error: `Query too large (${query.length} chars). Max: ${MAX_QUERY_LENGTH}` };
  }
  return { valid: true };
}
