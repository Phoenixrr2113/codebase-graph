import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { codeGraphService } from '@codegraph/core';
import { authorizeSourcePath } from '../source-access.js';
import { safeErrorMessage } from '../safe-error.js';

export const sourceRoutes = new Hono();

type IntegerParamResult =
  | { valid: true; value: number }
  | { valid: false; error: string };

function boundedIntegerParam(
  rawValue: string | undefined,
  defaultValue: number,
  name: string,
  min: number,
  max: number,
): IntegerParamResult {
  if (rawValue === undefined) return { valid: true, value: defaultValue };

  const value = Number(rawValue);
  if (!/^\d+$/.test(rawValue) || !Number.isFinite(value) || !Number.isSafeInteger(value)) {
    return { valid: false, error: `${name} must be an integer between ${min} and ${max}` };
  }
  if (value < min || value > max) {
    return { valid: false, error: `${name} must be an integer between ${min} and ${max}` };
  }
  return { valid: true, value };
}

/**
 * Every directory the source endpoint may read from: the roots of projects that
 * are actually in the graph.
 *
 * Deliberately not the configured active projects. Configuring a project only
 * schedules indexing, so an active root can be a directory the graph knows
 * nothing about, and honouring it would let this endpoint read files that no
 * graph node refers to. An unreachable graph yields no roots, which denies
 * everything rather than falling back to something broader.
 */
async function readableRoots(): Promise<string[]> {
  const roots = new Set<string>();
  try {
    for (const project of await codeGraphService.getProjects()) {
      if (project.rootPath) roots.add(project.rootPath);
    }
  } catch {
    // Deny by default: a graph we cannot read tells us nothing is readable.
  }
  return Array.from(roots);
}

/** GET /api/source?path=X&startLine=N&endLine=N reads source code with context. */
sourceRoutes.get('/api/source', async (c) => {
  try {
    // Source locations are one-based and capped to keep arithmetic and response
    // windows predictable. endLine=0 retains the existing whole-file sentinel.
    const startLineResult = boundedIntegerParam(
      c.req.query('startLine'),
      1,
      'startLine',
      1,
      1_000_000,
    );
    if (!startLineResult.valid) {
      return c.json({ error: startLineResult.error }, 400);
    }
    const endLineResult = boundedIntegerParam(
      c.req.query('endLine'),
      0,
      'endLine',
      0,
      1_000_000,
    );
    if (!endLineResult.valid) {
      return c.json({ error: endLineResult.error }, 400);
    }
    const contextResult = boundedIntegerParam(c.req.query('context'), 5, 'context', 0, 1_000);
    if (!contextResult.valid) {
      return c.json({ error: contextResult.error }, 400);
    }
    if (endLineResult.value > 0 && endLineResult.value < startLineResult.value) {
      return c.json(
        { error: 'endLine must be 0 or greater than or equal to startLine' },
        400,
      );
    }

    const decision = authorizeSourcePath(c.req.query('path'), await readableRoots());
    if (!decision.ok) {
      return c.json({ error: decision.message }, decision.status);
    }
    const filePath = decision.path;

    const startLine = startLineResult.value;
    const endLine = endLineResult.value;
    const context = contextResult.value;

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
    return c.json({ error: safeErrorMessage('GET /api/source', error, 'Failed to read source.') }, 500);
  }
});
