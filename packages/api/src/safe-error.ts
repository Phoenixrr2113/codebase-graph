/**
 * A route's generic catch-all handler is not the place to echo `error.message`
 * to the caller. The FalkorDB driver's error text can include the Cypher
 * query itself, or fragments of it, in its errCtx field: a malformed or
 * unexpected query anywhere in this package can turn an ordinary 500 into
 * exactly the kind of internal-query-text leak the label-allowlist
 * validation in routes/search.ts exists to prevent. That hole does not need
 * a new bug to open; the generic catch block already had the leak built in,
 * for any exception the try block did not anticipate.
 *
 * Routes should log the real error server-side, where an operator can see
 * it, and return a fixed, safe message to the HTTP caller instead of
 * `error.message`. The one deliberate exception is POST /api/query/cypher:
 * that endpoint runs Cypher the caller wrote themselves, so the engine's
 * error is feedback about the caller's own input, not an internal detail,
 * and hiding it there would make the tool unusable for its documented
 * purpose. Every other route in this package should use this helper.
 */

import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'api' });

/**
 * Log `error` under `routeLabel` and return `fallbackMessage`, the text a
 * route's catch block should send to the caller instead of `error.message`.
 */
export function safeErrorMessage(
  routeLabel: string,
  error: unknown,
  fallbackMessage: string,
): string {
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  logger.error(`${routeLabel} failed: ${detail}`);
  return fallbackMessage;
}
