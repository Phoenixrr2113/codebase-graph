import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { isInsideRoot } from './source-access.js';

export const DIRECTORY_ENTRY_LIMIT = 500;

export const PROJECT_MARKERS = [
  '.git',
  'package.json',
  'pnpm-workspace.yaml',
  'Cargo.toml',
  'pyproject.toml',
  'go.mod',
  'setup.py',
  'composer.json',
  'Gemfile',
  'build.gradle',
  'pom.xml',
] as const;

export type ProjectMarker = (typeof PROJECT_MARKERS)[number];

export interface DirectoryBrowseEntry {
  name: string;
  path: string;
  projectMarkers: ProjectMarker[];
  isSymlink: boolean;
}

export interface DirectoryBrowseResponse {
  path: string | null;
  parent: string | null;
  entries: DirectoryBrowseEntry[];
  truncated: boolean;
}

export class FsBrowseError extends Error {
  public constructor(
    public readonly status: 400 | 403 | 404,
    message: string,
  ) {
    super(message);
    this.name = 'FsBrowseError';
  }
}

interface BrowseOptions {
  includeHidden?: boolean;
}

interface DirectoryCandidate {
  name: string;
  path: string;
  markerPath: string;
  isSymlink: boolean;
}

async function normalizedDirectory(path: string): Promise<string | null> {
  try {
    const normalized = await realpath(resolve(path));
    const metadata = await stat(normalized);
    return metadata.isDirectory() ? normalized : null;
  } catch {
    return null;
  }
}

export async function resolveBrowseRoots(
  homeDirectory: string,
  configuredRoots: string | undefined,
): Promise<string[]> {
  const candidates = [homeDirectory];
  if (configuredRoots !== undefined) {
    candidates.push(
      ...configuredRoots
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '' && isAbsolute(entry)),
    );
  }

  const roots = new Set<string>();
  for (const candidate of candidates) {
    const normalized = await normalizedDirectory(candidate);
    if (normalized !== null) roots.add(normalized);
  }
  return Array.from(roots);
}

async function projectMarkers(directory: string): Promise<ProjectMarker[]> {
  const checks = await Promise.all(
    PROJECT_MARKERS.map(async (marker): Promise<ProjectMarker | null> => {
      try {
        await lstat(join(directory, marker));
        return marker;
      } catch {
        return null;
      }
    }),
  );
  return checks.filter((marker): marker is ProjectMarker => marker !== null);
}

async function rootEntries(
  roots: readonly string[],
): Promise<DirectoryBrowseEntry[]> {
  return Promise.all(
    roots.map(async (root) => ({
      name: basename(root) || root,
      path: root,
      projectMarkers: await projectMarkers(root),
      isSymlink: false,
    })),
  );
}

async function directoryCandidates(
  directory: string,
  roots: readonly string[],
  includeHidden: boolean,
): Promise<DirectoryCandidate[]> {
  const directoryEntries = await readdir(directory, { withFileTypes: true });
  const candidates = await Promise.all(
    directoryEntries.map(async (entry): Promise<DirectoryCandidate | null> => {
      if (!includeHidden && entry.name.startsWith('.')) return null;

      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        return {
          name: entry.name,
          path: entryPath,
          markerPath: entryPath,
          isSymlink: false,
        };
      }
      if (!entry.isSymbolicLink()) return null;

      try {
        const resolvedTarget = await realpath(entryPath);
        if (!roots.some((root) => isInsideRoot(resolvedTarget, root)))
          return null;
        if (!(await stat(resolvedTarget)).isDirectory()) return null;
        return {
          name: entry.name,
          path: entryPath,
          markerPath: resolvedTarget,
          isSymlink: true,
        };
      } catch {
        return null;
      }
    }),
  );

  return candidates
    .filter((entry): entry is DirectoryCandidate => entry !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function browseDirectories(
  requestedPath: string | undefined,
  browseRoots: readonly string[],
  options: BrowseOptions = {},
): Promise<DirectoryBrowseResponse> {
  const roots = (
    await Promise.all(browseRoots.map((root) => normalizedDirectory(root)))
  ).filter((root): root is string => root !== null);

  if (requestedPath === undefined || requestedPath === '') {
    const entries = (await rootEntries(roots)).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    return { path: null, parent: null, entries, truncated: false };
  }
  if (requestedPath.includes('\0')) {
    throw new FsBrowseError(400, 'path contains an invalid character');
  }
  if (!isAbsolute(requestedPath)) {
    throw new FsBrowseError(400, 'path must be absolute');
  }
  if (roots.length === 0) {
    throw new FsBrowseError(403, 'no filesystem browse root is configured');
  }

  let normalizedPath: string;
  try {
    normalizedPath = await realpath(resolve(requestedPath));
  } catch {
    throw new FsBrowseError(404, 'directory not found');
  }

  const containingRoot = roots
    .filter((root) => isInsideRoot(normalizedPath, root))
    .sort((left, right) => right.length - left.length)[0];
  if (containingRoot === undefined) {
    throw new FsBrowseError(
      403,
      'path is outside every filesystem browse root',
    );
  }

  let metadata;
  try {
    metadata = await stat(normalizedPath);
  } catch {
    throw new FsBrowseError(404, 'directory not found');
  }
  if (!metadata.isDirectory()) {
    throw new FsBrowseError(400, 'path must identify a directory');
  }

  const candidates = await directoryCandidates(
    normalizedPath,
    roots,
    options.includeHidden === true,
  );
  const truncated = candidates.length > DIRECTORY_ENTRY_LIMIT;
  const entries = await Promise.all(
    candidates.slice(0, DIRECTORY_ENTRY_LIMIT).map(async (entry) => ({
      name: entry.name,
      path: entry.path,
      projectMarkers: await projectMarkers(entry.markerPath),
      isSymlink: entry.isSymlink,
    })),
  );

  return {
    path: normalizedPath,
    parent: normalizedPath === containingRoot ? null : dirname(normalizedPath),
    entries,
    truncated,
  };
}
