/**
 * @codegraph/logger - Core logger implementation
 */

import type { Logger, LoggerConfig, LogLevel } from './types.js';
import { LOG_LEVEL_ORDER } from './types.js';

/** Get log level from environment */
function getEnvLogLevel(): LogLevel {
  const envLevel = (
    typeof process !== 'undefined' ? process.env?.['LOG_LEVEL'] : undefined
  )?.toLowerCase();
  
  if (envLevel && envLevel in LOG_LEVEL_ORDER) {
    return envLevel as LogLevel;
  }
  return 'info';
}

/** Check if running in browser */
function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

/** Format timestamp */
function formatTimestamp(): string {
  return new Date().toISOString();
}

/** Format log prefix with namespace */
function formatPrefix(namespace: string | undefined, level: LogLevel): string {
  const levelStr = level.toUpperCase().padEnd(5);
  const ns = namespace ? `[${namespace}]` : '';
  return `${levelStr} ${ns}`.trim();
}

/** Default configuration */
const defaultConfig: LoggerConfig = {
  level: getEnvLogLevel(),
  colors: !isBrowser(),
  timestamps: true,
};

/** ANSI color codes for terminal output */
const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // Cyan
  info: '\x1b[32m',  // Green
  warn: '\x1b[33m',  // Yellow
  error: '\x1b[31m', // Red
};
const RESET = '\x1b[0m';

/** Create a logger instance */
export function createLogger(config: Partial<LoggerConfig> = {}): Logger {
  const cfg: LoggerConfig = { ...defaultConfig, ...config };

  function shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[cfg.level];
  }

  function log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (!shouldLog(level)) return;

    const prefix = formatPrefix(cfg.namespace, level);
    const timestamp = cfg.timestamps ? `[${formatTimestamp()}]` : '';
    
    let output = `${timestamp} ${prefix} ${message}`;
    
    // Apply colors in Node.js
    if (cfg.colors && !isBrowser()) {
      const color = COLORS[level];
      output = `${color}${output}${RESET}`;
    }

    const consoleFn = level === 'error' 
      ? console.error 
      : level === 'warn' 
        ? console.warn 
        : level === 'debug'
          ? console.debug
          : console.log;

    if (args.length > 0) {
      consoleFn(output, ...args);
    } else {
      consoleFn(output);
    }
  }

  const logger: Logger = {
    debug: (message, ...args) => log('debug', message, ...args),
    info: (message, ...args) => log('info', message, ...args),
    warn: (message, ...args) => log('warn', message, ...args),
    error: (message, ...args) => log('error', message, ...args),
    child: (namespace: string) => {
      const childNs = cfg.namespace 
        ? `${cfg.namespace}:${namespace}` 
        : namespace;
      return createLogger({ ...cfg, namespace: childNs });
    },
  };

  return logger;
}

/** Default root logger */
export const logger = createLogger();
