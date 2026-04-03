import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';

export const sourceRoutes = new Hono();

/** GET /api/source?path=X&startLine=N&endLine=N — read source code with context */
sourceRoutes.get('/api/source', async (c) => {
  try {
    const filePath = c.req.query('path');
    if (!filePath) return c.json({ error: 'path parameter is required' }, 400);

    const startLine = Number(c.req.query('startLine') ?? 1);
    const endLine = Number(c.req.query('endLine') ?? 0);
    const context = Number(c.req.query('context') ?? 5); // lines of context around the entity

    const content = await readFile(filePath, 'utf-8');
    const allLines = content.split('\n');

    // If endLine is specified, return a window around the entity
    const from = endLine > 0 ? Math.max(1, startLine - context) : 1;
    const to = endLine > 0 ? Math.min(allLines.length, endLine + context) : allLines.length;

    const lines = allLines.slice(from - 1, to).map((line, i) => ({
      number: from + i,
      content: line,
    }));

    return c.json({
      path: filePath,
      startLine: from,
      endLine: to,
      totalLines: allLines.length,
      entityStartLine: startLine,
      entityEndLine: endLine,
      lines,
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Failed to read source' }, 500);
  }
});
