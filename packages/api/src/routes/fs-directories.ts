import { Hono } from 'hono';
import { homedir } from 'node:os';
import {
  browseDirectories,
  FsBrowseError,
  resolveBrowseRoots,
  type DirectoryBrowseResponse,
} from '../fs-browse.js';
import { safeErrorMessage } from '../safe-error.js';

interface FsRoutesOptions {
  homeDirectory?: string;
  configuredRoots?: string;
  browse?: typeof browseDirectories;
}

export function createFsRoutes(options: FsRoutesOptions = {}): Hono {
  const routes = new Hono();

  routes.get('/api/fs/directories', async (c) => {
    try {
      const roots = await resolveBrowseRoots(
        options.homeDirectory ?? homedir(),
        options.configuredRoots ?? process.env['CODEGRAPH_BROWSE_ROOTS'],
      );
      const response: DirectoryBrowseResponse = await (
        options.browse ?? browseDirectories
      )(c.req.query('path'), roots, {
        includeHidden: c.req.query('includeHidden') === 'true',
      });
      return c.json(response);
    } catch (error) {
      if (error instanceof FsBrowseError) {
        return c.json({ error: error.message }, error.status);
      }
      return c.json(
        {
          error: safeErrorMessage(
            'GET /api/fs/directories',
            error,
            'Failed to browse directories.',
          ),
        },
        500,
      );
    }
  });

  return routes;
}

export const fsRoutes = createFsRoutes();
