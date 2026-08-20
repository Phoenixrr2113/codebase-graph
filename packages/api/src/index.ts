/**
 * @codegraph/api — REST API server
 *
 * Hono-based HTTP server exposing CodeGraph services for the dashboard
 * and external integrations. Runs on port 3001 by default.
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAllowedOrigin, loadEnvironment, resolvePort } from './env';
import { checkMutatingRequest } from './csrf-guard';
import { findDashboardAsset, resolveDashboardDir } from './static';
import { healthRoutes } from './routes/health';
import { graphRoutes } from './routes/graph';
import { searchRoutes } from './routes/search';
import { queryRoutes } from './routes/query';
import { parseRoutes } from './routes/parse';
import { statsRoutes } from './routes/stats';
import { naturalRoutes } from './routes/natural';
import { sourceRoutes } from './routes/source';
import { profileRoutes } from './routes/profile';

// Load .env before any route module reads configuration from process.env.
const loadedEnvFile = loadEnvironment();

const app = new Hono();

// CORS — allow dashboard on :3000 to call API on :3001
app.use('*', cors({
  origin: (origin) =>
    isAllowedOrigin(origin, process.env['CODEGRAPH_CORS_ORIGINS']) ? origin : null,
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}));

// CSRF guard. CORS only governs whether a browser may read a response, not
// whether a cross-site request executes. Applied to every path; the guard
// itself is a no-op for GET, HEAD and OPTIONS, and checks everything else
// (POST today, whatever mutating verb a future route uses tomorrow) without
// needing to know which routes exist. See csrf-guard.ts for the full
// reasoning.
app.use('*', async (c, next) => {
  const decision = checkMutatingRequest({
    method: c.req.method,
    contentType: c.req.header('Content-Type') ?? null,
    origin: c.req.header('Origin') ?? null,
    isAllowedOrigin: (origin) => isAllowedOrigin(origin, process.env['CODEGRAPH_CORS_ORIGINS']),
  });
  if (!decision.ok) {
    return c.json({ error: decision.message }, decision.status ?? 400);
  }
  return next();
});

// Mount routes
app.route('/', healthRoutes);
app.route('/', graphRoutes);
app.route('/', searchRoutes);
app.route('/', queryRoutes);
app.route('/', parseRoutes);
app.route('/', statsRoutes);
app.route('/', naturalRoutes);
app.route('/', sourceRoutes);
app.route('/', profileRoutes);

// Serve the built dashboard, when one is present, from the same origin as the
// API. Same origin means the browser never needs a CORS allowance for it.
const serverDir = dirname(fileURLToPath(import.meta.url));
const dashboardDir = resolveDashboardDir(serverDir);

if (dashboardDir !== undefined) {
  app.get('*', async (c) => {
    const asset = findDashboardAsset(new URL(c.req.url).pathname, dashboardDir);
    if (asset === null) return c.notFound();
    const body = await readFile(asset.path);
    c.header('Content-Type', asset.contentType);
    c.header(
      'Cache-Control',
      asset.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    );
    return c.body(body);
  });
}

// Start server
const port = resolvePort(process.env);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`CodeGraph API server running on http://localhost:${info.port}`);
  console.log(`  Config:     ${loadedEnvFile ?? 'process environment only (no .env found)'}`);
  console.log(
    `  Dashboard:  ${dashboardDir !== undefined ? `http://localhost:${info.port}/` : 'not built (run: pnpm --filter @codegraph/dashboard build)'}`,
  );
  console.log(`  Health:     GET  /health`);
  console.log(`  Graph:      GET  /api/graph/full?limit=100`);
  console.log(`  Search:     GET  /api/search?q=...`);
  console.log(`  Query:      POST /api/query/cypher`);
  console.log(`  Parse:      POST /api/parse/project`);
  console.log(`  Stats:      GET  /api/stats`);
  console.log(`  Knowledge:  GET  /api/knowledge/stats`);
  console.log(`  Profile:    GET  /api/profile`);
  console.log(`  Embeddings: GET  /api/embeddings/status`);
});

export { app };
