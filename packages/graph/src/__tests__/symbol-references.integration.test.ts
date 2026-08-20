/**
 * Symbol references: where a declaration is used.
 *
 * The canvas only holds a window onto the graph, so "what uses this" cannot be
 * read off the rendered neighbourhood. This query answers it from the graph
 * itself, and has to stay cheap on a hub symbol: it is issued on every node
 * selection.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, type GraphClient } from '../client';
import { createQueries, type GraphQueries } from '../queries';
import { resolveEmbeddedBinaryPaths } from '../drivers/falkordblite';

const describeIfAvailable = resolveEmbeddedBinaryPaths() ? describe : describe.skip;

describeIfAvailable('getSymbolReferences', () => {
  let client: GraphClient;
  let queries: GraphQueries;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'cg-refs-'));
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: 'references',
    } as never);
    queries = createQueries(client);

    // target lives in lib.ts and is used from lib.ts and two other files,
    // through three different kinds of edge.
    await client.query(`
      CREATE (lib:File {filePath: '/x/lib.ts', name: 'lib.ts'})
      CREATE (a:File {filePath: '/x/a.ts', name: 'a.ts'})
      CREATE (b:File {filePath: '/x/b.ts', name: 'b.ts'})
      CREATE (target:Function {name: 'parseInput', filePath: '/x/lib.ts', startLine: 10})
      CREATE (localCaller:Function {name: 'helper', filePath: '/x/lib.ts', startLine: 40})
      CREATE (remoteCaller:Function {name: 'handler', filePath: '/x/a.ts', startLine: 5})
      CREATE (subclass:Class {name: 'Derived', filePath: '/x/b.ts', startLine: 3})
      CREATE (unrelated:Function {name: 'elsewhere', filePath: '/x/b.ts', startLine: 60})
      CREATE (lib)-[:CONTAINS]->(target)
      CREATE (lib)-[:CONTAINS]->(localCaller)
      CREATE (a)-[:CONTAINS]->(remoteCaller)
      CREATE (b)-[:CONTAINS]->(subclass)
      CREATE (localCaller)-[:CALLS]->(target)
      CREATE (remoteCaller)-[:CALLS]->(target)
      CREATE (subclass)-[:EXTENDS]->(target)
      CREATE (unrelated)-[:CALLS]->(localCaller)
    `);
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it('finds every kind of use, and says which are in other files', async () => {
    const result = await queries.getSymbolReferences({ name: 'parseInput' });

    expect(result.references).toHaveLength(3);
    expect(new Set(result.references.map((r) => r.edgeType))).toEqual(new Set(['CALLS', 'EXTENDS']));

    const byName = new Map(result.references.map((r) => [r.name, r]));
    expect(byName.get('helper')?.sameFile).toBe(true);
    expect(byName.get('handler')?.sameFile).toBe(false);
    expect(byName.get('Derived')?.sameFile).toBe(false);
    expect(byName.get('Derived')?.edgeType).toBe('EXTENDS');
  });

  it('lists the other files a symbol is used from', async () => {
    const result = await queries.getSymbolReferences({ name: 'parseInput' });
    expect(new Set(result.referencingFiles)).toEqual(new Set(['/x/a.ts', '/x/b.ts']));
  });

  it('carries the location needed to open the referencing code', async () => {
    const result = await queries.getSymbolReferences({ name: 'parseInput' });
    const handler = result.references.find((r) => r.name === 'handler');
    expect(handler?.filePath).toBe('/x/a.ts');
    expect(handler?.startLine).toBe(5);
    expect(handler?.nodeType).toBe('Function');
  });

  it('reports nothing for a symbol no one uses', async () => {
    const result = await queries.getSymbolReferences({ name: 'elsewhere' });
    expect(result.references).toEqual([]);
    expect(result.referencingFiles).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('reports nothing for a name that is not in the graph', async () => {
    const result = await queries.getSymbolReferences({ name: 'noSuchSymbol' });
    expect(result.references).toEqual([]);
  });

  it('flags truncation instead of silently dropping results', async () => {
    const limited = await queries.getSymbolReferences({ name: 'parseInput', limit: 2 });
    expect(limited.references).toHaveLength(2);
    expect(limited.truncated).toBe(true);

    const full = await queries.getSymbolReferences({ name: 'parseInput', limit: 50 });
    expect(full.truncated).toBe(false);
  });

  it('pins the declaration when a name is used in more than one file', async () => {
    // A second parseInput elsewhere, with its own distinct caller.
    await client.query(`
      MATCH (b:File {filePath: '/x/b.ts'})
      CREATE (other:Function {name: 'parseInput', filePath: '/x/b.ts', startLine: 90})
      CREATE (caller:Function {name: 'onlyForB', filePath: '/x/b.ts', startLine: 95})
      CREATE (b)-[:CONTAINS]->(other)
      CREATE (b)-[:CONTAINS]->(caller)
      CREATE (caller)-[:CALLS]->(other)
    `);

    const scoped = await queries.getSymbolReferences({
      name: 'parseInput',
      filePath: '/x/b.ts',
      startLine: 90,
    });
    expect(scoped.references.map((r) => r.name)).toEqual(['onlyForB']);
  });
});
