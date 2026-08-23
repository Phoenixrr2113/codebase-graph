import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createClient, type GraphClient } from '../client';
import { createQueries, type GraphQueries } from '../queries';
import { createOperations } from '../operations';
import { resolveEmbeddedBinaryPaths } from '../drivers/falkordblite';

const describeIfAvailable = resolveEmbeddedBinaryPaths() ? describe : describe.skip;

describeIfAvailable('graph window frozen contract', () => {
  let client: GraphClient;
  let queries: GraphQueries;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join('/tmp', 'cgwc-'));
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: 'graph-window-contract',
    } as never);
    queries = createQueries(client);

    await client.query(`
      CREATE (hub:File {id: 'File:/repo/app/hub.ts', name: 'hub.ts', filePath: '/repo/app/hub.ts', embedding: [0.1]})
      CREATE (leaf:File {id: 'File:/repo/app/leaf.ts', name: 'leaf.ts', filePath: '/repo/app/leaf.ts'})
      CREATE (spare:File {id: 'File:/repo/app/spare.ts', name: 'spare.ts', filePath: '/repo/app/spare.ts'})
      CREATE (empty:File {id: 'File:/repo/app/empty.ts', name: 'empty.ts', filePath: '/repo/app/empty.ts'})
      CREATE (sibling:File {id: 'File:/repo/application/sibling.ts', name: 'sibling.ts', filePath: '/repo/application/sibling.ts'})
      CREATE (other:File {id: 'File:/repo/other/other.ts', name: 'other.ts', filePath: '/repo/other/other.ts'})

      CREATE (hubSymbol:Function {id: 'sym:v1:1111111111111111111111111111111111111111111111111111111111111111', name: 'hub', filePath: '/repo/app/hub.ts', embedding: [0.3]})
      CREATE (leafSymbol:Function {id: 'sym:v1:2222222222222222222222222222222222222222222222222222222222222222', name: 'leaf', filePath: '/repo/app/leaf.ts'})
      CREATE (spareSymbol:Function {id: 'sym:v1:3333333333333333333333333333333333333333333333333333333333333333', name: 'spare', filePath: '/repo/app/spare.ts'})
      CREATE (siblingSymbol:Function {id: 'sym:v1:4444444444444444444444444444444444444444444444444444444444444444', name: 'sibling', filePath: '/repo/application/sibling.ts'})
      CREATE (otherSymbol:Function {id: 'sym:v1:5555555555555555555555555555555555555555555555555555555555555555', name: 'other', filePath: '/repo/other/other.ts'})
      CREATE (decision:Entity {id: 'entity:v1:hub-decision', text: 'Hub decision', type: 'Decision', embeddingTextHash: 'decision-hash'})

      CREATE (hub)-[:CONTAINS]->(hubSymbol)
      CREATE (leaf)-[:CONTAINS]->(leafSymbol)
      CREATE (spare)-[:CONTAINS]->(spareSymbol)
      CREATE (sibling)-[:CONTAINS]->(siblingSymbol)
      CREATE (other)-[:CONTAINS]->(otherSymbol)
      CREATE (hub)-[:IMPORTS {embedding: [0.2], embeddingTextHash: 'imports-hash'}]->(leaf)
      CREATE (hub)-[:IMPORTS]->(spare)
      CREATE (other)-[:IMPORTS]->(hub)
      CREATE (sibling)-[:IMPORTS]->(other)
      CREATE (decision)-[:ABOUT]->(hubSymbol)
      CREATE (hubSymbol)-[:CALLS {embedding: [0.4]}]->(leafSymbol)
      CREATE (hubSymbol)-[:CALLS]->(spareSymbol)
    `);
    await createOperations(client).recomputeGraphDegrees();
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it('uses persisted global degree with scoped totals for the full graph window', async () => {
    const result = await queries.getFullGraph(2, '/repo/app/', 0);
    const nodeIds = new Set(result.nodes.map((node) => node.id));

    expect(result.nodes[0]?.id).toBe('File:/repo/app/hub.ts');
    expect(result.degreeScope).toBe('global');
    expect(result).toMatchObject({
      totalNodes: 8,
      totalEdges: 8,
      windowOrder: 'degree-desc,id-asc',
      offset: 0,
      limit: 2,
      returned: 2,
      hasMore: true,
      nextOffset: 2,
      truncated: true,
    });
    expect(JSON.stringify(result)).not.toContain('/repo/application');
    for (const edge of result.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });

  it('returns a scoped file graph ordered by induced import degree with honest totals', async () => {
    const result = await queries.getFileGraph(2, '/repo/app', 0);

    expect(result).toEqual({
      nodes: [
        {
          id: 'File:/repo/app/hub.ts',
          displayName: 'hub.ts',
          filePath: '/repo/app/hub.ts',
          symbolCount: 1,
          label: 'File',
        },
        {
          id: 'File:/repo/app/leaf.ts',
          displayName: 'leaf.ts',
          filePath: '/repo/app/leaf.ts',
          symbolCount: 1,
          label: 'File',
        },
      ],
      edges: [
        expect.objectContaining({
          source: 'File:/repo/app/hub.ts',
          target: 'File:/repo/app/leaf.ts',
          label: 'IMPORTS',
        }),
      ],
      totalNodes: 4,
      totalEdges: 2,
      windowOrder: 'degree-desc,id-asc',
      offset: 0,
      limit: 2,
      returned: 2,
      hasMore: true,
      nextOffset: 2,
      truncated: true,
    });
    expect(result.nodes.every((node) => !('data' in node))).toBe(true);
    expect(JSON.stringify(result)).not.toContain('/repo/application');
  });

  it('walks full graph pages without duplicates or gaps relative to one large window', async () => {
    const first = await queries.getFullGraph(2, '/repo/app', 0);
    const second = await queries.getFullGraph(2, '/repo/app', first.nextOffset ?? 0);
    const combined = await queries.getFullGraph(4, '/repo/app', 0);

    expect([...first.nodes, ...second.nodes].map((node) => node.id)).toEqual(
      combined.nodes.map((node) => node.id),
    );
    expect(new Set([...first.nodes, ...second.nodes].map((node) => node.id)).size).toBe(4);
    expect(second).toMatchObject({ offset: 2, limit: 2, returned: 2, hasMore: true, nextOffset: 4 });
  });

  it('walks file graph pages without duplicates or gaps relative to one large window', async () => {
    const first = await queries.getFileGraph(2, '/repo/app', 0);
    const second = await queries.getFileGraph(2, '/repo/app', first.nextOffset ?? 0);
    const combined = await queries.getFileGraph(4, '/repo/app', 0);

    expect([...first.nodes, ...second.nodes].map((node) => node.id)).toEqual(
      combined.nodes.map((node) => node.id),
    );
    expect(new Set([...first.nodes, ...second.nodes].map((node) => node.id)).size).toBe(4);
  });

  it('returns empty pages beyond the total with honest totals and terminal metadata', async () => {
    const full = await queries.getFullGraph(2, '/repo/app', 100);
    const files = await queries.getFileGraph(2, '/repo/app', 100);

    expect(full).toMatchObject({
      nodes: [],
      edges: [],
      totalNodes: 8,
      totalEdges: 8,
      offset: 100,
      limit: 2,
      returned: 0,
      hasMore: false,
      nextOffset: null,
    });
    expect(files).toMatchObject({
      nodes: [],
      edges: [],
      totalNodes: 4,
      totalEdges: 2,
      offset: 100,
      limit: 2,
      returned: 0,
      hasMore: false,
      nextOffset: null,
    });
  });

  it('returns induced edges for persisted ids while ignoring unknown and out-of-scope ids', async () => {
    const edges = await queries.getInducedEdges([
      'File:/repo/app/hub.ts',
      'File:/repo/app/leaf.ts',
      'File:/repo/other/other.ts',
      'File:/repo/app/missing.ts',
    ], '/repo/app');

    expect(edges).toEqual([{
      source: 'File:/repo/app/hub.ts',
      target: 'File:/repo/app/leaf.ts',
      label: 'IMPORTS',
    }]);
    expect(JSON.stringify(edges)).not.toContain('embedding');
  });

  it('reports zero symbols for a scoped File without contained symbols', async () => {
    const result = await queries.getFileGraph(10, '/repo/app');

    expect(result.nodes.find((node) => node.id === 'File:/repo/app/empty.ts')).toEqual({
      id: 'File:/repo/app/empty.ts',
      displayName: 'empty.ts',
      filePath: '/repo/app/empty.ts',
      symbolCount: 0,
      label: 'File',
    });
  });

  it('bounds incoming and outgoing neighbors independently and returns induced closure', async () => {
    const result = await queries.getNodeNeighbors(
      'sym:v1:1111111111111111111111111111111111111111111111111111111111111111',
      1,
    );

    expect(result).toMatchObject({
      centerId: 'sym:v1:1111111111111111111111111111111111111111111111111111111111111111',
      nodes: [
        expect.objectContaining({ id: 'sym:v1:1111111111111111111111111111111111111111111111111111111111111111' }),
        expect.objectContaining({ id: 'File:/repo/app/hub.ts' }),
        expect.objectContaining({ id: 'sym:v1:2222222222222222222222222222222222222222222222222222222222222222' }),
      ],
      incomingTruncated: true,
      outgoingTruncated: true,
      limit: 1,
    });

    const graph = result as { nodes: Array<{ id: string }>; edges: Array<{ source: string; target: string }> };
    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    expect(graph.edges).toHaveLength(2);
    for (const edge of graph.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
    expect(JSON.stringify(result)).not.toContain('embedding');
  });

  it('includes contained symbols and import relationships for a File id', async () => {
    const result = await queries.getNodeNeighbors('File:/repo/app/hub.ts', 10);

    const nodeIds = (result as { nodes?: Array<{ id: string }> } | undefined)?.nodes?.map((node) => node.id);
    expect(nodeIds).toEqual(expect.arrayContaining([
      'sym:v1:1111111111111111111111111111111111111111111111111111111111111111',
      'File:/repo/app/leaf.ts',
      'File:/repo/app/spare.ts',
    ]));
  });

  it('returns no neighbor result for an unknown persisted id', async () => {
    const result = await queries.getNodeNeighbors('File:/repo/app/missing.ts', 10);

    expect(result).toBeUndefined();
  });
});

describeIfAvailable('file graph external visibility contract', () => {
  let client: GraphClient;
  let queries: GraphQueries;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join('/tmp', 'cgwc-externals-'));
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: 'file-graph-externals',
    } as never);
    queries = createQueries(client);

    await client.query(`
      CREATE (a:File {name: 'a.ts', filePath: '/repo/app/a.ts'})
      CREATE (b:File {name: 'b.ts', filePath: '/repo/app/b.ts'})
      CREATE (c:File {name: 'c.ts', filePath: '/repo/app/c.ts'})
      CREATE (externalA:File:External {name: 'pkg-a', filePath: 'external:pkg-a'})
      CREATE (externalB:File:External {name: 'pkg-b', filePath: 'external:pkg-b'})
      CREATE (a)-[:IMPORTS]->(b)
      CREATE (a)-[:IMPORTS]->(externalA)
      CREATE (externalA)-[:IMPORTS]->(b)
      CREATE (externalA)-[:IMPORTS]->(externalB)
    `);
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it('filters external Files before totals, induced degree, ordering, and edge selection', async () => {
    const included = await queries.getFileGraph(10, undefined, 0, true);
    const excluded = await queries.getFileGraph(10, undefined, 0, false);

    expect(included).toMatchObject({ totalNodes: 5, totalEdges: 4 });
    expect(excluded.nodes.map((node) => node.id)).toEqual([
      'File:/repo/app/a.ts',
      'File:/repo/app/b.ts',
      'File:/repo/app/c.ts',
    ]);
    expect(excluded).toMatchObject({ totalNodes: 3, totalEdges: 1 });
    expect(excluded.edges).toEqual([
      expect.objectContaining({
        source: 'File:/repo/app/a.ts',
        target: 'File:/repo/app/b.ts',
        label: 'IMPORTS',
      }),
    ]);
  });

  it('keeps external-free pages deterministic with exact totals and no gaps', async () => {
    const first = await queries.getFileGraph(2, undefined, 0, false);
    const second = await queries.getFileGraph(2, undefined, first.nextOffset ?? 0, false);
    const combined = await queries.getFileGraph(3, undefined, 0, false);

    expect([...first.nodes, ...second.nodes].map((node) => node.id)).toEqual(
      combined.nodes.map((node) => node.id),
    );
    expect(first).toMatchObject({
      totalNodes: 3,
      totalEdges: 1,
      offset: 0,
      returned: 2,
      hasMore: true,
      nextOffset: 2,
    });
    expect(second).toMatchObject({
      totalNodes: 3,
      totalEdges: 1,
      offset: 2,
      returned: 1,
      hasMore: false,
      nextOffset: null,
    });
  });
});
