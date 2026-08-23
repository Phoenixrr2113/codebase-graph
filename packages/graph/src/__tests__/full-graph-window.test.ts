import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type GraphClient } from '../client';
import { createQueries, type GraphQueries } from '../queries';
import { createOperations } from '../operations';
import { resolveEmbeddedBinaryPaths } from '../drivers/falkordblite';
import type { GraphNode } from '@codegraph/types';

const describeIfAvailable = resolveEmbeddedBinaryPaths() ? describe : describe.skip;

describeIfAvailable('dashboard full-graph window', () => {
  let client: GraphClient;
  let queries: GraphQueries;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'cg-full-graph-'));
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: 'full-graph-window',
    } as never);
    queries = createQueries(client);

    await client.query(`
      CREATE (a:Function {
        id: 'sym:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        name: 'a', filePath: '/x/a.ts', startLine: 1,
        embedding: [0.1, 0.2], embeddingTextHash: 'hash-a'
      })
      CREATE (b:Function {id: 'sym:v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', name: 'b', filePath: '/x/b.ts', startLine: 1})
      CREATE (c:Function {id: 'sym:v1:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', name: 'c', filePath: '/x/c.ts', startLine: 1})
      CREATE (a)-[:CALLS {
        embedding: [0.5, 0.6], embeddingTextHash: 'hash-edge'
      }]->(b)
      CREATE (b)-[:CALLS]->(c)
      CREATE (c)-[:CALLS]->(a)
      CREATE (a)-[:USES_TYPE]->(c)
    `);
    await createOperations(client).recomputeGraphDegrees();
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it('returns every edge induced by the bounded node set with no missing endpoints', async () => {
    const result = await queries.getFullGraph(3);
    const nodeIds = new Set(result.nodes.map((node) => node.id));

    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(4);
    for (const edge of result.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
    }
  });

  it('orders a truncated window by degree with honest full-graph totals', async () => {
    const result = await queries.getFullGraph(2);

    expect(result.nodes.map((node) => node.displayName)).toEqual(['a', 'c']);
    expect(result.edges).toHaveLength(2);
    expect(result).toMatchObject({
      totalNodes: 3,
      totalEdges: 4,
      windowOrder: 'degree-desc,id-asc',
      truncated: true,
    });
  });

  it('returns the persisted opaque symbol id as the graph node id', async () => {
    const result = await queries.getFullGraph(3);
    const nodeA = result.nodes.find((node) => node.displayName === 'a');

    expect(nodeA?.id).toBe('sym:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  it('projects embedding fields and legacy data out of serialized graph nodes', async () => {
    const result = await queries.getFullGraph(3);
    const nodeA = result.nodes.find((node) => node.displayName === 'a');

    expect(nodeA?.data.path).toBe('/x/a.ts');
    expect(JSON.parse(JSON.stringify(nodeA))).not.toHaveProperty('data');
    for (const edge of result.edges) {
      expect(JSON.stringify(edge.data)).not.toContain('"embedding"');
      expect(JSON.stringify(edge.data)).not.toContain('"embeddingTextHash"');
    }
  });

  it('returns only the canvas node projection with persisted degree', async () => {
    await client.query(`
      MATCH (n)
      WHERE n:Function AND n.filePath STARTS WITH '/x/'
      OPTIONAL MATCH (n)-[r]-()
      WITH n, count(r) AS degree
      SET n.degree = degree
    `);

    const result = await queries.getFullGraph(3);

    expect(result.nodes[0]).toEqual({
      id: 'sym:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      label: 'Function',
      displayName: 'a',
      filePath: '/x/a.ts',
      startLine: 1,
      degree: 3,
    });
    expect(result).toMatchObject({ degreeScope: 'global' });
  });

  it('includes Entity nodes and ABOUT plus RELATES_TO edges using Entity identity', async () => {
    await client.query(`
      MATCH (a:Function {name: 'a'})
      CREATE (decision:Entity {
        id: 'entity:v1:retry-policy',
        text: 'Retry policy', type: 'Decision',
        embedding: [0.3, 0.4], embeddingTextHash: 'hash-decision'
      })
      CREATE (person:Entity {id: 'entity:v1:randy', text: 'Randy', type: 'Person'})
      CREATE (decision)-[:ABOUT]->(a)
      CREATE (person)-[:RELATES_TO {type: 'AUTHORED'}]->(decision)
    `);

    const result = await queries.getFullGraph(10);
    const decision = result.nodes.find((node) => node.displayName === 'Retry policy');
    const edgeLabels = new Set(result.edges.map((edge) => edge.label));

    expect(decision).toMatchObject({
      id: 'entity:v1:retry-policy',
      label: 'Entity',
      displayName: 'Retry policy',
    });
    expect(JSON.parse(JSON.stringify(decision))).not.toHaveProperty('data');
    expect(edgeLabels).toContain('ABOUT');
    expect(edgeLabels).toContain('RELATES_TO');
  });

  it('returns categorized File relationships for the dashboard side panel', async () => {
    await client.query(`
      CREATE (main:File {id: 'file:v1:main', filePath: '/x/main.ts', name: 'main.ts'})
      CREATE (dep:File {id: 'file:v1:dep', filePath: '/x/dep.ts', name: 'dep.ts'})
      CREATE (importer:File {id: 'file:v1:importer', filePath: '/x/importer.ts', name: 'importer.ts'})
      CREATE (run:Function {id: 'sym:v1:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', name: 'run', filePath: '/x/main.ts', startLine: 5})
      CREATE (knowledge:Entity {
        id: 'entity:v1:main-entry-point',
        text: 'Main entry point', type: 'Decision',
        embedding: [0.8, 0.9], embeddingTextHash: 'hash-knowledge'
      })
      CREATE (main)-[:CONTAINS]->(run)
      CREATE (main)-[:IMPORTS]->(dep)
      CREATE (importer)-[:IMPORTS]->(main)
      CREATE (knowledge)-[:ABOUT]->(run)
    `);

    const fileQueries = queries as unknown as {
      getFileRelationships(filePath: string, limit?: number): Promise<{
        filePath: string;
        containedSymbols: GraphNode[];
        imports: GraphNode[];
        importers: GraphNode[];
        knowledgeEntities: GraphNode[];
      }>;
    };
    const result = await fileQueries.getFileRelationships('/x/main.ts', 50);

    expect(result.filePath).toBe('/x/main.ts');
    expect(result.containedSymbols.map((node) => node.displayName)).toEqual(['run']);
    expect(result.imports.map((node) => node.filePath)).toEqual(['/x/dep.ts']);
    expect(result.importers.map((node) => node.filePath)).toEqual(['/x/importer.ts']);
    expect(result.knowledgeEntities[0]).toMatchObject({
      id: 'entity:v1:main-entry-point',
      label: 'Entity',
      displayName: 'Main entry point',
    });
    expect(result.knowledgeEntities[0]?.data).not.toHaveProperty('embedding');
    expect(result.knowledgeEntities[0]?.data).not.toHaveProperty('embeddingTextHash');
  });

  it('reports true per-collection File relationship totals and truncation', async () => {
    await client.query(`
      MATCH (main:File {filePath: '/x/main.ts'})
      CREATE (extra1:Function {id: 'sym:v1:1313131313131313131313131313131313131313131313131313131313131313', name: 'extra1', filePath: '/x/main.ts', startLine: 8})
      CREATE (extra2:Function {id: 'sym:v1:1414141414141414141414141414141414141414141414141414141414141414', name: 'extra2', filePath: '/x/main.ts', startLine: 9})
      CREATE (main)-[:CONTAINS]->(extra1)
      CREATE (main)-[:CONTAINS]->(extra2)
    `);

    const result = await queries.getFileRelationships('/x/main.ts', 1);

    expect(result.totals).toEqual({
      containedSymbols: 3,
      imports: 1,
      importers: 1,
      knowledgeEntities: 1,
    });
    expect(result.truncated).toEqual({
      containedSymbols: true,
      imports: false,
      importers: false,
      knowledgeEntities: false,
    });
    expect(result.limit).toBe(1);
  });

  it('returns persisted ids from dependency and file subgraph reads', async () => {
    await client.query(`
      CREATE (entry:File {id: 'file:v1:entry', filePath: '/deps/entry.ts', name: 'entry.ts'})
      CREATE (dependency:File {id: 'file:v1:dependency', filePath: '/deps/dependency.ts', name: 'dependency.ts'})
      CREATE (symbol:Function {id: 'sym:v1:1212121212121212121212121212121212121212121212121212121212121212', name: 'entry', filePath: '/deps/entry.ts', startLine: 3})
      CREATE (entry)-[:IMPORTS]->(dependency)
      CREATE (entry)-[:CONTAINS]->(symbol)
    `);

    const dependencies = await queries.getDependencyTree('/deps/entry.ts', 1);
    const subgraph = await queries.getFileSubgraph('/deps/entry.ts');

    expect(new Set(dependencies.nodes.map((node) => node.id))).toEqual(
      new Set(['File:/deps/entry.ts', 'File:/deps/dependency.ts']),
    );
    expect(subgraph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([
        'File:/deps/entry.ts',
        'sym:v1:1212121212121212121212121212121212121212121212121212121212121212',
      ]),
    );
  });
});

describeIfAvailable('full graph unique window selection', () => {
  let client: GraphClient;
  let queries: GraphQueries;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'cg-full-unique-'));
    client = await createClient({ driver: 'falkordblite', databasePath: dataDir, graphName: 'full-unique' } as never);
    queries = createQueries(client);
    await client.query(`
      CREATE (:File {filePath: '/repo/a.ts', name: 'a.ts', degree: 10})
      CREATE (:File:External {filePath: '/repo/a.ts', degree: 9})
      CREATE (:File {filePath: '/repo/b.ts', name: 'b.ts', degree: 8})
      CREATE (:File {filePath: '/repo/c.ts', name: 'c.ts', degree: 7})
      CREATE (:File:External {filePath: 'external:only-package', degree: 6})
    `);
  });

  afterAll(async () => {
    await client?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it('deduplicates stable File ids in Cypher before applying the limit', async () => {
    const result = await queries.getFullGraph(3, '/repo');

    expect(result.nodes.map((node) => node.id)).toEqual([
      'File:/repo/a.ts',
      'File:/repo/b.ts',
      'File:/repo/c.ts',
    ]);
    expect(result.nodes).toHaveLength(3);
    expect(result.totalNodes).toBe(3);
  });

  it('deduplicates file graph ids before paging and counting totals', async () => {
    const first = await queries.getFileGraph(2, '/repo', 0);
    const second = await queries.getFileGraph(2, '/repo', first.nextOffset ?? 0);
    const combined = await queries.getFileGraph(3, '/repo', 0);

    expect([...first.nodes, ...second.nodes].map((node) => node.id)).toEqual(
      combined.nodes.map((node) => node.id),
    );
    expect(combined.nodes.map((node) => node.id)).toEqual([
      'File:/repo/a.ts',
      'File:/repo/b.ts',
      'File:/repo/c.ts',
    ]);
    expect(combined.totalNodes).toBe(3);
  });

  it('keeps an external-only File by default and excludes it before totals when requested', async () => {
    const included = await queries.getFileGraph(10);
    const excluded = await queries.getFileGraph(10, undefined, 0, false);

    expect(included.nodes.map((node) => node.id)).toContain('File:external:only-package');
    expect(included.totalNodes).toBe(4);
    expect(excluded.nodes.map((node) => node.id)).not.toContain('File:external:only-package');
    expect(excluded.totalNodes).toBe(3);
  });
});

describeIfAvailable('project-scoped dashboard full graph', () => {
  let client: GraphClient;
  let queries: GraphQueries;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'cg-project-graph-'));
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: 'project-scoped-full-graph',
    } as never);
    queries = createQueries(client);

    await client.query(`
      CREATE (projectA:Project {id: 'project-a', rootPath: '/x/project'})
      CREATE (fileA:File {id: 'file:v1:project-a', name: 'a.ts', filePath: '/x/project/a.ts'})
      CREATE (functionA:Function {id: 'sym:v1:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', name: 'a', filePath: '/x/project/a.ts', startLine: 1})
      CREATE (decisionA:Entity {id: 'entity:v1:project-a-decision', text: 'PROJECT A DECISION', type: 'Decision'})
      CREATE (projectA)-[:HAS_FILE]->(fileA)
      CREATE (fileA)-[:CONTAINS]->(functionA)
      CREATE (decisionA)-[:ABOUT]->(functionA)

      CREATE (projectB:Project {id: 'project-b', rootPath: '/x/other'})
      CREATE (fileB:File {id: 'file:v1:project-b', name: 'b.ts', filePath: '/x/other/b.ts'})
      CREATE (functionB:Function {id: 'sym:v1:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', name: 'b', filePath: '/x/other/b.ts', startLine: 1})
      CREATE (decisionB:Entity {id: 'entity:v1:project-b-decision', text: 'PROJECT B DECISION', type: 'Decision'})
      CREATE (personB:Entity {id: 'entity:v1:project-b-person', text: 'PROJECT B PERSON', type: 'Person'})
      CREATE (projectB)-[:HAS_FILE]->(fileB)
      CREATE (fileB)-[:CONTAINS]->(functionB)
      CREATE (decisionB)-[:ABOUT]->(functionB)
      CREATE (personB)-[:RELATES_TO]->(decisionB)

      CREATE (boundaryFile:File {id: 'file:v1:boundary', name: 'extra.ts', filePath: '/x/project-extra/extra.ts'})
      CREATE (boundaryFunction:Function {
        id: 'sym:v1:9999999999999999999999999999999999999999999999999999999999999999',
        name: 'extra', filePath: '/x/project-extra/extra.ts', startLine: 1
      })
      CREATE (boundaryDecision:Entity {id: 'entity:v1:boundary-decision', text: 'PROJECT EXTRA DECISION', type: 'Decision'})
      CREATE (boundaryFile)-[:CONTAINS]->(boundaryFunction)
      CREATE (boundaryDecision)-[:ABOUT]->(boundaryFunction)
    `);
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it('includes only Entities connected to the selected project while unscoped calls include all Entities', async () => {
    const projectA = await queries.getFullGraph(100, '/x/project');
    const projectB = await queries.getFullGraph(100, '/x/other');
    const unscoped = await queries.getFullGraph(100);

    expect(projectA.nodes.map((node) => node.displayName)).toContain('PROJECT A DECISION');
    expect(projectA.nodes.map((node) => node.displayName)).not.toContain('PROJECT B DECISION');
    expect(projectA.nodes.map((node) => node.displayName)).not.toContain('PROJECT B PERSON');
    expect(projectB.nodes.map((node) => node.displayName)).toEqual(
      expect.arrayContaining(['PROJECT B DECISION', 'PROJECT B PERSON']),
    );
    expect(unscoped.nodes.map((node) => node.displayName)).toEqual(
      expect.arrayContaining(['PROJECT A DECISION', 'PROJECT B DECISION', 'PROJECT B PERSON']),
    );

    for (const graph of [projectA, projectB]) {
      const nodeIds = new Set(graph.nodes.map((node) => node.id));
      for (const edge of graph.edges) {
        expect(nodeIds.has(edge.source)).toBe(true);
        expect(nodeIds.has(edge.target)).toBe(true);
      }
    }
  });

  it('does not treat a sibling directory with the same prefix as part of the scoped root', async () => {
    const result = await queries.getFullGraph(100, '/x/project');
    const displayNames = result.nodes.map((node) => node.displayName);

    expect(displayNames).not.toContain('extra');
    expect(displayNames).not.toContain('PROJECT EXTRA DECISION');
  });
});
