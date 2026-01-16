/**
 * @codegraph/api
 * Server entry point with WebSocket and file watcher support
 */

import { serve } from '@hono/node-server';
import { app } from './app.js';
import { setupWebSocket, injectWebSocketToServer, subscribeToWatchEvents } from './websocket.js';
import { startWatching } from './services/index.js';

const port = parseInt(process.env['API_PORT'] ?? '3001', 10);
const host = process.env['API_HOST'] ?? '0.0.0.0';
const watchPath = process.env['PROJECT_PATH'] ?? process.env['WATCH_PATH'];

console.log(`Starting CodeGraph API server...`);
console.log(`  Port: ${port}`);
console.log(`  Host: ${host}`);
if (watchPath) {
  console.log(`  Watch path: ${watchPath}`);
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
    console.log(`CodeGraph API is running at http://${info.address}:${info.port}`);
    console.log(`Health check: http://localhost:${info.port}/health`);
    console.log(`WebSocket: ws://localhost:${info.port}/ws`);

    // Inject WebSocket into the server
    injectWebSocketToServer(server);

    // Start file watcher if PROJECT_PATH is configured
    if (watchPath) {
      try {
        await startWatching({ projectPath: watchPath });
        subscribeToWatchEvents();
        console.log(`[Watcher] Watching project: ${watchPath}`);
      } catch (error) {
        console.error('[Watcher] Failed to start:', error);
      }
    }
  }
);

export { app };

