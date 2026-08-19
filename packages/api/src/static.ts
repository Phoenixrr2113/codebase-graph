/**
 * Static file serving for the bundled dashboard.
 *
 * Hono's node serveStatic resolves its root relative to the process working
 * directory and rejects absolute paths, which does not work for a binary that
 * users run from an arbitrary directory. This serves the built dashboard from
 * an absolute directory instead, with explicit traversal protection.
 */

import { existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

/** Content types for the file kinds a Vite build emits. */
const contentTypes: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
};

export function contentTypeFor(filePath: string): string {
  return contentTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Map a request path to a file inside `root`.
 *
 * Returns null when the path escapes the root, which is the case a traversal
 * attempt such as `/../../etc/passwd` produces. Callers must treat null as a
 * refusal rather than falling back to any other lookup.
 */
export function resolveStaticPath(urlPath: string, root: string): string | null {
  const rootAbsolute = resolve(root);

  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0] ?? '');
  } catch {
    return null; // Malformed percent-encoding.
  }

  // A null byte can truncate a path in some downstream APIs.
  if (decoded.includes('\0')) return null;

  const relative = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '');
  const candidate = resolve(join(rootAbsolute, relative));

  if (candidate !== rootAbsolute && !candidate.startsWith(rootAbsolute + sep)) {
    return null;
  }
  return candidate;
}

/** True when the request is for a build asset rather than an application route. */
export function isAssetRequest(urlPath: string): boolean {
  return extname(urlPath.split('?')[0] ?? '') !== '';
}

export interface DashboardAsset {
  path: string;
  contentType: string;
  size: number;
  /** Hashed Vite assets are content addressed, so they can be cached forever. */
  immutable: boolean;
}

/**
 * Find the file to serve for a request, applying single-page-app fallback:
 * unknown non-asset routes render index.html so client-side navigation works,
 * while a missing asset stays a genuine 404.
 */
export function findDashboardAsset(urlPath: string, root: string): DashboardAsset | null {
  const resolved = resolveStaticPath(urlPath, root);
  if (resolved === null) return null;

  const candidates: string[] = [];
  if (existsSync(resolved) && statSync(resolved).isDirectory()) {
    candidates.push(join(resolved, 'index.html'));
  } else {
    candidates.push(resolved);
  }
  if (!isAssetRequest(urlPath)) {
    candidates.push(join(resolve(root), 'index.html'));
  }

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    const stats = statSync(candidate);
    if (!stats.isFile()) continue;
    return {
      path: candidate,
      contentType: contentTypeFor(candidate),
      size: stats.size,
      immutable: /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(candidate),
    };
  }
  return null;
}

/**
 * Locate the built dashboard.
 *
 * Checked in order: an explicit override, the copy bundled next to the server
 * in a published package, then the monorepo build output for local development.
 * Returns undefined when the dashboard was never built, which is a supported
 * state: the API still serves its JSON endpoints.
 */
export function resolveDashboardDir(
  serverDir: string,
  environment: Record<string, string | undefined> = process.env,
  dirExists: (path: string) => boolean = (path) => existsSync(path),
): string | undefined {
  const override = environment['CODEGRAPH_DASHBOARD_DIR'];
  if (override !== undefined && override.trim() !== '') {
    const resolved = resolve(override);
    return dirExists(join(resolved, 'index.html')) ? resolved : undefined;
  }

  const candidates = [
    join(serverDir, 'dashboard'),
    join(serverDir, '..', 'dashboard'),
    join(serverDir, '..', '..', 'dashboard', 'dist'),
    join(serverDir, '..', '..', '..', 'dashboard', 'dist'),
  ];
  for (const candidate of candidates) {
    if (dirExists(join(candidate, 'index.html'))) return resolve(candidate);
  }
  return undefined;
}
