import { Hono } from 'hono';
import { indexProject } from '@codegraph/core';

export const parseRoutes = new Hono();

/** POST /api/parse/project — index a project directory */
parseRoutes.post('/api/parse/project', async (c) => {
  try {
    const body = await c.req.json();
    const path = body.path as string;

    if (!path) return c.json({ error: 'path field is required' }, 400);

    const result = await indexProject(path);

    // indexProject reports a bad path as success: false with the reason in
    // errorMessages. Reporting that as 200 with parsed: true told callers the
    // work had been done, and the dashboard duly showed a green "0 files".
    if (!result.success) {
      return c.json({ parsed: false, path, ...result }, 400);
    }

    return c.json({
      parsed: true,
      path,
      ...result,
    });
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : 'Parse failed' }, 500);
  }
});
