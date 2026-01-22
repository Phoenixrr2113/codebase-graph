/**
 * Change Detection Service
 * Content-hash based change detection with rename support
 * Based on CodeGraph v2 Specification
 */

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import fastGlob from 'fast-glob';
import { createLogger, traced } from '@codegraph/logger';

const logger = createLogger({ namespace: 'API:ChangeDetection' });

// ============================================================================
// Types
// ============================================================================

/** Change type for a file */
export type ChangeType = 'added' | 'modified' | 'deleted' | 'renamed' | 'unchanged';

/** Information about a detected file change */
export interface FileChange {
  /** Current file path (or old path for deleted files) */
  path: string;
  /** Type of change */
  type: ChangeType;
  /** Content hash (for added/modified/renamed) */
  hash?: string;
  /** Previous hash (for modified) */
  previousHash?: string;
  /** New path (for renamed files) */
  newPath?: string;
  /** Old path (for renamed files) */
  oldPath?: string;
}

/** Summary of detected changes */
export interface ChangeSummary {
  /** Total files in filesystem */
  totalFiles: number;
  /** Number of added files */
  added: number;
  /** Number of modified files */
  modified: number;
  /** Number of deleted files */
  deleted: number;
  /** Number of renamed files */
  renamed: number;
  /** Number of unchanged files */
  unchanged: number;
  /** Detailed list of changes */
  changes: FileChange[];
}

/** File info from graph storage */
export interface StoredFileInfo {
  /** File path */
  path: string;
  /** Content hash */
  hash: string;
}

/** Options for change detection */
export interface ChangeDetectionOptions {
  /** File extensions to include (e.g., ['.ts', '.js']) */
  extensions?: string[];
  /** Patterns to ignore */
  ignorePatterns?: string[];
  /** Whether to detect renames (requires matching hashes) */
  detectRenames?: boolean;
}

// ============================================================================
// Default Configuration
// ============================================================================

const DEFAULT_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyw',
  '.cs',
  '.json',
];

const DEFAULT_IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/coverage/**',
  '**/__pycache__/**',
  '**/bin/**',
  '**/obj/**',
];

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Calculate SHA-256 hash for file content
 */
export function calculateFileHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Detect changes between filesystem and stored graph state
 */
export const detectChanges = traced('detectChanges', async function detectChanges(
  rootPath: string,
  storedFiles: StoredFileInfo[],
  options: ChangeDetectionOptions = {}
): Promise<ChangeSummary> {
  const {
    extensions = DEFAULT_EXTENSIONS,
    ignorePatterns = DEFAULT_IGNORE_PATTERNS,
    detectRenames = true,
  } = options;

  logger.info('Detecting changes', { rootPath, detectRenames });

  // Step 1: Scan filesystem and calculate hashes
  const filesystemFiles = await scanFilesystem(rootPath, extensions, ignorePatterns);

  // Step 2: Create lookup maps
  const storedByPath = new Map<string, StoredFileInfo>(
    storedFiles.map(f => [f.path, f])
  );
  const storedByHash = new Map<string, StoredFileInfo[]>();
  for (const file of storedFiles) {
    const existing = storedByHash.get(file.hash) || [];
    existing.push(file);
    storedByHash.set(file.hash, existing);
  }

  const fsPathSet = new Set(filesystemFiles.map(f => f.path));

  // Step 3: Categorize changes
  const changes: FileChange[] = [];
  const potentialDeletes: FileChange[] = [];
  const potentialAdds: FileChange[] = [];

  // Check filesystem files against stored
  for (const fsFile of filesystemFiles) {
    const stored = storedByPath.get(fsFile.path);

    if (!stored) {
      // New file (potentially a rename target)
      potentialAdds.push({
        path: fsFile.path,
        type: 'added',
        hash: fsFile.hash,
      });
    } else if (stored.hash !== fsFile.hash) {
      // Modified file
      changes.push({
        path: fsFile.path,
        type: 'modified',
        hash: fsFile.hash,
        previousHash: stored.hash,
      });
    } else {
      // Unchanged
      changes.push({
        path: fsFile.path,
        type: 'unchanged',
        hash: fsFile.hash,
      });
    }
  }

  // Check stored files not in filesystem (deleted or renamed)
  for (const stored of storedFiles) {
    if (!fsPathSet.has(stored.path)) {
      potentialDeletes.push({
        path: stored.path,
        type: 'deleted',
        hash: stored.hash,
      });
    }
  }

  // Step 4: Detect renames (matching hash on delete + add)
  if (detectRenames && potentialDeletes.length > 0 && potentialAdds.length > 0) {
    const { renames, remainingDeletes, remainingAdds } = matchRenames(
      potentialDeletes,
      potentialAdds
    );

    changes.push(...renames);
    changes.push(...remainingDeletes);
    changes.push(...remainingAdds);
  } else {
    changes.push(...potentialDeletes);
    changes.push(...potentialAdds);
  }

  // Step 5: Build summary
  const summary: ChangeSummary = {
    totalFiles: filesystemFiles.length,
    added: changes.filter(c => c.type === 'added').length,
    modified: changes.filter(c => c.type === 'modified').length,
    deleted: changes.filter(c => c.type === 'deleted').length,
    renamed: changes.filter(c => c.type === 'renamed').length,
    unchanged: changes.filter(c => c.type === 'unchanged').length,
    changes: changes.filter(c => c.type !== 'unchanged'),
  };

  logger.info('Change detection complete', {
    added: summary.added,
    modified: summary.modified,
    deleted: summary.deleted,
    renamed: summary.renamed,
    unchanged: summary.unchanged,
  });

  return summary;
});

/**
 * Scan filesystem for files matching criteria
 */
async function scanFilesystem(
  rootPath: string,
  extensions: string[],
  ignorePatterns: string[]
): Promise<Array<{ path: string; hash: string }>> {
  // Build glob pattern for extensions
  const extPattern = extensions.length === 1
    ? `**/*${extensions[0]}`
    : `**/*{${extensions.join(',')}}`;

  const files = await fastGlob(extPattern, {
    cwd: rootPath,
    absolute: true,
    ignore: ignorePatterns,
  });

  const results: Array<{ path: string; hash: string }> = [];

  for (const filePath of files) {
    try {
      const content = await readFile(filePath, 'utf-8');
      const hash = calculateFileHash(content);
      results.push({ path: filePath, hash });
    } catch (error) {
      logger.warn('Failed to read file for hashing', { filePath, error });
    }
  }

  return results;
}

/**
 * Match renames by finding deleted+added pairs with same hash
 */
function matchRenames(
  deletes: FileChange[],
  adds: FileChange[]
): {
  renames: FileChange[];
  remainingDeletes: FileChange[];
  remainingAdds: FileChange[];
} {
  const renames: FileChange[] = [];
  const usedDeleteIndices = new Set<number>();
  const usedAddIndices = new Set<number>();

  // Group adds by hash for faster lookup
  const addsByHash = new Map<string, number[]>();
  adds.forEach((add, index) => {
    if (add.hash) {
      const existing = addsByHash.get(add.hash) || [];
      existing.push(index);
      addsByHash.set(add.hash, existing);
    }
  });

  // Match deletes to adds with same hash
  for (let i = 0; i < deletes.length; i++) {
    const del = deletes[i];
    if (!del || !del.hash) continue;

    const matchingAddIndices = addsByHash.get(del.hash);
    if (matchingAddIndices && matchingAddIndices.length > 0) {
      // Find first unused add
      for (const addIndex of matchingAddIndices) {
        const add = adds[addIndex];
        if (!usedAddIndices.has(addIndex) && add) {
          usedDeleteIndices.add(i);
          usedAddIndices.add(addIndex);

          renames.push({
            path: add.path,
            type: 'renamed',
            hash: del.hash,
            oldPath: del.path,
            newPath: add.path,
          });
          break;
        }
      }
    }
  }

  // Collect remaining (unmatched) deletes and adds
  const remainingDeletes = deletes.filter((_, i) => !usedDeleteIndices.has(i));
  const remainingAdds = adds.filter((_, i) => !usedAddIndices.has(i));

  return { renames, remainingDeletes, remainingAdds };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get only files that need processing (added, modified, renamed)
 */
export function getFilesToProcess(summary: ChangeSummary): FileChange[] {
  return summary.changes.filter(c =>
    c.type === 'added' || c.type === 'modified' || c.type === 'renamed'
  );
}

/**
 * Get files that need removal from graph (deleted only, not renamed)
 */
export function getFilesToRemove(summary: ChangeSummary): FileChange[] {
  return summary.changes.filter(c => c.type === 'deleted');
}

/**
 * Get renamed files for path update only (no re-parsing needed)
 */
export function getRenamedFiles(summary: ChangeSummary): FileChange[] {
  return summary.changes.filter(c => c.type === 'renamed');
}

/**
 * Check if any changes were detected
 */
export function hasChanges(summary: ChangeSummary): boolean {
  return summary.added > 0 ||
    summary.modified > 0 ||
    summary.deleted > 0 ||
    summary.renamed > 0;
}

/**
 * Get human-readable change summary
 */
export function formatChangeSummary(summary: ChangeSummary): string {
  const parts: string[] = [];

  if (summary.added > 0) parts.push(`${summary.added} added`);
  if (summary.modified > 0) parts.push(`${summary.modified} modified`);
  if (summary.deleted > 0) parts.push(`${summary.deleted} deleted`);
  if (summary.renamed > 0) parts.push(`${summary.renamed} renamed`);
  if (summary.unchanged > 0) parts.push(`${summary.unchanged} unchanged`);

  if (parts.length === 0) return 'No changes detected';
  return parts.join(', ');
}
