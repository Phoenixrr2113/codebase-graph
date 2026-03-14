/**
 * @codegraph/logger
 * Structured logging and function tracing for CodeGraph
 */

// Core logger
export { createLogger, logger } from './logger';

// Tracing utilities
export { trace, traced, withTrace } from './trace';

// Error utilities
export { toErrorMessage } from './errors';

// Types
export type {
  Logger,
  LoggerConfig,
  LogLevel,
  TraceConfig,
  TraceEntry,
} from './types';

export { LOG_LEVEL_ORDER } from './types';
