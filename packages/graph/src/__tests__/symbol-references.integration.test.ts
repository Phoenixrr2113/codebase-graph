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

  it('finds a reference that only lands on a TypeRef proxy for the same name', async () => {
    // Mirrors how the graph is actually built: a type name exists both as a
    // declaration node with a real filePath (Interface/Class/Type/...) and as
    // a separate TypeRef node with filePath left unset, and USES_TYPE edges
    // terminate on the TypeRef, never the declaration. Pinning to a single
    // node by name picks one or the other; if it happens to pick the
    // declaration, the only real reference (through the TypeRef) is missed.
    await client.query(`
      CREATE (c:File {filePath: '/x/config.ts', name: 'config.ts'})
      CREATE (decl:Interface {name: 'WidgetConfig', filePath: '/x/config.ts', startLine: 12})
      CREATE (ref:TypeRef {name: 'WidgetConfig', language: 'typescript', isPrimitive: false})
      CREATE (c)-[:CONTAINS]->(decl)
      CREATE (maker:Function {name: 'makeWidget', filePath: '/x/c.ts', startLine: 8})
      CREATE (maker)-[:USES_TYPE]->(ref)
    `);

    const result = await queries.getSymbolReferences({ name: 'WidgetConfig' });

    expect(result.references.map((r) => r.name)).toEqual(['makeWidget']);
    expect(result.references[0]?.edgeType).toBe('USES_TYPE');
  });

  it('still finds a TypeRef-only reference when filePath/startLine pin the declaration', async () => {
    // The declaration node has a real filePath and startLine; the TypeRef
    // node it shares a name with does not. A caller that supplies the
    // declaration's own filePath/startLine (as the dashboard does when a node
    // is selected) must not filter out the TypeRef's references just because
    // the TypeRef itself has no location to match against.
    const result = await queries.getSymbolReferences({
      name: 'WidgetConfig',
      filePath: '/x/config.ts',
      startLine: 12,
    });

    expect(result.references.map((r) => r.name)).toEqual(['makeWidget']);
  });

  it('classifies a same-file TypeRef reference as same-file, not "other file"', async () => {
    // The TypeRef node the USES_TYPE edge lands on has filePath = null, which
    // is not the declaration's file. sameFile must be judged against the
    // declaring file, not against whichever node the edge happened to land
    // on, or a use in the very same file as the declaration gets classified
    // as coming from elsewhere.
    await client.query(`
      CREATE (s:File {filePath: '/x/shapes.ts', name: 'shapes.ts'})
      CREATE (decl:Interface {name: 'LocalShape', filePath: '/x/shapes.ts', startLine: 4})
      CREATE (ref:TypeRef {name: 'LocalShape', language: 'typescript', isPrimitive: false})
      CREATE (user:Function {name: 'sameFileUser', filePath: '/x/shapes.ts', startLine: 20})
      CREATE (s)-[:CONTAINS]->(decl)
      CREATE (s)-[:CONTAINS]->(user)
      CREATE (user)-[:USES_TYPE]->(ref)
    `);

    const result = await queries.getSymbolReferences({ name: 'LocalShape' });

    expect(result.references).toHaveLength(1);
    expect(result.references[0]?.name).toBe('sameFileUser');
    expect(result.references[0]?.sameFile).toBe(true);
    expect(result.referencingFiles).toEqual([]);
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
      CREATE (closeOne:Function {name: 'close', filePath: '/x/one.ts', startLine: 5})
      CREATE (closeTwo:Function {name: 'close', filePath: '/x/two.ts', startLine: 8})
      CREATE (callerOne:Function {name: 'callerOne', filePath: '/x/one.ts', startLine: 20})
      CREATE (callerTwo:Function {name: 'callerTwo', filePath: '/x/two.ts', startLine: 30})
      CREATE (one)-[:CONTAINS]->(closeOne)
      CREATE (one)-[:CONTAINS]->(callerOne)
      CREATE (two)-[:CONTAINS]->(closeTwo)
      CREATE (two)-[:CONTAINS]->(callerTwo)
      CREATE (callerOne)-[:CALLS]->(closeOne)
      CREATE (callerTwo)-[:CALLS]->(closeTwo)
    `);

    const result = await queries.getSymbolReferences({ name: 'close' });

    expect(result.references).toHaveLength(2);
    const byName = new Map(result.references.map((r) => [r.name, r]));
    expect(byName.get('callerOne')?.sameFile).toBe(true);
    expect(byName.get('callerTwo')?.sameFile).toBe(true);
    expect(result.referencingFiles).toEqual([]);
  });

  it('does not guess a file for a proxy reference when two declarations share the name', async () => {
    // Two genuine declarations of 'SharedType', each in its own file, plus a
    // single TypeRef proxy for that name. A USES_TYPE edge from either file
    // lands on the proxy, not on either declaration, so nothing in the graph
    // says which of the two declarations a given proxy reference means.
    // Falling back to "whichever declaration Cypher happened to return
    // first" would get one of the two references right by luck and the
    // other wrong: the same batch-wide misattribution bug in a new spot.
    // Neither reference can be honestly classified as same-file from this
    // data, so both must come back false rather than a guess.
    await client.query(`
      CREATE (m1:File {filePath: '/x/m1.ts', name: 'm1.ts'})
      CREATE (m2:File {filePath: '/x/m2.ts', name: 'm2.ts'})
      CREATE (declM1:Interface {name: 'SharedType', filePath: '/x/m1.ts', startLine: 3})
      CREATE (declM2:Interface {name: 'SharedType', filePath: '/x/m2.ts', startLine: 7})
      CREATE (proxy:TypeRef {name: 'SharedType', language: 'typescript', isPrimitive: false})
      CREATE (userM1:Function {name: 'userM1', filePath: '/x/m1.ts', startLine: 20})
      CREATE (userM2:Function {name: 'userM2', filePath: '/x/m2.ts', startLine: 25})
      CREATE (m1)-[:CONTAINS]->(declM1)
      CREATE (m1)-[:CONTAINS]->(userM1)
      CREATE (m2)-[:CONTAINS]->(declM2)
      CREATE (m2)-[:CONTAINS]->(userM2)
      CREATE (userM1)-[:USES_TYPE]->(proxy)
      CREATE (userM2)-[:USES_TYPE]->(proxy)
    `);

    const result = await queries.getSymbolReferences({ name: 'SharedType' });

    expect(result.references).toHaveLength(2);
    const byUser = new Map(result.references.map((r) => [r.name, r]));
    expect(byUser.get('userM1')?.sameFile).toBe(false);
    expect(byUser.get('userM2')?.sameFile).toBe(false);
  });
});
