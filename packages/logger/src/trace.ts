/**
 * @codegraph/logger - Function tracing utilities
 * 
 * Provides decorators and utilities for tracing function calls
 * with inputs, outputs, and timing.
 */

import type { TraceConfig, TraceEntry } from './types.js';
import { createLogger } from './logger.js';

/** Get trace configuration from environment */
function getTraceConfig(): TraceConfig {
  const env = typeof process !== 'undefined' ? process.env : {};

  const includePatterns = env['TRACE_INCLUDE']?.split(',').filter(Boolean);
  const excludePatterns = env['TRACE_EXCLUDE']?.split(',').filter(Boolean);

  const config: TraceConfig = {
    enabled: env['TRACE_ENABLED'] === 'true',
    level: (env['TRACE_LEVEL'] as TraceConfig['level']) ?? 'verbose',
  };

  if (includePatterns && includePatterns.length > 0) {
    config.include = includePatterns;
  }
  if (excludePatterns && excludePatterns.length > 0) {
    config.exclude = excludePatterns;
  }

  return config;
}


const traceConfig = getTraceConfig();
const traceLogger = createLogger({ namespace: 'TRACE', level: 'debug' });

/** Check if a namespace should be traced */
function shouldTrace(name: string): boolean {
  if (!traceConfig.enabled) return false;
  if (traceConfig.level === 'off') return false;

  // Check exclude patterns
  if (traceConfig.exclude?.some(p => matchPattern(name, p))) {
    return false;
  }

  // Check include patterns (if specified)
  if (traceConfig.include && traceConfig.include.length > 0) {
    return traceConfig.include.some(p => matchPattern(name, p));
  }

  return true;
}

/** Simple glob pattern matching */
function matchPattern(name: string, pattern: string): boolean {
  const regex = new RegExp(
    '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
  );
  return regex.test(name);
}

/** Format trace output */
function formatTrace(entry: TraceEntry): void {
  const { name, args, result, error, durationMs } = entry;

  if (traceConfig.level === 'minimal') {
    traceLogger.debug(`${name} (${durationMs}ms)`);
    return;
  }

  // Verbose output
  traceLogger.debug(`${name}`);

  if (args.length > 0) {
    const argsStr = JSON.stringify(args, truncateReplacer, 2);
    traceLogger.debug(`  ├─ args: ${argsStr}`);
  }

  traceLogger.debug(`  ├─ duration: ${durationMs}ms`);

  if (error) {
    traceLogger.debug(`  └─ error: ${error.message}`);
  } else if (result !== undefined) {
    const resultStr = JSON.stringify(result, truncateReplacer, 2);
    traceLogger.debug(`  └─ result: ${resultStr}`);
  }
}

/** JSON replacer to truncate large values */
function truncateReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && value.length > 100) {
    return value.slice(0, 100) + '...';
  }
  if (Array.isArray(value) && value.length > 10) {
    return [...value.slice(0, 10), `... ${value.length - 10} more`];
  }
  return value;
}

/**
 * Method decorator for tracing class methods
 * 
 * @example
 * class MyService {
 *   @trace()
 *   async doWork(input: string): Promise<Result> {
 *     // ...
 *   }
 * }
 */
export function trace() {
  return function <T extends (...args: any[]) => any>(
    target: object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>
  ): TypedPropertyDescriptor<T> {
    const originalMethod = descriptor.value;
    if (!originalMethod) return descriptor;

    const className = target.constructor.name;
    const methodName = String(propertyKey);
    const traceName = `${className}.${methodName}`;

    descriptor.value = function (this: unknown, ...args: unknown[]) {
      if (!shouldTrace(traceName)) {
        return originalMethod.apply(this, args);
      }

      const start = performance.now();

      try {
        const result = originalMethod.apply(this, args);

        // Handle promises
        if (result instanceof Promise) {
          return result
            .then((res) => {
              formatTrace({
                name: traceName,
                args,
                result: res,
                durationMs: Math.round(performance.now() - start),
                timestamp: new Date(),
              });
              return res;
            })
            .catch((err: Error) => {
              formatTrace({
                name: traceName,
                args,
                error: err,
                durationMs: Math.round(performance.now() - start),
                timestamp: new Date(),
              });
              throw err;
            });
        }

        formatTrace({
          name: traceName,
          args,
          result,
          durationMs: Math.round(performance.now() - start),
          timestamp: new Date(),
        });

        return result;
      } catch (err) {
        formatTrace({
          name: traceName,
          args,
          error: err instanceof Error ? err : new Error(String(err)),
          durationMs: Math.round(performance.now() - start),
          timestamp: new Date(),
        });
        throw err;
      }
    } as T;

    return descriptor;
  };
}

/**
 * Wrap a standalone function with tracing
 * 
 * @example
 * const myFn = traced('myFunction', (x: number) => x * 2);
 */
export function traced<T extends (...args: any[]) => any>(
  name: string,
  fn: T
): T {
  return function (this: unknown, ...args: Parameters<T>): ReturnType<T> {
    if (!shouldTrace(name)) {
      return fn.apply(this, args) as ReturnType<T>;
    }

    const start = performance.now();

    try {
      const result = fn.apply(this, args);

      if (result instanceof Promise) {
        return result
          .then((res) => {
            formatTrace({
              name,
              args,
              result: res,
              durationMs: Math.round(performance.now() - start),
              timestamp: new Date(),
            });
            return res;
          })
          .catch((err: Error) => {
            formatTrace({
              name,
              args,
              error: err,
              durationMs: Math.round(performance.now() - start),
              timestamp: new Date(),
            });
            throw err;
          }) as ReturnType<T>;
      }

      formatTrace({
        name,
        args,
        result,
        durationMs: Math.round(performance.now() - start),
        timestamp: new Date(),
      });

      return result as ReturnType<T>;
    } catch (err) {
      formatTrace({
        name,
        args,
        error: err instanceof Error ? err : new Error(String(err)),
        durationMs: Math.round(performance.now() - start),
        timestamp: new Date(),
      });
      throw err;
    }
  } as T;
}

/**
 * Inline trace block for arbitrary code
 * 
 * @example
 * const result = await withTrace('loadData', async () => {
 *   return await fetchData();
 * });
 */
export async function withTrace<T>(
  name: string,
  fn: () => T | Promise<T>
): Promise<T> {
  if (!shouldTrace(name)) {
    return fn();
  }

  const start = performance.now();

  try {
    const result = await fn();

    formatTrace({
      name,
      args: [],
      result,
      durationMs: Math.round(performance.now() - start),
      timestamp: new Date(),
    });

    return result;
  } catch (err) {
    formatTrace({
      name,
      args: [],
      error: err instanceof Error ? err : new Error(String(err)),
      durationMs: Math.round(performance.now() - start),
      timestamp: new Date(),
    });
    throw err;
  }
}

/** Re-export trace config for testing */
export { traceConfig };
