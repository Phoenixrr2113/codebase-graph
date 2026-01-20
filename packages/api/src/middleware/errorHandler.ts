/**
 * Error handler middleware for Hono API
 * Returns structured JSON error responses
 */

import type { Context, Next } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'API:Error' });

/** Structured API error response */
export interface ApiError {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
}

/** Create a standardized error response */
export function createErrorResponse(
  code: string,
  message: string,
  details?: unknown
): ApiError {
  return {
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
    },
    timestamp: new Date().toISOString(),
  };
}

/** Custom error class for API errors */
export class HttpError extends Error {
  constructor(
    public readonly statusCode: ContentfulStatusCode,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/** Error handler middleware */
export async function errorHandler(c: Context, next: Next): Promise<void | Response> {
  try {
    await next();
  } catch (err) {
    // Check for HttpError instance first
    if (err instanceof HttpError) {
      return c.json(
        createErrorResponse(err.code, err.message, err.details),
        err.statusCode
      );
    }

    // Duck typing fallback for HttpError-like errors
    // This handles cases where instanceof fails due to module boundaries
    if (
      err &&
      typeof err === 'object' &&
      'statusCode' in err &&
      'code' in err &&
      typeof (err as HttpError).statusCode === 'number' &&
      typeof (err as HttpError).code === 'string'
    ) {
      const httpErr = err as HttpError;
      return c.json(
        createErrorResponse(httpErr.code, httpErr.message, httpErr.details),
        httpErr.statusCode as ContentfulStatusCode
      );
    }

    if (err instanceof SyntaxError) {
      return c.json(
        createErrorResponse('BAD_REQUEST', 'Invalid JSON body'),
        400
      );
    }

    logger.error('Unhandled error', err);

    const message = err instanceof Error ? err.message : 'Internal server error';
    return c.json(
      createErrorResponse('INTERNAL_ERROR', message),
      500
    );
  }
}

/** 404 Not Found handler */
export function notFoundHandler(c: Context): Response {
  return c.json(
    createErrorResponse('NOT_FOUND', `Route not found: ${c.req.path}`),
    404
  );
}
