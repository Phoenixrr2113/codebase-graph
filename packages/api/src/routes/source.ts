/**
 * Source routes - /api/source
 * Endpoints for retrieving source code content
 */

import { Hono } from 'hono';
import { readFile, stat } from 'node:fs/promises';
import { HttpError } from '../middleware/errorHandler';

const source = new Hono();

/**
 * GET /api/source
 * Get source code content for a file
 * Query params:
 *   - path: absolute file path (required)
 *   - startLine: start line number (optional, 1-indexed)
 *   - endLine: end line number (optional, 1-indexed)
 */
source.get('/', async (c) => {
  const filePath = c.req.query('path');
  const startLineParam = c.req.query('startLine');
  const endLineParam = c.req.query('endLine');

  if (!filePath) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'File path is required');
  }

  // Security: validate path is absolute and exists
  if (!filePath.startsWith('/')) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'File path must be absolute');
  }

  try {
    // Check file exists and is a file
    const stats = await stat(filePath);
    if (!stats.isFile()) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Path is not a file');
    }

    // Read file content
    const content = await readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    // Parse line range
    const startLine = startLineParam ? Math.max(1, parseInt(startLineParam, 10)) : 1;
    const endLine = endLineParam ? Math.min(lines.length, parseInt(endLineParam, 10)) : lines.length;

    // Extract requested lines (convert to 0-indexed)
    const selectedLines = lines.slice(startLine - 1, endLine);

    return c.json({
      path: filePath,
      startLine,
      endLine,
      totalLines: lines.length,
      content: selectedLines.join('\n'),
      lines: selectedLines.map((line, i) => ({
        number: startLine + i,
        content: line,
      })),
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new HttpError(404, 'NOT_FOUND', `File not found: ${filePath}`);
    }
    if ((error as NodeJS.ErrnoException).code === 'EACCES') {
      throw new HttpError(403, 'FORBIDDEN', `Access denied: ${filePath}`);
    }
    throw error;
  }
});

export { source };
