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
      CREATE (target:Function {id: 'sym:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', name: 'parseInput', filePath: '/x/lib.ts', startLine: 10})
      CREATE (localCaller:Function {id: 'sym:v1:1111111111111111111111111111111111111111111111111111111111111111', name: 'helper', filePath: '/x/lib.ts', startLine: 40})
      CREATE (remoteCaller:Function {id: 'sym:v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', name: 'handler', filePath: '/x/a.ts', startLine: 5})
      CREATE (subclass:Class {id: 'sym:v1:2222222222222222222222222222222222222222222222222222222222222222', name: 'Derived', filePath: '/x/b.ts', startLine: 3})
      CREATE (unrelated:Function {id: 'sym:v1:3333333333333333333333333333333333333333333333333333333333333333', name: 'elsewhere', filePath: '/x/b.ts', startLine: 60})
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
    const result = await queries.getSymbolReferences({ id: 'sym:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });

    expect(result.references).toHaveLength(3);
    expect(new Set(result.references.map((r) => r.edgeType))).toEqual(new Set(['CALLS', 'EXTENDS']));

    const byName = new Map(result.references.map((r) => [r.name, r]));
    expect(byName.get('helper')?.sameFile).toBe(true);
    expect(byName.get('handler')?.sameFile).toBe(false);
    expect(byName.get('Derived')?.sameFile).toBe(false);
    expect(byName.get('Derived')?.edgeType).toBe('EXTENDS');
  });

  it('lists the other files a symbol is used from', async () => {
    const result = await queries.getSymbolReferences({ id: 'sym:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    expect(new Set(result.referencingFiles)).toEqual(new Set(['/x/a.ts', '/x/b.ts']));
  });

  it('carries the location needed to open the referencing code', async () => {
    const result = await queries.getSymbolReferences({ id: 'sym:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    const handler = result.references.find((r) => r.name === 'handler');
    expect(handler?.filePath).toBe('/x/a.ts');
    expect(handler?.startLine).toBe(5);
    expect(handler?.nodeType).toBe('Function');
  });

  it('accepts a persisted target id and returns persisted source ids', async () => {
    const result = await queries.getSymbolReferences({
      id: 'sym:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    const handler = result.references.find((reference) => reference.name === 'handler');

    expect(handler?.id).toBe('sym:v1:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  });

  it('reports nothing for a symbol no one uses', async () => {
    const result = await queries.getSymbolReferences({ id: 'sym:v1:3333333333333333333333333333333333333333333333333333333333333333' });
    expect(result.references).toEqual([]);
    expect(result.referencingFiles).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it('reports nothing for a name that is not in the graph', async () => {
    const result = await queries.getSymbolReferences({ id: 'sym:v1:0000000000000000000000000000000000000000000000000000000000000000' });
    expect(result.references).toEqual([]);
  });

  it('flags truncation instead of silently dropping results', async () => {
    const limited = await queries.getSymbolReferences({ id: 'sym:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', limit: 2 });
    expect(limited.references).toHaveLength(2);
    expect(limited.truncated).toBe(true);

    const full = await queries.getSymbolReferences({ id: 'sym:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', limit: 50 });
    expect(full.truncated).toBe(false);
  });

  it('pins the declaration when a name is used in more than one file', async () => {
    // A second parseInput elsewhere, with its own distinct caller.
    await client.query(`
      MATCH (b:File {filePath: '/x/b.ts'})
      CREATE (other:Function {id: 'sym:v1:4444444444444444444444444444444444444444444444444444444444444444', name: 'parseInput', filePath: '/x/b.ts', startLine: 90})
      CREATE (caller:Function {id: 'sym:v1:5555555555555555555555555555555555555555555555555555555555555555', name: 'onlyForB', filePath: '/x/b.ts', startLine: 95})
      CREATE (b)-[:CONTAINS]->(other)
      CREATE (b)-[:CONTAINS]->(caller)
      CREATE (caller)-[:CALLS]->(other)
    `);

    const scoped = await queries.getSymbolReferences({
      id: 'sym:v1:4444444444444444444444444444444444444444444444444444444444444444',
    });
    expect(scoped.references.map((r) => r.name)).toEqual(['onlyForB']);
  });

  it('judges sameFile per reference when two genuine declarations share a name', async () => {
    // A name collision between two real declarations, each in its own file,
    // each with its own same-file caller. Every codebase has these (every
    // class with a constructor, in this repo three separate `close`
    // functions). sameFile has to be decided per reference, against the
    // specific declaration that reference's edge points at, not against one
    // file picked for the whole name.
    await client.query(`
      CREATE (one:File {filePath: '/x/one.ts', name: 'one.ts'})
      CREATE (two:File {filePath: '/x/two.ts', name: 'two.ts'})
      CREATE (closeOne:Function {id: 'sym:v1:6666666666666666666666666666666666666666666666666666666666666666', name: 'close', filePath: '/x/one.ts', startLine: 5})
      CREATE (closeTwo:Function {id: 'sym:v1:7777777777777777777777777777777777777777777777777777777777777777', name: 'close', filePath: '/x/two.ts', startLine: 8})
      CREATE (callerOne:Function {id: 'sym:v1:8888888888888888888888888888888888888888888888888888888888888888', name: 'callerOne', filePath: '/x/one.ts', startLine: 20})
      CREATE (callerTwo:Function {id: 'sym:v1:9999999999999999999999999999999999999999999999999999999999999999', name: 'callerTwo', filePath: '/x/two.ts', startLine: 30})
      CREATE (one)-[:CONTAINS]->(closeOne)
      CREATE (one)-[:CONTAINS]->(callerOne)
      CREATE (two)-[:CONTAINS]->(closeTwo)
      CREATE (two)-[:CONTAINS]->(callerTwo)
      CREATE (callerOne)-[:CALLS]->(closeOne)
      CREATE (callerTwo)-[:CALLS]->(closeTwo)
    `);

    const first = await queries.getSymbolReferences({ id: 'sym:v1:6666666666666666666666666666666666666666666666666666666666666666' });
    const second = await queries.getSymbolReferences({ id: 'sym:v1:7777777777777777777777777777777777777777777777777777777777777777' });

    expect(first.references.map((reference) => reference.name)).toEqual(['callerOne']);
    expect(second.references.map((reference) => reference.name)).toEqual(['callerTwo']);
    expect(first.references[0]?.sameFile).toBe(true);
    expect(second.references[0]?.sameFile).toBe(true);
  });
});
