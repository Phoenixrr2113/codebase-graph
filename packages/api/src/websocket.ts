/**
 * WebSocket Server - Real-time updates for CodeGraph
 *
 * Uses @hono/node-ws for WebSocket support with Hono on Node.js.
 * Broadcasts file change events to connected clients.
 */

import type { WSContext } from 'hono/ws';
import { createNodeWebSocket } from '@hono/node-ws';
import type { ServerType } from '@hono/node-server';
import type { Hono } from 'hono';
import { getActiveWatcher, type FileChangeEvent } from './services/index.js';

// ============================================================================
// Types
// ============================================================================

/** WebSocket message types */
export type WSMessageType =
  | 'connected'
  | 'file-added'
  | 'file-changed'
  | 'file-removed'
  | 'graph-updated'
  | 'error'
  | 'ping'
  | 'pong';

/** WebSocket message structure */
export interface WSMessage {
  type: WSMessageType;
  data?: unknown;
  timestamp: number;
}

/** Graph update event data */
export interface GraphUpdateData {
  type: 'add' | 'change' | 'unlink';
  filePath: string;
}

// ============================================================================
// WebSocket Server
// ============================================================================

/** Connected clients */
const clients = new Set<WSContext>();

/** Node WebSocket adapter */
let injectWebSocket: ReturnType<typeof createNodeWebSocket>['injectWebSocket'] | null = null;

/**
 * Setup WebSocket support for Hono app
 */
export function setupWebSocket(app: Hono): void {
  const { injectWebSocket: inject, upgradeWebSocket } = createNodeWebSocket({ app: app as unknown as Hono });

  injectWebSocket = inject;

  // Add WebSocket route
  app.get(
    '/ws',
    upgradeWebSocket((_c) => ({
      onOpen: (_event, ws) => {
        console.log('[WebSocket] Client connected');
        clients.add(ws);

        // Send welcome message
        sendToClient(ws, {
          type: 'connected',
          data: { clientCount: clients.size },
          timestamp: Date.now(),
        });
      },

      onMessage: (event, ws) => {
        try {
          const data = JSON.parse(event.data.toString());

          // Handle ping/pong for keepalive
          if (data.type === 'ping') {
            sendToClient(ws, {
              type: 'pong',
              timestamp: Date.now(),
            });
          }
        } catch {
          // Ignore non-JSON messages
        }
      },

      onClose: (_event, ws) => {
        console.log('[WebSocket] Client disconnected');
        clients.delete(ws);
      },

      onError: (error, ws) => {
        console.error('[WebSocket] Error:', error);
        clients.delete(ws);
      },
    }))
  );

  console.log('[WebSocket] WebSocket route registered at /ws');
}

/**
 * Inject WebSocket support into the HTTP server
 */
export function injectWebSocketToServer(server: ServerType): void {
  if (injectWebSocket) {
    injectWebSocket(server);
    console.log('[WebSocket] WebSocket injected into server');
  } else {
    console.warn('[WebSocket] Cannot inject - setupWebSocket not called');
  }
}

/**
 * Subscribe to watch service events and broadcast to clients
 */
export function subscribeToWatchEvents(): void {
  const watcher = getActiveWatcher();
  if (!watcher) {
    console.warn('[WebSocket] No active watcher to subscribe to');
    return;
  }

  watcher.on('file-changed', (event: FileChangeEvent) => {
    broadcast({
      type: event.type === 'add' ? 'file-added' : 'file-changed',
      data: { path: event.path },
      timestamp: event.timestamp,
    });
  });

  watcher.on('file-removed', (event: FileChangeEvent) => {
    broadcast({
      type: 'file-removed',
      data: { path: event.path },
      timestamp: event.timestamp,
    });
  });

  watcher.on('graph-updated', (data: GraphUpdateData) => {
    broadcast({
      type: 'graph-updated',
      data,
      timestamp: Date.now(),
    });
  });

  console.log('[WebSocket] Subscribed to watch events');
}

/**
 * Send message to a specific client
 */
function sendToClient(ws: WSContext, message: WSMessage): void {
  try {
    ws.send(JSON.stringify(message));
  } catch (error) {
    console.error('[WebSocket] Failed to send message:', error);
  }
}

/**
 * Broadcast message to all connected clients
 */
export function broadcast(message: WSMessage): void {
  const json = JSON.stringify(message);
  let failedCount = 0;

  for (const client of clients) {
    try {
      client.send(json);
    } catch {
      failedCount++;
      clients.delete(client);
    }
  }

  if (failedCount > 0) {
    console.log(`[WebSocket] Removed ${failedCount} failed clients`);
  }
}

/**
 * Get count of connected clients
 */
export function getClientCount(): number {
  return clients.size;
}

/**
 * Notify clients of an error
 */
export function broadcastError(error: string): void {
  broadcast({
    type: 'error',
    data: { error },
    timestamp: Date.now(),
  });
}
