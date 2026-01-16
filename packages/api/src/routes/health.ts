/**
 * Health check route
 */

import { Hono } from 'hono';

const health = new Hono();

/** API version from package.json */
const API_VERSION = '0.1.0';

/** Health check response */
export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  timestamp: string;
  version: string;
  uptime: number;
}

const startTime = Date.now();

health.get('/', (c) => {
  const response: HealthResponse = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: API_VERSION,
    uptime: Math.floor((Date.now() - startTime) / 1000),
  };
  return c.json(response);
});

export { health };
