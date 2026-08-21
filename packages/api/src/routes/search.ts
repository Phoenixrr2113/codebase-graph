import { Hono } from 'hono';
import { codeGraphService, getGraphClient } from '@codegraph/core';
import { getKnownNodeLabels } from '../graph-labels';
import { safeErrorMessage } from '../safe-error';

export const searchRoutes = new Hono();

const DEFAULT_SEARCH_LIMIT = 20;
const MIN_SEARCH_LIMIT = 1;
// Keep one request from asking the vector ranker or Cypher fallback for an
// unbounded result window. Dashboard callers currently request 20 or 30.
const MAX_SEARCH_LIMIT = 100;
const SEARCH_LIMIT_ERROR = `limit parameter must be an integer between ${MIN_SEARCH_LIMIT} and ${MAX_SEARCH_LIMIT}`;

/**
 * What to do about a caller-supplied `types` filter, decided once against
 * the live label allowlist so the route only has to act on the answer.
 *
 * - `none`: no `types` param was given; search is unfiltered.
 * - `labels`: `types` was given and every requested label is real; use them.
 * - `not-indexed`: `types` was given, but the graph has no labels at all
 *   yet (a fresh install, or any moment before the first index completes).
 *   There is nothing to validate against, so every label would otherwise
 *   look "unknown", which reads as a typo when the real cause is "there is
 *   no index yet". This is reported distinctly so the route can say that
 *   honestly instead of either rejecting a well-formed request or skipping
 *   validation and building a query around the raw value.
 * - `invalid`: `types` was given, the graph does have labels, and at least
 *   one requested one is not among them (a typo, or an injection attempt).
 */
export type TypeFilterDecision =
  | { kind: 'none' }
  | { kind: 'labels'; labels: string[] }
  | { kind: 'not-indexed' }
  | { kind: 'invalid'; message: string };

/**
 * Decide what a comma-separated `types` query parameter means against the
 * given label allowlist. Cypher has no way to parameterize a label, so a
 * caller-supplied type name cannot go straight into the fallback query's
 * WHERE clause: `types=Function) OR (true` turns it into `(n:Function) OR
 * (true) AND (...)`, which matches every node regardless of label.
 * Validating first closes that off, whichever outcome this returns:
 * `not-indexed` and `invalid` both stop before any label reaches a query
 * string, exactly like `labels` does when it succeeds.
 *
 * `knownLabels` is the live set of labels the graph actually contains (see
 * graph-labels.ts), not a hardcoded guess, so a real label like `Commit` or
 * `TypeRef` is accepted and a typo or injection attempt is rejected, naming
 * exactly what was wrong. Every one of those labels came from `labels(n)[0]`
 * on real nodes, which Cypher only ever populates from a bare identifier in
 * a `CREATE`/`MERGE (n:Identifier)` clause elsewhere in this codebase's own
 * indexing code; the label grammar has no room for a smuggled predicate, so
 * a value drawn from that set is exactly as safe to interpolate as it was
 * when the allowlist was a fixed literal.
 */
export function resolveTypeFilter(
  types: string | undefined,
  knownLabels: ReadonlySet<string>,
): TypeFilterDecision {
  if (!types) return { kind: 'none' };

  if (knownLabels.size === 0) {
    return { kind: 'not-indexed' };
  }

  const requested = types.split(',').map(t => t.trim()).filter(t => t !== '');

  // A `types` value that is present but normalizes to nothing (all commas,
  // all whitespace, or some mix) names no real label. Returning `none` here
  // would silently discard a parameter the caller did send; returning
  // `labels: []` is what let this reach the query-building code downstream
  // at all, because `[]` is truthy in JavaScript. The vector-hit filter
  // did `[].includes(hit.nodeType)`, always false, so every hit was
  // discarded regardless of what the search actually found; the Cypher
  // fallback then took `requestedLabels ? ... : ...`'s truthy branch and
  // built `[].map(...).join(' OR ')`, an empty string, producing
  // `WHERE () AND (...)`, which is not valid Cypher. FalkorDB's syntax
  // error for that included the query text itself, which the route's catch
  // block then forwarded straight to the caller: a 500 with a fragment of
  // the actual Cypher in the body, on `types=%20`, `types=,`, or any value
  // that normalizes the same way. Rejecting it here, before this function
  // returns at all, means an empty array can never reach either the vector
  // filter or the fallback query: `kind: 'labels'` is only ever returned
  // with at least one entry in `labels`.
  if (requested.length === 0) {
    return {
      kind: 'invalid',
      message: `The types parameter was given but named no real label. Valid types are: ${[...knownLabels].sort().join(', ')}.`,
    };
  }

  const invalid = requested.filter(t => !knownLabels.has(t));

  if (invalid.length > 0) {
    return {
      kind: 'invalid',
      message: `Unknown node type(s): ${invalid.join(', ')}. Valid types are: ${[...knownLabels].sort().join(', ')}.`,
    };
  }

  return { kind: 'labels', labels: requested };
}

/**
 * Explain what a `types` filter actually did to the vector-search hits,
 * whichever way the request ends up.
 *
 * `codeGraphService.search()` has no `types` option of its own, so a filter
 * is applied here, after the fact, to the hits it returns. That means the
 * search's own `limit` was already spent on the *unfiltered* ranking, before
 * any type filtering happened. Two distinct problems fall out of that:
 *
 * 1. Filtering can leave a page that looks smaller than it should, when the
 *    raw (pre-filter) search was itself truncated to `limit`: there is no
 *    way to tell "there are only this many matches" from "the matches that
 *    exist beyond the fetched window were never looked at".
 * 2. Filtering can remove every hit, in which case the route falls through
 *    to the substring Cypher fallback below. That fallback is a materially
 *    weaker retrieval method for a natural-language query (literal
 *    name/path matching, not ranked relevance), and it is not being reached
 *    because the search failed, but because a post-hoc filter emptied a
 *    truncated page. Whatever count comes back from it has to say so,
 *    or `total: 0` reads as "nothing of this type exists" when the honest
 *    answer is "the ranked search found some, none were examined as this
 *    type, and a different, weaker search was tried after".
 *
 * `reachedFallback` selects which of those two explanations applies.
 * Returns undefined when neither applies: an unfiltered search, a filtered
 * page that still came back full, or (in the fallback case) a fallback that
 * was reached for the ordinary reason of zero raw hits, unrelated to type
 * filtering, where `result.meta.notice` already explains why.
 */
export function typeFilterNotice(
  labels: string[],
  rawHitCount: number,
  filteredHitCount: number,
  limit: number,
  reachedFallback: boolean,
): string | undefined {
  if (reachedFallback) {
    // Zero raw hits means the vector search itself found nothing, for its
    // own ordinary reasons (no embeddings, no semantic match at all); that
    // is not something type filtering caused, so nothing to add here.
    if (rawHitCount === 0) return undefined;

    const truncationCaveat = rawHitCount >= limit
      ? ' The ranked search was itself truncated at that count, so there is no way to tell whether more would have matched beyond it.'
      : ' The ranked search examined every candidate it had for this query, so this is not a truncation artifact.';
    return `None of the top ${rawHitCount} ranked results (limit ${limit}) matched types=${labels.join(',')}, so the results below come from a substring search over the whole graph instead, a different and generally weaker retrieval method than the ranked search above.${truncationCaveat}`;
  }

  if (filteredHitCount >= limit) return undefined;
  if (rawHitCount < limit) return undefined;
  return `Only ${filteredHitCount} of the top ${rawHitCount} ranked results (limit ${limit}) matched types=${labels.join(',')}. The type filter runs after ranking on this search path, so there may be more matches beyond the fetched window; raise limit to check, or narrow the query.`;
}

/** GET /api/search?q=X&types=Y&limit=N: search code symbols */
searchRoutes.get('/api/search', async (c) => {
  try {
    const query = c.req.query('q');
    if (!query) return c.json({ error: 'q parameter is required' }, 400);

    const rawLimit = c.req.query('limit');
    const limit = rawLimit === undefined ? DEFAULT_SEARCH_LIMIT : Number(rawLimit);
    if (!Number.isInteger(limit) || limit < MIN_SEARCH_LIMIT || limit > MAX_SEARCH_LIMIT) {
      return c.json({ error: SEARCH_LIMIT_ERROR }, 400);
    }
    const scope = c.req.query('scope');
    const types = c.req.query('types');

    // Only pay for a label-discovery round trip when a type filter was
    // actually requested; the common case (no `types`) never touches this.
    let requestedLabels: string[] | null = null;
    if (types) {
      const client = await getGraphClient();
      const knownLabels = await getKnownNodeLabels(client);
      const decision = resolveTypeFilter(types, knownLabels);

      if (decision.kind === 'not-indexed') {
        // Neither "reject as a bad label" nor "skip validation and run the
        // query anyway": the graph has nothing in it, so no search on this
        // graph, filtered or not, could return anything. Say so and stop,
        // without ever building a query around the unvalidated value.
        return c.json({
          results: [],
          total: 0,
          durationMs: 0,
          notice: 'The graph has no indexed nodes yet, so `types` cannot be checked against anything real. Once indexing finishes, this filter will be validated normally.',
        });
      }
      if (decision.kind === 'invalid') {
        return c.json({ error: decision.message }, 400);
      }
      if (decision.kind === 'labels') {
        requestedLabels = decision.labels;
      }
    }

    const opts: { limit: number; scope?: string } = { limit };
    if (scope) opts.scope = scope;

    // Try vector search first (requires embeddings)
    const result = await codeGraphService.search(query, opts);

    // codeGraphService.search() has no `types` option of its own (the vector
    // index only ever covers the embeddable node types), so a `types` filter
    // is applied here, to the hits it returns, rather than being validated
    // up front and then silently ignored on this path. A `types` value the
    // vector path can never produce (Commit, TypeRef, and so on) filters
    // every hit out, which correctly falls through to the Cypher path below,
    // where those labels do exist.
    const rawHitCount = result.hits.length;
    let hits = result.hits;
    if (requestedLabels !== null) {
      const labels = requestedLabels;
      hits = hits.filter(hit => labels.includes(hit.nodeType));
    }

    if (hits.length > 0) {
      const notice = requestedLabels
        ? typeFilterNotice(requestedLabels, rawHitCount, hits.length, limit, false)
        : undefined;
      const response: { results: typeof hits; total: number; durationMs: number; notice?: string } = {
        results: hits,
        total: hits.length,
        durationMs: result.meta.durationMs,
      };
      if (notice) response.notice = notice;
      return c.json(response);
    }

    // Fallback: text-based Cypher search when vector search returns nothing
    // (no embeddings configured, no matches, or every vector hit was
    // filtered out by a `types` value the vector path cannot itself
    // satisfy). The type filter is applied inside this query's WHERE
    // clause, so LIMIT here runs after filtering, not before it: whatever
    // this returns is exhaustive for that type across the whole graph, not
    // limited to the vector search's fetched window. That is a genuinely
    // different, type-exhaustive search, worth running, but the response
    // still has to say when it is the reason we are here, rather than
    // silently presenting a substring match as if it were the ranked
    // search's own answer.
    const start = Date.now();
    const client = await getGraphClient();

    const typeFilter = requestedLabels
      ? requestedLabels.map(t => `n:${t}`).join(' OR ')
      : 'n:Function OR n:Class OR n:Interface OR n:Component OR n:Type OR n:Variable OR n:File';

    const rows = await client.roQuery<{
      name: string;
      nodeType: string;
      filePath: string | null;
      startLine: number | null;
      endLine: number | null;
      isExported: boolean | null;
    }>(
      `MATCH (n)
       WHERE (${typeFilter})
         AND (toLower(n.name) CONTAINS toLower($q) OR toLower(n.filePath) CONTAINS toLower($q))
       RETURN n.name AS name,
              labels(n)[0] AS nodeType,
              n.filePath AS filePath,
              n.startLine AS startLine,
              n.endLine AS endLine,
              n.isExported AS isExported
       ORDER BY CASE WHEN toLower(n.name) = toLower($q) THEN 0 ELSE 1 END, n.name
       LIMIT $limit`,
      { params: { q: query, limit } },
    );

    const durationMs = Date.now() - start;

    const fallbackNotice = requestedLabels
      ? typeFilterNotice(requestedLabels, rawHitCount, 0, limit, true)
      : undefined;

    return c.json({
      results: rows.data.map(r => ({
        name: r.name,
        nodeType: r.nodeType,
        filePath: r.filePath,
        startLine: r.startLine,
        endLine: r.endLine,
        isExported: r.isExported,
      })),
      total: rows.data.length,
      durationMs,
      fallback: true,
      notice: fallbackNotice ?? result.meta.notice,
    });
  } catch (error) {
    return c.json({ error: safeErrorMessage('GET /api/search', error, 'Search failed.') }, 500);
  }
});
