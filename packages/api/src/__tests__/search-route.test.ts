/**
 * Route-level coverage for GET /api/search's `types` filter, exercising the
 * actual Hono handler rather than the extracted pure functions in isolation.
 *
 * This file exists because of a specific gap: `typeFilterNotice` (formerly
 * `typeFilterShortfallNotice`) was fully covered as a pure function, but
 * nothing ever checked that the route actually *attached* its result to
 * every response it could produce. It attached the notice inside the
 * `hits.length > 0` branch and silently dropped it when the type filter
 * emptied the page and the route fell through to the Cypher substring
 * fallback, which is exactly the case a caller most needs the notice for:
 * `total: 0` there could mean "nothing of this type exists" or "the ranked
 * search found real results, none were this type in the fetched window, and
 * a different, weaker search then also came up empty". A pure-function test
 * of the notice generator alone cannot see that wiring bug; only calling the
 * route can.
 *
 * `@codegraph/core` and `../graph-labels` are mocked so this never touches a
 * real graph; `searchRoutes.request(...)` is Hono's supported in-process way
 * to exercise a route without a listening server.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@codegraph/core', () => ({
  codeGraphService: { search: vi.fn() },
  getGraphClient: vi.fn(),
}));
vi.mock('../graph-labels', () => ({
  getKnownNodeLabels: vi.fn(),
}));

import { codeGraphService, getGraphClient, type EnrichedV2Result } from '@codegraph/core';
import { getKnownNodeLabels } from '../graph-labels';
import { searchRoutes } from '../routes/search';

const mockedSearch = vi.mocked(codeGraphService.search);
const mockedGetGraphClient = vi.mocked(getGraphClient);
const mockedGetKnownNodeLabels = vi.mocked(getKnownNodeLabels);

const KNOWN_LABELS = new Set(['Class', 'Interface', 'Function', 'Variable']);

/** Builds the exact three-hit vector-search result the coordinator's live repro used. */
function threeRawHits(): EnrichedV2Result {
  return {
    hits: [
      { name: 'GraphClient', nodeType: 'Class' },
      { name: 'ClientOptions', nodeType: 'Interface' },
      { name: 'createGraphClient', nodeType: 'Function' },
    ],
    meta: { query: 'graph client', vectorHits: 3, durationMs: 5 },
  };
}

function fakeGraphClient(fallbackRows: Array<Record<string, unknown>>) {
  return {
    graphName: 'test-graph',
    roQuery: vi.fn().mockResolvedValue({ data: fallbackRows, metadata: [] }),
  };
}

async function searchJson(query: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await searchRoutes.request(`/api/search?${query}`);
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

describe('GET /api/search: limit validation', () => {
  beforeEach(() => {
    mockedSearch.mockReset();
    mockedGetGraphClient.mockReset();
    mockedGetKnownNodeLabels.mockReset();
  });

  it.each(['0', '-1', '1.5', '101', 'not-a-number'])(
    'rejects limit=%s with 400 before calling the search service',
    async (limit) => {
      const { status, body } = await searchJson(`q=test&limit=${encodeURIComponent(limit)}`);

      expect(status).toBe(400);
      expect(body).toEqual({ error: 'limit parameter must be an integer between 1 and 100' });
      expect(mockedSearch).not.toHaveBeenCalled();
      expect(mockedGetGraphClient).not.toHaveBeenCalled();
    },
  );
});

describe('GET /api/search: types filter emptying the page', () => {
  beforeEach(() => {
    mockedSearch.mockReset();
    mockedGetGraphClient.mockReset();
    mockedGetKnownNodeLabels.mockReset();
    mockedGetKnownNodeLabels.mockResolvedValue(KNOWN_LABELS);
  });

  // Baseline from the coordinator's live repro: q=graph client&limit=3 ->
  // hits [Class, Interface, Function], total 3.
  it('unfiltered: returns all three raw hits, no notice, no fallback', async () => {
    mockedSearch.mockResolvedValue(threeRawHits());
    mockedGetGraphClient.mockResolvedValue(fakeGraphClient([]) as never);

    const { status, body } = await searchJson('q=graph+client&limit=3');

    expect(status).toBe(200);
    expect(body.total).toBe(3);
    expect(body.notice).toBeUndefined();
    expect(body.fallback).toBeUndefined();
  });

  // q=graph client&limit=3&types=Class -> total 1, notice present: True.
  // The "mild" case: filtering leaves at least one hit, so the response
  // comes from the vector-search branch with a shortfall caveat attached.
  it('types=Class: filtering leaves one hit, response carries a shortfall notice', async () => {
    mockedSearch.mockResolvedValue(threeRawHits());
    mockedGetGraphClient.mockResolvedValue(fakeGraphClient([]) as never);

    const { status, body } = await searchJson('q=graph+client&limit=3&types=Class');

    expect(status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.fallback).toBeUndefined();
    expect(body.notice).toBeDefined();
    expect(String(body.notice)).toContain('Class');
  });

  // q=graph client&limit=3&types=Variable -> total 0, fallback: True.
  // This is the reported bug: filtering removes every raw hit, the route
  // falls through to the substring Cypher fallback (mocked here to also
  // find nothing, matching the coordinator's live repro), and the response
  // must now carry a notice explaining that a weaker fallback search ran
  // because the type filter emptied the ranked search's page, not because
  // nothing was found in the first place.
  it('types=Variable: filtering empties the page, fallback runs, notice is now present', async () => {
    mockedSearch.mockResolvedValue(threeRawHits());
    mockedGetGraphClient.mockResolvedValue(fakeGraphClient([]) as never);

    const { status, body } = await searchJson('q=graph+client&limit=3&types=Variable');

    expect(status).toBe(200);
    expect(body.fallback).toBe(true);
    expect(body.total).toBe(0);
    expect(body.notice).toBeDefined();
    expect(String(body.notice)).toContain('Variable');
    expect(String(body.notice)).toMatch(/substring/i);
  });

  it('types=Variable: still says so even when the substring fallback does find something', async () => {
    mockedSearch.mockResolvedValue(threeRawHits());
    mockedGetGraphClient.mockResolvedValue(
      fakeGraphClient([
        { name: 'clientCache', nodeType: 'Variable', filePath: '/x.ts', startLine: 1, endLine: 1, isExported: true },
      ]) as never,
    );

    const { status, body } = await searchJson('q=graph+client&limit=3&types=Variable');

    expect(status).toBe(200);
    expect(body.fallback).toBe(true);
    expect(body.total).toBe(1);
    // Even with a non-zero fallback result, the caller still needs to know
    // it came from the weaker substring path, not the ranked search.
    expect(body.notice).toBeDefined();
  });

  // The fallback path is also reached for its ordinary, pre-existing reason
  // (the vector search itself found nothing), entirely unrelated to type
  // filtering. That case must not get a type-filter notice grafted onto it.
  it('ordinary fallback trigger (zero raw hits, no type filter): no type-filter notice added', async () => {
    mockedSearch.mockResolvedValue({
      hits: [],
      meta: { query: 'graph client', vectorHits: 0, durationMs: 2, notice: 'No embeddings found in the graph yet.' },
    });
    mockedGetGraphClient.mockResolvedValue(fakeGraphClient([]) as never);

    const { status, body } = await searchJson('q=graph+client&limit=3');

    expect(status).toBe(200);
    expect(body.fallback).toBe(true);
    expect(body.notice).toBe('No embeddings found in the graph yet.');
  });

  it('ordinary fallback trigger with a type filter present: zero raw hits still gets no type-filter notice', async () => {
    // rawHitCount is 0 here regardless of the type filter, since the vector
    // search itself returned nothing; the shortfall/fallback notice is
    // specifically about type filtering removing *real* raw hits, which
    // did not happen here.
    mockedSearch.mockResolvedValue({
      hits: [],
      meta: { query: 'graph client', vectorHits: 0, durationMs: 2 },
    });
    mockedGetGraphClient.mockResolvedValue(
      fakeGraphClient([
        { name: 'clientCache', nodeType: 'Variable', filePath: '/x.ts', startLine: 1, endLine: 1, isExported: true },
      ]) as never,
    );

    const { status, body } = await searchJson('q=graph+client&limit=3&types=Variable');

    expect(status).toBe(200);
    expect(body.fallback).toBe(true);
    expect(body.total).toBe(1);
    expect(body.notice).toBeUndefined();
  });
});

describe('GET /api/search: malformed types values (third adversarial-review finding)', () => {
  // types=%20, types=,, and similar all normalize to an empty label list.
  // Before the fix, resolveTypeFilter returned { kind: 'labels', labels: []
  // }, an empty array is truthy in JavaScript, so the route treated it as a
  // real filter, discarded every vector-search hit (`[].includes(x)` is
  // always false), and built `WHERE () AND (...)` for the Cypher fallback,
  // which FalkorDB rejects as a syntax error. That error's message, with
  // Cypher text in it, went straight back to the caller as the 500 body.
  // Verified live: GET /api/search?q=test&types=%20 returned
  // {"error":"Read-only query failed: errMsg: Invalid input 'A' ... errCtx:
  // AND (toLower(n.name) CONTAINS ..."}. These tests assert both the status
  // code and that no Cypher fragment (MATCH, WHERE, errCtx) ever reaches
  // the response body, and that the search and query layers are never even
  // called for a value this route should reject up front.

  beforeEach(() => {
    mockedSearch.mockReset();
    mockedGetGraphClient.mockReset();
    mockedGetKnownNodeLabels.mockReset();
  });

  it('rejects a whitespace-only types value with 400, not a 500 with leaked Cypher', async () => {
    mockedGetKnownNodeLabels.mockResolvedValue(KNOWN_LABELS);
    const client = fakeGraphClient([]);
    mockedGetGraphClient.mockResolvedValue(client as never);

    const { status, body } = await searchJson('q=test&types=' + encodeURIComponent(' '));

    expect(status).toBe(400);
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('MATCH');
    expect(bodyText).not.toContain('WHERE');
    expect(bodyText).not.toContain('errCtx');
    expect(bodyText).not.toContain('errMsg');
    // The malformed value is rejected before any query runs at all.
    expect(mockedSearch).not.toHaveBeenCalled();
    expect(client.roQuery).not.toHaveBeenCalled();
  });

  it('rejects a comma-only types value with 400, not a 500 with leaked Cypher', async () => {
    mockedGetKnownNodeLabels.mockResolvedValue(KNOWN_LABELS);
    const client = fakeGraphClient([]);
    mockedGetGraphClient.mockResolvedValue(client as never);

    const { status, body } = await searchJson('q=test&types=,');

    expect(status).toBe(400);
    const bodyText = JSON.stringify(body);
    expect(bodyText).not.toContain('MATCH');
    expect(bodyText).not.toContain('WHERE');
    expect(mockedSearch).not.toHaveBeenCalled();
    expect(client.roQuery).not.toHaveBeenCalled();
  });

  it('rejects a mix of commas and whitespace with 400', async () => {
    mockedGetKnownNodeLabels.mockResolvedValue(KNOWN_LABELS);
    mockedGetGraphClient.mockResolvedValue(fakeGraphClient([]) as never);

    const { status, body } = await searchJson('q=test&types=' + encodeURIComponent(' , , '));

    expect(status).toBe(400);
    expect(JSON.stringify(body)).not.toContain('WHERE');
  });

  it('a literal empty types value is treated as no filter, not rejected', async () => {
    // types= (nothing after the equals sign) is different from types=%20:
    // the route's own truthy check on the query string already treats an
    // empty string as "no filter given", the same as omitting `types`
    // entirely, so this never even reaches resolveTypeFilter.
    mockedGetKnownNodeLabels.mockResolvedValue(KNOWN_LABELS);
    mockedSearch.mockResolvedValue(threeRawHits());
    mockedGetGraphClient.mockResolvedValue(fakeGraphClient([]) as never);

    const { status, body } = await searchJson('q=graph+client&limit=3&types=');

    expect(status).toBe(200);
    expect(body.total).toBe(3);
  });

  it('a trailing comma with one real label still works (the coordinator-verified passing case)', async () => {
    mockedGetKnownNodeLabels.mockResolvedValue(KNOWN_LABELS);
    mockedSearch.mockResolvedValue(threeRawHits());
    mockedGetGraphClient.mockResolvedValue(fakeGraphClient([]) as never);

    const { status, body } = await searchJson('q=graph+client&limit=3&types=Class,');

    expect(status).toBe(200);
    expect(body.total).toBe(1);
  });
});
