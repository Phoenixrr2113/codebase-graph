/**
 * @codegraph/api
 * Server entry point
 */

import { serve } from '@hono/node-server';
import { app } from './app.js';

const port = parseInt(process.env['API_PORT'] ?? '3001', 10);
const host = process.env['API_HOST'] ?? '0.0.0.0';

console.log(`Starting CodeGraph API server...`);
console.log(`  Port: ${port}`);
console.log(`  Host: ${host}`);

serve({
  fetch: app.fetch,
  port,
  hostname: host,
}, (info) => {
  console.log(`CodeGraph API is running at http://${info.address}:${info.port}`);
  console.log(`Health check: http://localhost:${info.port}/health`);
});

export { app };
