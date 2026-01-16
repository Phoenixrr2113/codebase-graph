/**
 * Request logger middleware for Hono API
 */

import type { Context, Next } from 'hono';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'API:HTTP' });

/** Logger configuration */
export interface LoggerConfig {
  enabled: boolean;
  includeHeaders?: boolean;
}

const defaultConfig: LoggerConfig = {
  enabled: true,
  includeHeaders: false,
};

/** Request logger middleware */
export function requestLogger(config: LoggerConfig = defaultConfig) {
  return async (c: Context, next: Next): Promise<void> => {
    if (!config.enabled) {
      await next();
      return;
    }

    const start = Date.now();
    const method = c.req.method;
    const path = c.req.path;

    await next();

    const duration = Date.now() - start;
    const status = c.res.status;

    const logMsg = `${method} ${path} ${status} ${duration}ms`;
    
    if (status >= 500) {
      logger.error(logMsg);
    } else if (status >= 400) {
      logger.warn(logMsg);
    } else {
      logger.info(logMsg);
    }
  };
}

