/**
 * Every route's catch-all handler used to forward `error.message` straight
 * to the HTTP caller. That is how the malformed `types` value in
 * routes/search.ts turned into a 500 with Cypher query text in the body:
 * the driver's own error text for an invalid query includes the query
 * itself. `safeErrorMessage` is the one place that gets to decide what an
 * unexpected error looks like to a caller, so no route has to make that
 * call itself, or forget to.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { safeErrorMessage } from '../safe-error';

describe('safeErrorMessage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the fallback message, not the error message', () => {
    const error = new Error('Read-only query failed: errMsg: Invalid input... errCtx: AND (toLower(n.name)...');
    const result = safeErrorMessage('GET /api/search', error, 'Search failed.');
    expect(result).toBe('Search failed.');
    expect(result).not.toContain('errCtx');
    expect(result).not.toContain('MATCH');
  });

  it('returns the fallback for a non-Error thrown value too', () => {
    const result = safeErrorMessage('GET /api/search', 'a raw string throw with WHERE (n:X) in it', 'Search failed.');
    expect(result).toBe('Search failed.');
    expect(result).not.toContain('WHERE');
  });

  it('returns the fallback for an undefined or null thrown value', () => {
    expect(safeErrorMessage('GET /api/search', undefined, 'Search failed.')).toBe('Search failed.');
    expect(safeErrorMessage('GET /api/search', null, 'Search failed.')).toBe('Search failed.');
  });

  it('never includes the route label in the returned message either', () => {
    // The route label is for the server-side log line, not the response;
    // it should not leak internal route/module naming into the body.
    const result = safeErrorMessage('GET /api/graph/full', new Error('boom'), 'Failed to fetch graph.');
    expect(result).not.toContain('/api/graph/full');
  });
});
