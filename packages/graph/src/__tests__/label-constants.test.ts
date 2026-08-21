import { describe, it, expect, vi } from 'vitest';
import {
  SYMBOL_LABELS,
  REFERENCEABLE_LABELS,
  EMBEDDABLE_LABELS,
  SUMMARY_LABELS,
  ALL_GRAPH_LABELS,
} from '@codegraph/types';
import { createQueries } from '../queries';
import { createOperations } from '../operations';
import { getIndexSummary } from '../fileTree';
import { ensureSchemaImpl } from '../drivers/falkordb-shared';
import { falkorDialect } from '../drivers/falkordb';
import type { GraphClient, QueryOptions, QueryResult } from '../client';

/**
 * Locks in the exact label sets used by every call site that was refactored
 * to import from packages/types instead of hand-copying a string array.
 * These sites had already drifted apart before the refactor (one had
 * 'External', another didn't; one had 'Entity', another didn't) so this
 * test exists to make sure the shared constant, not a fresh copy-paste
 * mistake, is what each site is actually using.
 */

function makeFakeClient(): GraphClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    graph: null,
    graphName: 'test',
    dialect: falkorDialect,
    calls,
    async query<T>(cypher: string, _options?: QueryOptions): Promise<QueryResult<T>> {
      calls.push(cypher);
      return { data: [] as T[], metadata: [] };
    },
    async roQuery<T>(cypher: string, _options?: QueryOptions): Promise<QueryResult<T>> {
      calls.push(cypher);
      return { data: [] as T[], metadata: [] };
    },
    async ensureIndexes(): Promise<void> {},
  } as unknown as GraphClient & { calls: string[] };
}

/** Every label the falkordb dialect would check for, as `alias:Label` tokens. */
function labelTokens(alias: string, labels: readonly string[]): string[] {
  return labels.map((l) => `${alias}:${l}`);
}

describe('queries.ts label sets (GET_FULL_GRAPH_NODES / GET_FULL_GRAPH_EDGES)', () => {
  it('GET_FULL_GRAPH_NODES filters on exactly REFERENCEABLE_LABELS (SYMBOL_LABELS + External)', async () => {
    const client = makeFakeClient();
    await createQueries(client).getFullGraph();

    const nodesQuery = client.calls.find((c) => c.includes('RETURN n,'));
    expect(nodesQuery).toBeDefined();

    for (const token of labelTokens('n', REFERENCEABLE_LABELS)) {
      expect(nodesQuery).toContain(token);
    }
    // Nothing beyond REFERENCEABLE_LABELS should show up as an n:<Label> check.
    const matches = [...(nodesQuery ?? '').matchAll(/n:([A-Za-z]+)/g)].map((m) => m[1]);
    expect(new Set(matches)).toEqual(new Set(REFERENCEABLE_LABELS));
  });

  it("GET_FULL_GRAPH_EDGES filters the source ('a') on SYMBOL_LABELS only, no External", async () => {
    const client = makeFakeClient();
    await createQueries(client).getFullGraph();

    const edgesQuery = client.calls.find((c) => c.includes('RETURN a, r, b,'));
    expect(edgesQuery).toBeDefined();

    for (const token of labelTokens('a', SYMBOL_LABELS)) {
      expect(edgesQuery).toContain(token);
    }
    expect(edgesQuery).not.toContain('a:External');

    const aMatches = [...(edgesQuery ?? '').matchAll(/a:([A-Za-z]+)/g)].map((m) => m[1]);
    expect(new Set(aMatches)).toEqual(new Set(SYMBOL_LABELS));
  });

  it("GET_FULL_GRAPH_EDGES filters the target ('b') on REFERENCEABLE_LABELS (SYMBOL_LABELS + External)", async () => {
    const client = makeFakeClient();
    await createQueries(client).getFullGraph();

    const edgesQuery = client.calls.find((c) => c.includes('RETURN a, r, b,'));
    expect(edgesQuery).toBeDefined();

    const bMatches = [...(edgesQuery ?? '').matchAll(/b:([A-Za-z]+)/g)].map((m) => m[1]);
    expect(new Set(bMatches)).toEqual(new Set(REFERENCEABLE_LABELS));
  });
});

describe('fileTree.ts getIndexSummary label set', () => {
  it('filters on exactly SUMMARY_LABELS', async () => {
    const client = makeFakeClient();
    await getIndexSummary(client);

    const summaryQuery = client.calls.find((c) => c.includes('MATCH (n)'));
    expect(summaryQuery).toBeDefined();

    const matches = [...(summaryQuery ?? '').matchAll(/n:([A-Za-z]+)/g)].map((m) => m[1]);
    expect(new Set(matches)).toEqual(new Set(SUMMARY_LABELS));
  });
});

describe('operations.ts searchByVector nodeType allowlist', () => {
  it('accepts every SYMBOL_LABELS value without throwing', async () => {
    const client = makeFakeClient();
    const ops = createOperations(client);

    for (const label of SYMBOL_LABELS) {
      await expect(ops.searchByVector(label, [0.1, 0.2])).resolves.toBeDefined();
    }
  });

  it('rejects a label outside SYMBOL_LABELS (e.g. Entity, TypeRef, External)', async () => {
    const client = makeFakeClient();
    const ops = createOperations(client);

    for (const bogus of ['Entity', 'TypeRef', 'External', 'Import']) {
      await expect(
        ops.searchByVector(bogus as never, [0.1, 0.2]),
      ).rejects.toThrow('Invalid node type for vector search');
    }
  });
});

describe('falkordb-shared.ts ensureSchemaImpl label sets', () => {
  function makeFakeGraph() {
    const calls: string[] = [];
    return {
      calls,
      query: vi.fn(async (cypher: string) => {
        calls.push(cypher);
        return { data: [] };
      }),
      roQuery: vi.fn().mockResolvedValue({ data: [] }),
    };
  }

  it('pre-creates a dummy node for exactly ALL_GRAPH_LABELS', async () => {
    const graph = makeFakeGraph();
    await ensureSchemaImpl(graph as never, { embeddingDim: 768 });

    const dummyCreateCall = graph.calls.find((c) => c.includes('__dummy: true'));
    expect(dummyCreateCall).toBeDefined();

    const matches = [...(dummyCreateCall ?? '').matchAll(/CREATE \(:([A-Za-z]+) \{__dummy: true\}\)/g)].map(
      (m) => m[1],
    );
    expect(new Set(matches)).toEqual(new Set(ALL_GRAPH_LABELS));
  });

  it('creates provenance indexes for exactly EMBEDDABLE_LABELS', async () => {
    const graph = makeFakeGraph();
    await ensureSchemaImpl(graph as never, { embeddingDim: 768 });

    const provenanceCalls = graph.calls.filter((c) => c.includes('sourcePipeline'));
    const labelsWithProvenance = provenanceCalls.map((c) => {
      const match = /CREATE INDEX FOR \(n:([A-Za-z]+)\)/.exec(c);
      return match?.[1];
    });
    expect(new Set(labelsWithProvenance)).toEqual(new Set(EMBEDDABLE_LABELS));
  });

  it('creates vector indexes for exactly EMBEDDABLE_LABELS', async () => {
    const graph = makeFakeGraph();
    await ensureSchemaImpl(graph as never, { embeddingDim: 768 });

    // Excludes the separate RELATES_TO edge vector index (CREATE VECTOR INDEX
    // FOR ()-[r:RELATES_TO]-() ...), which isn't a per-label node index.
    const vectorCalls = graph.calls.filter((c) => c.includes('CREATE VECTOR INDEX FOR (n:'));
    const labelsWithVectorIndex = vectorCalls.map((c) => {
      const match = /CREATE VECTOR INDEX FOR \(n:([A-Za-z]+)\)/.exec(c);
      return match?.[1];
    });
    expect(new Set(labelsWithVectorIndex)).toEqual(new Set(EMBEDDABLE_LABELS));
  });
});
