/**
 * @codegraph/api — REST API server
 *
 * Hono-based HTTP server exposing CodeGraph services for the dashboard
 * and external integrations. Runs on port 3001 by default.
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { healthRoutes } from './routes/health';
import { graphRoutes } from './routes/graph';
import { searchRoutes } from './routes/search';
import { queryRoutes } from './routes/query';
import { parseRoutes } from './routes/parse';
import { statsRoutes } from './routes/stats';
import { naturalRoutes } from './routes/natural';

const app = new Hono();

// CORS — allow dashboard on :3000 to call API on :3001
app.use('*', cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}));

// Mount routes
app.route('/', healthRoutes);
app.route('/', graphRoutes);
app.route('/', searchRoutes);
app.route('/', queryRoutes);
app.route('/', parseRoutes);
app.route('/', statsRoutes);
app.route('/', naturalRoutes);

// Start server
const port = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`CodeGraph API server running on http://localhost:${info.port}`);
  console.log(`  Health:     GET  /health`);
  console.log(`  Graph:      GET  /api/graph/full?limit=100`);
  console.log(`  Search:     GET  /api/search?q=...`);
  console.log(`  Query:      POST /api/query/cypher`);
  console.log(`  Parse:      POST /api/parse/project`);
  console.log(`  Stats:      GET  /api/stats`);
  console.log(`  Knowledge:  GET  /api/knowledge/stats`);
  console.log(`  Embeddings: GET  /api/embeddings/status`);
});

export { app };
