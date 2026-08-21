/**
 * Discover the node labels that actually exist in the graph, so a
 * caller-supplied label can be validated against reality rather than a
 * hand-maintained guess.
 *
 * Cypher has no way to parameterize a label, so anywhere a label ends up
 * interpolated into a query string (see routes/search.ts) needs an
 * allowlist to check it against first. A hardcoded list of "the labels we
 * think exist" drifts: this graph also contains Commit, TypeRef, Project and
 * Metadata nodes alongside the code-symbol types, and a list copied by hand
 * either misses real ones (rejecting a legitimate request) or has to be
 * re-copied every time the indexer learns a new node type. The only
 * allowlist that cannot drift out of date is the live schema itself, so this
 * asks the graph directly rather than adding a fourth hand-maintained copy
 * next to the ones in operations.ts, embed-nodes.ts and the dashboard's
 * legend.
 */

import type { GraphClient } from '@codegraph/graph';

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedLabels {
  labels: Set<string>;
  fetchedAt: number;
}

const cache = new Map<string, CachedLabels>();

/** Test-only: clears the cache so each test starts from a clean slate. */
export function _resetLabelCacheForTests(): void {
  cache.clear();
}

/**
 * Query the graph for every distinct label currently in use.
 *
 * No caching and no fallback here by design. This is the thin, directly
 * testable piece; `getKnownNodeLabels` below is the cached wrapper routes
 * should actually call.
 */
export async function discoverNodeLabels(
  client: Pick<GraphClient, 'roQuery'>,
): Promise<Set<string>> {
  const result = await client.roQuery<{ label: string | null }>(
    'MATCH (n) WHERE labels(n)[0] IS NOT NULL RETURN DISTINCT labels(n)[0] AS label',
  );
  return new Set(
    result.data
      .map(row => row.label)
      .filter((label): label is string => typeof label === 'string' && label.length > 0),
  );
}

/**
 * Cached, per-graph view of `discoverNodeLabels`.
 *
 * A search request that filters by type would otherwise force a full label
 * scan on every call. The cache is keyed by graph name (matching the pattern
 * `getEmbeddedLabels` already uses in @codegraph/core) and expires quickly
 * enough that a label introduced by a fresh index run becomes filterable
 * without restarting the server.
 */
export async function getKnownNodeLabels(
  client: Pick<GraphClient, 'roQuery' | 'graphName'>,
): Promise<Set<string>> {
  const cached = cache.get(client.graphName);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.labels;
  }
  const labels = await discoverNodeLabels(client);
  // Deliberately do not cache an empty result. An empty graph is almost
  // always a transient pre-index state (fresh install, or between a clear
  // and the next index run), and it is cheap to re-query: zero rows is a
  // fast scan. Caching "nothing yet" for the full TTL would make the first
  // successful index invisible to callers for up to CACHE_TTL_MS afterward,
  // which is exactly the staleness a short-lived cache is supposed to avoid.
  if (labels.size > 0) {
    cache.set(client.graphName, { labels, fetchedAt: Date.now() });
  }
  return labels;
}
