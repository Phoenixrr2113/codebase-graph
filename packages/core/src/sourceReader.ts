/**
 * Source file reading utility.
 *
 * Shared by MCP tools (get_source, explain_code) and API routes (source.ts)
 * to avoid duplicating file I/O + line numbering logic.
 */

import { readFile, stat } from 'node:fs/promises';
import { resolve, normalize } from 'node:path';

// ============================================================================
// Types
// ============================================================================

export interface ReadSourceOptions {
  /** Start line (1-based, inclusive). Default: 1 */
  startLine?: number | undefined;
  /** End line (1-based, inclusive). Default: end of file */
  endLine?: number | undefined;
  /** Add line numbers to each line */
  lineNumbers?: boolean | undefined;
}

export interface SourceFileResult {
  /** File content (optionally with line numbers, optionally sliced) */
  content: string;
  /** Total number of lines in the file */
  totalLines: number;
  /** File size in bytes */
  size: number;
  /** Last modified time (ISO string) */
  mtime: string;
  /** Resolved absolute path */
  path: string;
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Validate that a file path doesn't attempt traversal outside allowed roots.
 * Rejects paths containing ".." components.
 */
function assertNoTraversal(filePath: string): void {
  const normalized = normalize(filePath);
  if (normalized.includes('..')) {
    throw new Error(`Path traversal detected: ${filePath}`);
  }
}

/**
 * Read a source file with optional line range and line numbers.
 *
 * @example
 * ```ts
 * const result = await readSourceFile('/repo/src/index.ts');
 * console.log(result.content);       // full file
 * console.log(result.totalLines);    // 150
 *
 * const slice = await readSourceFile('/repo/src/index.ts', {
 *   startLine: 10,
 *   endLine: 20,
 *   lineNumbers: true,
 * });
 * // "  10 | import { foo } from './foo';\n  11 | ..."
 * ```
 */
export async function readSourceFile(
  filePath: string,
  options?: ReadSourceOptions,
): Promise<SourceFileResult> {
  assertNoTraversal(filePath);

  const absPath = resolve(filePath);
  const [raw, info] = await Promise.all([
    readFile(absPath, 'utf-8'),
    stat(absPath),
  ]);

  const allLines = raw.split('\n');
  const totalLines = allLines.length;

  // Slice to requested range (1-based → 0-based)
  const start = Math.max(0, (options?.startLine ?? 1) - 1);
  const end = options?.endLine != null ? Math.min(totalLines, options.endLine) : totalLines;
  const lines = allLines.slice(start, end);

  let content: string;
  if (options?.lineNumbers) {
    const maxNum = end;
    const pad = String(maxNum).length;
    content = lines
      .map((line, i) => {
        const num = String(start + i + 1).padStart(pad, ' ');
        return `${num} | ${line}`;
      })
      .join('\n');
  } else {
    content = lines.join('\n');
  }

  return {
    content,
    totalLines,
    size: info.size,
    mtime: info.mtime.toISOString(),
    path: absPath,
  };
}
