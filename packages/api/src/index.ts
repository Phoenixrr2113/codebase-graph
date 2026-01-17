/**
 * @codegraph/api
 * Server entry point with WebSocket and file watcher support
 */

import { serve } from '@hono/node-server';
import { createLogger } from '@codegraph/logger';
import { app } from './app';
import { setupWebSocket, injectWebSocketToServer, subscribeToWatchEvents } from './websocket';
import { startWatching } from './services';

const logger = createLogger({ namespace: 'API:Server' });

const port = parseInt(process.env['API_PORT'] ?? '3001', 10);
const host = process.env['API_HOST'] ?? '0.0.0.0';
const watchPath = process.env['PROJECT_PATH'] ?? process.env['WATCH_PATH'];

logger.info(`Starting CodeGraph API server...`);
logger.info(`  Port: ${port}`);
logger.info(`  Host: ${host}`);
if (watchPath) {
  logger.info(`  Watch path: ${watchPath}`);
}

// Setup WebSocket support
setupWebSocket(app);

const server = serve(
  {
    fetch: app.fetch,
    port,
    hostname: host,
  },
  async (info) => {
    logger.info(`CodeGraph API is running at http://${info.address}:${info.port}`);
    logger.info(`Health check: http://localhost:${info.port}/health`);
    logger.info(`WebSocket: ws://localhost:${info.port}/ws`);

    // Inject WebSocket into the server
    injectWebSocketToServer(server);

    // Start file watcher if PROJECT_PATH is configured
    if (watchPath) {
      try {
        await startWatching({ projectPath: watchPath });
        subscribeToWatchEvents();
        logger.info(`Watching project: ${watchPath}`);
      } catch (error) {
        logger.error('Failed to start watcher:', error);
      }
    }
  }
);

export { app };

