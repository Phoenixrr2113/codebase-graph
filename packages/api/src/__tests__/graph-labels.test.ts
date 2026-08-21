/**
 * The `types` filter on GET /api/search validates against the live set of
 * labels the graph contains, not a hardcoded list, so a real label like
 * Commit or TypeRef is accepted even though it was never part of the
 * vector-search allowlist this used to (wrongly) borrow from. These tests
 * exercise the discovery query and its cache against a fake graph client, the
 * same style `source-access.test.ts` uses for a fake filesystem.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { discoverNodeLabels, getKnownNodeLabels, _resetLabelCacheForTests } from '../graph-labels';

/** Stands in for a GraphClient: returns canned rows and counts how many times it was queried. */
function fakeClient(rows: Array<{ label: string | null }>, graphName = 'test-graph') {
  let calls = 0;
  return {
    graphName,
    roQuery: async <T>() => {
      calls++;
      return { data: rows as unknown as T[], metadata: [] };
    },
    callCount: () => calls,
  };
}

describe('discoverNodeLabels', () => {
  it('returns the distinct labels present in the graph', async () => {
    const client = fakeClient([
      { label: 'Function' }, { label: 'Class' }, { label: 'Commit' }, { label: 'TypeRef' },
    ]);
    const labels = await discoverNodeLabels(client);
    expect(labels).toEqual(new Set(['Function', 'Class', 'Commit', 'TypeRef']));
  });

  it('includes graph-structure labels the vector-search allowlist never covered', async () => {
    const client = fakeClient([
      { label: 'Commit' }, { label: 'TypeRef' }, { label: 'Project' }, { label: 'Metadata' },
    ]);
    const labels = await discoverNodeLabels(client);
    expect(labels.has('Commit')).toBe(true);
    expect(labels.has('TypeRef')).toBe(true);
    expect(labels.has('Project')).toBe(true);
    expect(labels.has('Metadata')).toBe(true);
  });

  it('drops null and empty labels rather than surfacing them as filterable types', async () => {
    const client = fakeClient([{ label: 'File' }, { label: null }, { label: '' }]);
    const labels = await discoverNodeLabels(client);
    expect(labels).toEqual(new Set(['File']));
  });

  it('returns an empty set for an empty graph', async () => {
    const client = fakeClient([]);
    const labels = await discoverNodeLabels(client);
    expect(labels.size).toBe(0);
  });
});

describe('getKnownNodeLabels', () => {
  beforeEach(() => {
    _resetLabelCacheForTests();
  });

  it('queries the graph on first call', async () => {
    const client = fakeClient([{ label: 'Function' }]);
    const labels = await getKnownNodeLabels(client);
    expect(labels).toEqual(new Set(['Function']));
    expect(client.callCount()).toBe(1);
  });

  it('serves the second call from cache without querying again', async () => {
    const client = fakeClient([{ label: 'Function' }]);
    await getKnownNodeLabels(client);
    await getKnownNodeLabels(client);
    expect(client.callCount()).toBe(1);
  });

  it('queries again after the cache is reset', async () => {
    const client = fakeClient([{ label: 'Function' }]);
    await getKnownNodeLabels(client);
    _resetLabelCacheForTests();
    await getKnownNodeLabels(client);
    expect(client.callCount()).toBe(2);
  });

  it('caches independently per graph name', async () => {
    const clientA = fakeClient([{ label: 'Function' }], 'graph-a');
    const clientB = fakeClient([{ label: 'Commit' }], 'graph-b');
    const labelsA = await getKnownNodeLabels(clientA);
    const labelsB = await getKnownNodeLabels(clientB);
    expect(labelsA).toEqual(new Set(['Function']));
    expect(labelsB).toEqual(new Set(['Commit']));
  });

  // Empty-graph coverage: a fresh install, or any moment before the first
  // index completes, has zero nodes and therefore zero labels. Caching that
  // for the full TTL would make the first successful index invisible to
  // `/api/search?types=...` for up to five minutes after it finishes, which
  // is worse than just re-running a query over zero rows every time.
  it('does not cache an empty result: the next call queries again', async () => {
    const client = fakeClient([]);
    const first = await getKnownNodeLabels(client);
    const second = await getKnownNodeLabels(client);
    expect(first.size).toBe(0);
    expect(second.size).toBe(0);
    expect(client.callCount()).toBe(2);
  });

  it('picks up labels immediately once the graph stops being empty, with no reset needed', async () => {
    let indexed = false;
    let calls = 0;
    const client = {
      graphName: 'fresh-install',
      roQuery: async <T>() => {
        calls++;
        const rows = indexed ? [{ label: 'File' }] : [];
        return { data: rows as unknown as T[], metadata: [] };
      },
    };

    const beforeIndex = await getKnownNodeLabels(client);
    expect(beforeIndex.size).toBe(0);

    indexed = true;
    const afterIndex = await getKnownNodeLabels(client);
    expect(afterIndex).toEqual(new Set(['File']));
    expect(calls).toBe(2);
  });
});
