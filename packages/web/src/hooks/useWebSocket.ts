'use client';

/**
 * useWebSocket Hook
 * Manages WebSocket connection to the API for real-time graph updates
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'Web:WS' });

// ============================================================================
// Types
// ============================================================================

/** WebSocket message types from server */
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

/** File event data */
export interface FileEventData {
  path: string;
}

/** Connection state */
export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

/** Hook options */
export interface UseWebSocketOptions {
  /** WebSocket URL (default: ws://localhost:3001/ws) */
  url?: string;
  /** Auto-reconnect on disconnect (default: true) */
  autoReconnect?: boolean;
  /** Reconnect interval in ms (default: 3000) */
  reconnectInterval?: number;
  /** Enable ping/pong keepalive (default: true) */
  enablePing?: boolean;
  /** Ping interval in ms (default: 30000) */
  pingInterval?: number;
  /** Callbacks */
  onConnected?: () => void;
  onDisconnected?: () => void;
  onGraphUpdate?: (data: GraphUpdateData) => void;
  onFileAdded?: (data: FileEventData) => void;
  onFileChanged?: (data: FileEventData) => void;
  onFileRemoved?: (data: FileEventData) => void;
  onError?: (error: string) => void;
}

/** Hook return value */
export interface UseWebSocketReturn {
  /** Current connection state */
  state: ConnectionState;
  /** Whether connected */
  isConnected: boolean;
  /** Last error message */
  lastError: string | null;
  /** Manually connect */
  connect: () => void;
  /** Manually disconnect */
  disconnect: () => void;
  /** Send a message */
  send: (message: WSMessage) => void;
}

// ============================================================================
// Hook Implementation
// ============================================================================

const DEFAULT_WS_URL = 'ws://localhost:3001/ws';

export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const {
    url = DEFAULT_WS_URL,
    autoReconnect = true,
    reconnectInterval = 3000,
    enablePing = true,
    pingInterval = 30000,
    onConnected,
    onDisconnected,
    onGraphUpdate,
    onFileAdded,
    onFileChanged,
    onFileRemoved,
    onError,
  } = options;

  const [state, setState] = useState<ConnectionState>('disconnected');
  const [lastError, setLastError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const shouldReconnectRef = useRef(true);

  // Store callbacks in refs to avoid re-creating handlers
  const callbacksRef = useRef({
    onConnected,
    onDisconnected,
    onGraphUpdate,
    onFileAdded,
    onFileChanged,
    onFileRemoved,
    onError,
  });

  // Update callbacks ref when they change
  useEffect(() => {
    callbacksRef.current = {
      onConnected,
      onDisconnected,
      onGraphUpdate,
      onFileAdded,
      onFileChanged,
      onFileRemoved,
      onError,
    };
  }, [onConnected, onDisconnected, onGraphUpdate, onFileAdded, onFileChanged, onFileRemoved, onError]);

  // Clear timers
  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current);
      pingTimerRef.current = null;
    }
  }, []);

  // Handle incoming messages
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const message: WSMessage = JSON.parse(event.data);
      const { onGraphUpdate, onFileAdded, onFileChanged, onFileRemoved, onError } = callbacksRef.current;

      switch (message.type) {
        case 'connected':
          logger.info('Connected to server');
          break;

        case 'graph-updated':
          if (onGraphUpdate && message.data) {
            onGraphUpdate(message.data as GraphUpdateData);
          }
          break;

        case 'file-added':
          if (onFileAdded && message.data) {
            onFileAdded(message.data as FileEventData);
          }
          break;

        case 'file-changed':
          if (onFileChanged && message.data) {
            onFileChanged(message.data as FileEventData);
          }
          break;

        case 'file-removed':
          if (onFileRemoved && message.data) {
            onFileRemoved(message.data as FileEventData);
          }
          break;

        case 'error':
          const errorData = message.data as { error?: string } | undefined;
          const errorMsg = errorData?.error ?? 'Unknown server error';
          setLastError(errorMsg);
          if (onError) {
            onError(errorMsg);
          }
          break;

        case 'pong':
          // Keepalive response - no action needed
          break;

        default:
          logger.debug('Unhandled message type:', message.type);
      }
    } catch {
      logger.error('Failed to parse message:', event.data);
    }
  }, []);

  // Connect to WebSocket
  const connect = useCallback(() => {
    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }
    clearTimers();

    setState('connecting');
    setLastError(null);

    try {
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setState('connected');
        logger.info('Connected');
        callbacksRef.current.onConnected?.();

        // Start ping timer
        if (enablePing) {
          pingTimerRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'ping', timestamp: Date.now() }));
            }
          }, pingInterval);
        }
      };

      ws.onmessage = handleMessage;

      ws.onclose = () => {
        setState('disconnected');
        logger.info('Disconnected');
        callbacksRef.current.onDisconnected?.();
        clearTimers();

        // Auto-reconnect
        if (autoReconnect && shouldReconnectRef.current) {
          logger.info(`Reconnecting in ${reconnectInterval}ms...`);
          reconnectTimerRef.current = setTimeout(connect, reconnectInterval);
        }
      };

      ws.onerror = (error) => {
        logger.error('Error:', error);
        setState('error');
        setLastError('WebSocket connection error');
      };
    } catch (error) {
      logger.error('Failed to create WebSocket:', error);
      setState('error');
      setLastError(error instanceof Error ? error.message : 'Failed to connect');
    }
  }, [url, autoReconnect, reconnectInterval, enablePing, pingInterval, handleMessage, clearTimers]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    clearTimers();

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setState('disconnected');
  }, [clearTimers]);

  // Send a message
  const send = useCallback((message: WSMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    } else {
      logger.warn('Cannot send - not connected');
    }
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    shouldReconnectRef.current = true;
    connect();

    return () => {
      shouldReconnectRef.current = false;
      clearTimers();
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect, clearTimers]);

  return {
    state,
    isConnected: state === 'connected',
    lastError,
    connect,
    disconnect,
    send,
  };
}
