import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type GraphClient } from '../client';
import { createQueries, type GraphQueries } from '../queries';
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
        name: 'a', filePath: '/x/a.ts', startLine: 1,
        embedding: [0.1, 0.2], embeddingTextHash: 'hash-a'
      })
      CREATE (b:Function {name: 'b', filePath: '/x/b.ts', startLine: 1})
      CREATE (c:Function {name: 'c', filePath: '/x/c.ts', startLine: 1})
      CREATE (a)-[:CALLS {
        embedding: [0.5, 0.6], embeddingTextHash: 'hash-edge'
      }]->(b)
      CREATE (b)-[:CALLS]->(c)
      CREATE (c)-[:CALLS]->(a)
      CREATE (a)-[:USES_TYPE]->(c)
    `);
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

  it('projects embedding fields out of dashboard graph nodes', async () => {
    const result = await queries.getFullGraph(3);
    const nodeA = result.nodes.find((node) => node.displayName === 'a');

    expect(nodeA?.data).not.toHaveProperty('embedding');
    expect(nodeA?.data).not.toHaveProperty('embeddingTextHash');
    for (const edge of result.edges) {
      expect(JSON.stringify(edge.data)).not.toContain('"embedding"');
      expect(JSON.stringify(edge.data)).not.toContain('"embeddingTextHash"');
    }
  });

  it('includes Entity nodes and ABOUT plus RELATES_TO edges using Entity identity', async () => {
    await client.query(`
      MATCH (a:Function {name: 'a'})
      CREATE (decision:Entity {
        text: 'Retry policy', type: 'Decision',
        embedding: [0.3, 0.4], embeddingTextHash: 'hash-decision'
      })
      CREATE (person:Entity {text: 'Randy', type: 'Person'})
      CREATE (decision)-[:ABOUT]->(a)
      CREATE (person)-[:RELATES_TO {type: 'AUTHORED'}]->(decision)
    `);

    const result = await queries.getFullGraph(10);
    const decision = result.nodes.find((node) => node.displayName === 'Retry policy');
    const edgeLabels = new Set(result.edges.map((edge) => edge.label));

    expect(decision).toMatchObject({
      id: 'Entity:Decision:Retry policy',
      label: 'Entity',
      displayName: 'Retry policy',
    });
    expect(decision?.data).not.toHaveProperty('embedding');
    expect(decision?.data).not.toHaveProperty('embeddingTextHash');
    expect(edgeLabels).toContain('ABOUT');
    expect(edgeLabels).toContain('RELATES_TO');
  });

  it('returns categorized File relationships for the dashboard side panel', async () => {
    await client.query(`
      CREATE (main:File {filePath: '/x/main.ts', name: 'main.ts'})
      CREATE (dep:File {filePath: '/x/dep.ts', name: 'dep.ts'})
      CREATE (importer:File {filePath: '/x/importer.ts', name: 'importer.ts'})
      CREATE (run:Function {name: 'run', filePath: '/x/main.ts', startLine: 5})
      CREATE (knowledge:Entity {
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
      id: 'Entity:Decision:Main entry point',
      label: 'Entity',
      displayName: 'Main entry point',
    });
    expect(result.knowledgeEntities[0]?.data).not.toHaveProperty('embedding');
    expect(result.knowledgeEntities[0]?.data).not.toHaveProperty('embeddingTextHash');
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
      CREATE (fileA:File {name: 'a.ts', filePath: '/x/project/a.ts'})
      CREATE (functionA:Function {name: 'a', filePath: '/x/project/a.ts', startLine: 1})
      CREATE (decisionA:Entity {text: 'PROJECT A DECISION', type: 'Decision'})
      CREATE (projectA)-[:HAS_FILE]->(fileA)
      CREATE (fileA)-[:CONTAINS]->(functionA)
      CREATE (decisionA)-[:ABOUT]->(functionA)

      CREATE (projectB:Project {id: 'project-b', rootPath: '/x/other'})
      CREATE (fileB:File {name: 'b.ts', filePath: '/x/other/b.ts'})
      CREATE (functionB:Function {name: 'b', filePath: '/x/other/b.ts', startLine: 1})
      CREATE (decisionB:Entity {text: 'PROJECT B DECISION', type: 'Decision'})
      CREATE (personB:Entity {text: 'PROJECT B PERSON', type: 'Person'})
      CREATE (projectB)-[:HAS_FILE]->(fileB)
      CREATE (fileB)-[:CONTAINS]->(functionB)
      CREATE (decisionB)-[:ABOUT]->(functionB)
      CREATE (personB)-[:RELATES_TO]->(decisionB)

      CREATE (boundaryFile:File {name: 'extra.ts', filePath: '/x/project-extra/extra.ts'})
      CREATE (boundaryFunction:Function {
        name: 'extra', filePath: '/x/project-extra/extra.ts', startLine: 1
      })
      CREATE (boundaryDecision:Entity {text: 'PROJECT EXTRA DECISION', type: 'Decision'})
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
