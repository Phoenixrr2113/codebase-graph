import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { codeGraphService, getActiveProjectPaths } from '@codegraph/core';
import { authorizeSourcePath } from '../source-access';

export const sourceRoutes = new Hono();

/**
 * Every directory the source endpoint may read from: the roots of indexed
 * projects, plus whatever the user has configured as active.
 */
async function readableRoots(): Promise<string[]> {
  const roots = new Set<string>();
  try {
    for (const project of await codeGraphService.getProjects()) {
      if (project.rootPath) roots.add(project.rootPath);
    }
  } catch {
    // An unreachable graph must not widen access, so fall through to config only.
  }
  try {
    for (const path of await getActiveProjectPaths()) roots.add(path);
  } catch {
    // Same reasoning: a missing config narrows what is readable, never widens it.
  }
  return Array.from(roots);
}

/** GET /api/source?path=X&startLine=N&endLine=N reads source code with context. */
sourceRoutes.get('/api/source', async (c) => {
  try {
    const decision = authorizeSourcePath(c.req.query('path'), await readableRoots());
    if (!decision.ok) {
      return c.json({ error: decision.message }, decision.status);
    }
    const filePath = decision.path;

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
