export type ProjectMarker =
  | ".git"
  | "package.json"
  | "pnpm-workspace.yaml"
  | "Cargo.toml"
  | "pyproject.toml"
  | "go.mod"
  | "setup.py"
  | "composer.json"
  | "Gemfile"
  | "build.gradle"
  | "pom.xml";

export interface DirectoryEntry {
  name: string;
  path: string;
  projectMarkers: ProjectMarker[];
  isSymlink: boolean;
}

export interface DirectoryListing {
  path: string | null;
  parent: string | null;
  entries: DirectoryEntry[];
  truncated: boolean;
}

interface FetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PROJECT_MARKERS: ReadonlySet<string> = new Set<ProjectMarker>([
  ".git",
  "package.json",
  "pnpm-workspace.yaml",
  "Cargo.toml",
  "pyproject.toml",
  "go.mod",
  "setup.py",
  "composer.json",
  "Gemfile",
  "build.gradle",
  "pom.xml",
]);

function isProjectMarker(value: unknown): value is ProjectMarker {
  return typeof value === "string" && PROJECT_MARKERS.has(value);
}

function parseEntry(value: unknown): DirectoryEntry {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.path !== "string" ||
    !Array.isArray(value.projectMarkers) ||
    value.projectMarkers.some((marker) => !isProjectMarker(marker)) ||
    typeof value.isSymlink !== "boolean"
  ) {
    throw new Error("Invalid directory response");
  }

  return {
    name: value.name,
    path: value.path,
    projectMarkers: value.projectMarkers as ProjectMarker[],
    isSymlink: value.isSymlink,
  };
}

const MARKER_LABELS: Record<ProjectMarker, string> = {
  ".git": "git",
  "package.json": "node",
  "pnpm-workspace.yaml": "node",
  "Cargo.toml": "cargo",
  "pyproject.toml": "python",
  "go.mod": "go",
  "setup.py": "python",
  "composer.json": "php",
  Gemfile: "ruby",
  "build.gradle": "jvm",
  "pom.xml": "jvm",
};

export function projectBadgeLabels(
  markers: readonly ProjectMarker[],
): string[] {
  return Array.from(new Set(markers.map((marker) => MARKER_LABELS[marker])));
}

export function parseDirectoryListing(value: unknown): DirectoryListing {
  if (
    !isRecord(value) ||
    (value.path !== null && typeof value.path !== "string") ||
    (value.parent !== null && typeof value.parent !== "string") ||
    !Array.isArray(value.entries) ||
    typeof value.truncated !== "boolean"
  ) {
    throw new Error("Invalid directory response");
  }

  return {
    path: value.path,
    parent: value.parent,
    entries: value.entries.map(parseEntry),
    truncated: value.truncated,
  };
}

export async function loadDirectories(
  apiUrl: string,
  path: string | null,
  showHidden: boolean,
  signal: AbortSignal,
  fetcher: (
    input: string,
    init?: RequestInit,
  ) => Promise<FetchResponse> = fetch,
): Promise<DirectoryListing> {
  const url = new URL("/api/fs/directories", apiUrl || window.location.origin);
  if (path) url.searchParams.set("path", path);
  if (showHidden) url.searchParams.set("includeHidden", "true");

  const response = await fetcher(url.href, { signal });
  if (!response.ok) {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.error === "string")
      throw new Error(body.error);
    const suffix = response.statusText ? ` ${response.statusText}` : "";
    throw new Error(`HTTP ${response.status}${suffix}`);
  }
  return parseDirectoryListing(await response.json());
}

export interface PathCrumb {
  label: string;
  path: string;
}
