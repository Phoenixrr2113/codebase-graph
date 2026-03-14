/**
 * Source routes - /api/source
 * Endpoints for retrieving source code content
 */

import { Hono } from 'hono';
import { HttpError } from '../middleware/errorHandler';
import { readSourceFile } from '@codegraph/core';
import { toErrorMessage } from '@codegraph/logger';

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

  // Handle external namespace paths (e.g., "external:System.Collections.Generic")
  // These are virtual nodes representing external dependencies, not real files
  if (filePath.startsWith('external:')) {
    const namespaceName = filePath.substring(9); // Remove "external:" prefix
    return c.json({
      path: filePath,
      startLine: 1,
      endLine: 1,
      totalLines: 1,
      content: `// External namespace: ${namespaceName}\n// This is an external dependency, source code is not available.`,
      lines: [
        { number: 1, content: `// External namespace: ${namespaceName}` },
        { number: 2, content: '// This is an external dependency, source code is not available.' },
      ],
      isExternal: true,
    });
  }

  // Security: validate path is absolute
  if (!filePath.startsWith('/')) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'File path must be absolute');
  }

  try {
    // readSourceFile validates against path traversal (rejects ".." components)
    const startLine = startLineParam ? Math.max(1, parseInt(startLineParam, 10)) : undefined;
    const endLine = endLineParam ? parseInt(endLineParam, 10) : undefined;

    const result = await readSourceFile(filePath, { startLine, endLine });
    const lines = result.content.split('\n');

    return c.json({
      path: filePath,
      startLine: startLine ?? 1,
      endLine: endLine ?? result.totalLines,
      totalLines: result.totalLines,
      content: result.content,
      lines: lines.map((line, i) => ({
        number: (startLine ?? 1) + i,
        content: line,
      })),
    });
  } catch (error) {
    const msg = toErrorMessage(error);
    if (msg.includes('Path traversal detected')) {
      throw new HttpError(403, 'FORBIDDEN', msg);
    }
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
