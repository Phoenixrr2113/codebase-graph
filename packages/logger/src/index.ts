/**
 * @codegraph/logger
 * Structured logging and function tracing for CodeGraph
 */

// Core logger
export { createLogger, logger } from './logger.js';

// Tracing utilities
export { trace, traced, withTrace } from './trace.js';

// Types
export type {
  Logger,
  LoggerConfig,
  LogLevel,
  TraceConfig,
  TraceEntry,
} from './types.js';

export { LOG_LEVEL_ORDER } from './types.js';
