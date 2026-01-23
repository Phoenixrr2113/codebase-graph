/**
 * @codegraph/api
 * Hono API application configuration
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { errorHandler, notFoundHandler, requestLogger } from './middleware';
import {
  health,
  parse,
  graph,
  entity,
  neighbors,
  stats,
  query,
  search,
  source,
  projects,
  nodes,
  analytics,
} from './routes';

/** Create and configure the Hono application */
export function createApp(): Hono {
  const app = new Hono();

  // Request logging
  app.use('*', requestLogger({ enabled: true }));

  // CORS for frontend
  app.use('/*', cors({
    origin: [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['X-Request-Id'],
    maxAge: 86400,
  }));

  // Error handling
  app.use('*', errorHandler);

  // Mount routes
  app.route('/health', health);
  app.route('/api/parse', parse);
  app.route('/api/graph', graph);
  app.route('/api/entity', entity);
  app.route('/api/neighbors', neighbors);
  app.route('/api/stats', stats);
  app.route('/api/query', query);
  app.route('/api/search', search);
  app.route('/api/source', source);
  app.route('/api/projects', projects);
  app.route('/api/nodes', nodes);
  app.route('/api/analytics', analytics);

  // 404 handler for unmatched routes
  app.notFound(notFoundHandler);

  return app;
}

/** Default app instance */
export const app = createApp();
