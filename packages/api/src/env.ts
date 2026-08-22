/**
 * Environment bootstrap for the API server.
 *
 * The server previously read only `process.env`, so everything configured in
 * the repository's `.env` file (graph connection, embedding provider, API keys)
 * was silently ignored unless the operator exported it by hand. That made a
 * fresh checkout look misconfigured for no visible reason.
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Walk upwards from a starting directory looking for a `.env` file.
 * Returns undefined when none is found before the filesystem root.
 */
export function findEnvFile(
  startDirectory: string,
  fileExists: (path: string) => boolean = existsSync,
): string | undefined {
  let current = resolve(startDirectory);
  for (;;) {
    const candidate = resolve(current, '.env');
    if (fileExists(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * Resolve the listening port.
 *
 * `API_PORT` is the name used by `.env` and `docker-compose.yml`; `PORT` is the
 * conventional platform variable. Both are accepted so a documented setting
 * actually takes effect. Invalid values fall back to the default rather than
 * starting the server on port NaN.
 */
export function resolvePort(
  environment: Record<string, string | undefined>,
  fallback = 3001,
): number {
  for (const key of ['API_PORT', 'PORT']) {
    const raw = environment[key];
    if (raw === undefined || raw.trim() === '') continue;
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed > 0 && parsed < 65536) return parsed;
  }
  return fallback;
}

/**
 * Convert a server startup failure into one actionable line for the CLI.
 */
export function formatServerStartError(error: Error, port: number): string {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'EADDRINUSE') {
    return `CodeGraph dashboard could not start on port ${port}: the port is already in use. Set API_PORT to another port and try again.`;
  }
  if (code === 'EACCES') {
    return `CodeGraph dashboard could not start on port ${port}: permission was denied. Set API_PORT to another port and try again.`;
  }
  return `CodeGraph dashboard could not start on port ${port}: ${error.message}`;
}

/**
 * Load the nearest `.env` into `process.env` without overwriting values that
 * are already set, so explicit exports and container environments still win.
 *
 * Uses the built-in loader, which requires Node 20.12 or newer. The package
 * declares Node 20 as its floor, so this degrades to a no-op rather than
 * throwing on an older runtime.
 */
export function loadEnvironment(startDirectory?: string): string | undefined {
  // Search upward from the invoking project, not from this module. Under npx or
  // a global install the module sits in a cache directory whose ancestors are
  // unrelated to the user's project, so the .env they actually configured would
  // never be found.
  const from = startDirectory ?? process.cwd();
  const envFile = findEnvFile(from);
  if (envFile === undefined) return undefined;

  const loadEnvFile = (process as NodeJS.Process & { loadEnvFile?: (path: string) => void })
    .loadEnvFile;
  if (typeof loadEnvFile !== 'function') {
    console.warn(
      `[codegraph] Found ${envFile} but this Node build cannot read it. Upgrade to Node 20.12 or newer, or export the variables yourself.`,
    );
    return undefined;
  }

  try {
    loadEnvFile(envFile);
    return envFile;
  } catch (error) {
    console.warn(
      `[codegraph] Could not read ${envFile}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

/**
 * Decide whether a browser origin may call the API.
 *
 * The allowlist used to be the literal strings for port 3000. Next.js picks the
 * next free port when 3000 is taken, which is common, and the dashboard then
 * failed every request with a CORS error that the UI reported as "API server is
 * not running". Any loopback origin is accepted instead, since this server is a
 * local developer tool. Set CODEGRAPH_CORS_ORIGINS to a comma separated list to
 * pin an exact allowlist for a shared or hosted deployment.
 */
export function isAllowedOrigin(
  origin: string,
  configured?: string | undefined,
): boolean {
  if (configured !== undefined && configured.trim() !== '') {
    return configured
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
      .includes(origin);
  }

  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]';
}
