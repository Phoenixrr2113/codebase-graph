/**
 * @codegraph/graph - File Tree Generator
 * Builds compact hierarchical file tree from graph for LLM context
 */

import type { GraphClient } from './client';

// ============================================================================
// Types
// ============================================================================

interface DirectoryNode {
  name: string;
  files: string[];
  subdirs: Map<string, DirectoryNode>;
  totalFiles: number;
}

export interface FileTreeOptions {
  /** Maximum depth to show (default: 3) */
  maxDepth?: number;
  /** Maximum files to list per directory (default: 5) */
  maxFilesPerDir?: number;
  /** Root path to filter by (optional) */
  rootPath?: string;
}

// ============================================================================
// Implementation
// ============================================================================

function createDirNode(name: string): DirectoryNode {
  return {
    name,
    files: [],
    subdirs: new Map(),
    totalFiles: 0,
  };
}

function insertPath(root: DirectoryNode, filePath: string): void {
  const parts = filePath.split('/').filter(Boolean);
  let current = root;

  for (let i = 0; i < parts.length - 1; i++) {
    const dirName = parts[i]!;
    if (!current.subdirs.has(dirName)) {
      current.subdirs.set(dirName, createDirNode(dirName));
    }
    current = current.subdirs.get(dirName)!;
  }

  const fileName = parts[parts.length - 1];
  if (fileName) {
    current.files.push(fileName);
  }
}

function countFiles(node: DirectoryNode): number {
  let count = node.files.length;
  for (const subdir of node.subdirs.values()) {
    count += countFiles(subdir);
  }
  node.totalFiles = count;
  return count;
}

function formatTree(
  node: DirectoryNode,
  options: Required<FileTreeOptions>,
  depth: number = 0,
  prefix: string = ''
): string {
  const lines: string[] = [];
  const indent = '  '.repeat(depth);

  // Sort subdirs by total files (most first)
  const sortedDirs = [...node.subdirs.entries()].sort(
    (a, b) => b[1].totalFiles - a[1].totalFiles
  );

  for (const [dirName, subdir] of sortedDirs) {
    const fileCount = subdir.totalFiles;

    if (depth < options.maxDepth) {
      // Show directory with file count
      if (depth === options.maxDepth - 1 || subdir.subdirs.size === 0) {
        // Leaf or max depth: show files inline
        const fileList = subdir.files.slice(0, options.maxFilesPerDir);
        const more = subdir.files.length > options.maxFilesPerDir
          ? `, +${subdir.files.length - options.maxFilesPerDir} more`
          : '';
        const files = fileList.length > 0
          ? `: ${fileList.join(', ')}${more}`
          : '';
        lines.push(`${indent}${dirName}/                [${fileCount} files${files}]`);
      } else {
        // Has subdirs, recurse
        lines.push(`${indent}${dirName}/                [${fileCount} files]`);
        lines.push(formatTree(subdir, options, depth + 1, prefix));
      }
    } else {
      // At max depth, just show count
      lines.push(`${indent}${dirName}/                [${fileCount} files]`);
    }
  }

  return lines.filter(Boolean).join('\n');
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Build a compact file tree from the graph
 * 
 * @example
 * ```typescript
 * const tree = await buildFileTree(client);
 * // Returns:
 * // src/                        [127 files]
 * //   api/                      [45 files]
 * //     auth/                   [4 files: login.ts, validate.ts, session.ts, middleware.ts]
 * ```
 */
export async function buildFileTree(
  client: GraphClient,
  options: FileTreeOptions = {}
): Promise<string> {
  const opts: Required<FileTreeOptions> = {
    maxDepth: options.maxDepth ?? 3,
    maxFilesPerDir: options.maxFilesPerDir ?? 5,
    rootPath: options.rootPath ?? '',
  };

  // Query all file paths
  const query = opts.rootPath
    ? `MATCH (f:File) WHERE f.path STARTS WITH $rootPath RETURN f.path as path ORDER BY f.path`
    : `MATCH (f:File) RETURN f.path as path ORDER BY f.path`;

  const result = await client.roQuery<{ path: string }>(
    query,
    opts.rootPath ? { params: { rootPath: opts.rootPath } } : undefined
  );

  if (!result.data || result.data.length === 0) {
    return '(no files indexed)';
  }

  // Build tree structure
  const root = createDirNode('');
  for (const row of result.data) {
    // Normalize path: remove rootPath prefix if present
    let path = row.path;
    if (opts.rootPath && path.startsWith(opts.rootPath)) {
      path = path.slice(opts.rootPath.length);
      if (path.startsWith('/')) path = path.slice(1);
    }
    insertPath(root, path);
  }

  // Count files at each level
  countFiles(root);

  // Format as string
  const totalFiles = root.totalFiles;
  const tree = formatTree(root, opts, 0);

  return `Indexed: ${totalFiles} files\n\n${tree}`;
}

/**
 * Get stats summary for the codebase
 */
export async function getIndexSummary(client: GraphClient): Promise<string> {
  const statsQuery = `
    MATCH (n)
    WHERE n:File OR n:Function OR n:Class OR n:Interface OR n:Component
    RETURN labels(n)[0] as label, count(n) as count
  `;

  const result = await client.roQuery<{ label: string; count: number }>(statsQuery);

  const stats: Record<string, number> = {};
  for (const row of result.data ?? []) {
    stats[row.label] = row.count;
  }

  return [
    `Files: ${stats['File'] ?? 0}`,
    `Functions: ${stats['Function'] ?? 0}`,
    `Classes: ${stats['Class'] ?? 0}`,
    `Interfaces: ${stats['Interface'] ?? 0}`,
    `Components: ${stats['Component'] ?? 0}`,
  ].join(' | ');
}
