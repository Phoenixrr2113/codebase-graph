/**
 * @codegraph/api
 * Hono API server for CodeGraph
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono();

// CORS for frontend
app.use('/*', cors({
  origin: ['http://localhost:3000'],
}));

// Health check
app.get('/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Placeholder routes - Agent C will implement
app.get('/api/graph/stats', (c) => c.json({ message: 'Not implemented yet' }));

const port = parseInt(process.env['API_PORT'] ?? '3001', 10);

console.log(`Starting CodeGraph API on port ${port}`);

serve({
  fetch: app.fetch,
  port,
});

export { app };
