import { Hono } from 'hono';

export const healthRoutes = new Hono();

healthRoutes.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'codegraph-api', timestamp: new Date().toISOString() });
});
