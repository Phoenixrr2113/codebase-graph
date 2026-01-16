/**
 * @codegraph/logger - Type definitions
 */

/** Log levels in order of severity */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Numeric order for log level comparison */
export const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/** Logger configuration */
export interface LoggerConfig {
  /** Minimum log level to output */
  level: LogLevel;
  /** Logger namespace/context (e.g., 'API:WebSocket') */
  namespace?: string;
  /** Enable colored output (default: true in dev) */
  colors?: boolean;
  /** Enable timestamps (default: true) */
  timestamps?: boolean;
}

/** Trace configuration */
export interface TraceConfig {
  /** Enable tracing (default: from TRACE_ENABLED env) */
  enabled: boolean;
  /** Trace verbosity level */
  level: 'verbose' | 'minimal' | 'off';
  /** Include patterns (glob-style, e.g., 'API:*') */
  include?: string[];
  /** Exclude patterns */
  exclude?: string[];
}

/** Logger interface */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  /** Create child logger with extended namespace */
  child(namespace: string): Logger;
}

/** Trace entry for function calls */
export interface TraceEntry {
  name: string;
  args: unknown[];
  result?: unknown;
  error?: Error;
  durationMs: number;
  timestamp: Date;
}
