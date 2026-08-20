/**
 * Which files the source endpoint is allowed to read.
 *
 * The endpoint exists to show the code behind a graph node, so the only files it
 * ever needs are the ones inside an indexed project. Reading whatever absolute
 * path a caller names is a much larger permission than that, and the API listens
 * on localhost where any process on the machine can reach it.
 */

import { isAbsolute, resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';

export type SourceAccessDecision =
  | { ok: true; path: string }
  | { ok: false; status: 400 | 403 | 404; message: string };

/** True when `candidate` is `root` itself or sits underneath it. */
export function isInsideRoot(candidate: string, root: string): boolean {
  if (candidate === root) return true;
  const prefix = root.endsWith(sep) ? root : root + sep;
  return candidate.startsWith(prefix);
}

/**
 * Resolve a requested path and decide whether it may be read.
 *
 * Symlinks are resolved before the containment check, so a link planted inside a
 * project cannot be used to reach outside it. A path that does not exist yet
 * cannot be resolved that way, and is reported as missing rather than allowed.
 */
export function authorizeSourcePath(
  requested: string | undefined,
  roots: readonly string[],
  realpath: (path: string) => string = realpathSync,
): SourceAccessDecision {
  if (!requested) {
    return { ok: false, status: 400, message: 'path parameter is required' };
  }
  if (requested.includes('\0')) {
    return { ok: false, status: 400, message: 'path contains an invalid character' };
  }
  if (!isAbsolute(requested)) {
    return {
      ok: false,
      status: 400,
      message: 'path must be absolute: a relative path would resolve against the server, not your project',
    };
  }
  if (roots.length === 0) {
    return {
      ok: false,
      status: 403,
      message: 'no indexed project is configured, so no source file can be read',
    };
  }

  let realCandidate: string;
  try {
    realCandidate = realpath(resolve(requested));
  } catch {
    return { ok: false, status: 404, message: 'file not found' };
  }

  for (const root of roots) {
    let realRoot: string;
    try {
      realRoot = realpath(resolve(root));
    } catch {
      // A configured root that no longer exists cannot contain anything.
      continue;
    }
    if (isInsideRoot(realCandidate, realRoot)) {
      return { ok: true, path: realCandidate };
    }
  }

  return {
    ok: false,
    status: 403,
    message: 'path is outside every indexed project',
  };
}
