/**
 * enrichFromGraph: regression cover for two production defects found via the
 * read-only API against the live graph.
 *
 * Defect 1 (null binding): `n` used to be bound inside the FIRST OPTIONAL
 * MATCH, together with the caller edge. When a symbol has no callers that
 * whole pattern fails to match, so `n` comes out null, and every clause
 * after it (including the callees expansion) computes against null. A
 * function that calls other functions but is called by nobody reported zero
 * callees. Fix: bind `n` in its own MATCH before any OPTIONAL expansion.
 *
 * Defect 2 (name-only key collisions): the enrichment map used to be keyed
 * on symbol name alone. The query returns one row per node sharing that
 * name, so on a name collision (e.g. two classes each with a
 * "constructor") the last row silently overwrote the earlier one, and a
 * hit could be decorated with a different symbol's numbers entirely. Fix:
 * key on filePath + name + startLine, matching how `Candidate` identifies
 * one specific declaration.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, resolveEmbeddedBinaryPaths, type GraphClient } from '@codegraph/graph';
import { enrichFromGraph, type Candidate } from '../enrichedSearchV2';

// The embedded driver ships binaries for darwin-arm64 and linux-x64 only.
const describeIfAvailable = resolveEmbeddedBinaryPaths() ? describe : describe.skip;

function candidate(over: Partial<Candidate> & { id: string; name: string; filePath: string; startLine: number }): Candidate {
  return {
    nodeType: 'Function',
    properties: {},
    vectorScore: 1,
    score: 1,
    ...over,
  };
}

describeIfAvailable('enrichFromGraph', () => {
  let client: GraphClient;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'cg-enrich-'));
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: 'enrich_regression',
    } as never);

    // --- Fixture for defect 1: a symbol with callees but zero callers ---
    // `callsButNotCalled` has one outbound CALLS edge (to `calleeOfIt`) and
    // no inbound one at all, so its caller count is genuinely zero.
    await client.query(`
      CREATE (f:File {filePath: '/x/a.ts', name: 'a.ts'})
      CREATE (callsButNotCalled:Function {id: 'id-caller', name: 'callsButNotCalled', filePath: '/x/a.ts', startLine: 5})
      CREATE (callee:Function {id: 'id-callee', name: 'calleeOfIt', filePath: '/x/a.ts', startLine: 9})
      CREATE (f)-[:CONTAINS]->(callsButNotCalled)
      CREATE (f)-[:CONTAINS]->(callee)
      CREATE (callsButNotCalled)-[:CALLS]->(callee)
    `);

    // --- Fixture for defect 2: two different declarations, same name ---
    // Two classes named "Widget" in different files, each with its own
    // "constructor" method reached by a different number of callers, so a
    // name-only key would let one hit's numbers bleed into the other's.
    await client.query(`
      CREATE (fb:File {filePath: '/x/b.ts', name: 'b.ts'})
      CREATE (fc:File {filePath: '/x/c.ts', name: 'c.ts'})
      CREATE (ctorB:Function {id: 'id-ctor-b', name: 'constructor', filePath: '/x/b.ts', startLine: 3})
      CREATE (ctorC:Function {id: 'id-ctor-c', name: 'constructor', filePath: '/x/c.ts', startLine: 30})
      CREATE (callerB1:Function {id: 'id-maker-b1', name: 'makeB1', filePath: '/x/b.ts', startLine: 20})
      CREATE (callerB2:Function {id: 'id-maker-b2', name: 'makeB2', filePath: '/x/b.ts', startLine: 25})
      CREATE (fb)-[:CONTAINS]->(ctorB)
      CREATE (fc)-[:CONTAINS]->(ctorC)
      CREATE (fb)-[:CONTAINS]->(callerB1)
      CREATE (fb)-[:CONTAINS]->(callerB2)
      CREATE (callerB1)-[:CALLS]->(ctorB)
      CREATE (callerB2)-[:CALLS]->(ctorB)
    `);
    // ctorC has zero callers, on purpose: two distinct "constructor" nodes
    // with two different (0 vs 2) caller counts.
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it('reports callees for a symbol that has zero callers (defect 1)', async () => {
    const hit = candidate({ id: 'id-caller', name: 'callsButNotCalled', filePath: '/x/a.ts', startLine: 5 });
    const result = await enrichFromGraph(client, [hit]);
    const entries = Array.from(result.values());
    expect(entries).toHaveLength(1);
    expect(entries[0]?.callerCount).toBe(0);
    // This is the assertion that fails against the buggy query: n comes out
    // null once the caller-edge OPTIONAL MATCH fails to match, so callees
    // silently comes back empty even though callsButNotCalled really does
    // call calleeOfIt.
    expect(entries[0]?.callees).toEqual(['calleeOfIt']);
  });

  it('still reports callers correctly for an ordinary symbol', async () => {
    const hit = candidate({ id: 'id-callee', name: 'calleeOfIt', filePath: '/x/a.ts', startLine: 9 });
    const result = await enrichFromGraph(client, [hit]);
    const entries = Array.from(result.values());
    expect(entries[0]?.callerCount).toBe(1);
    expect(entries[0]?.callees).toEqual([]);
  });

  it('does not mix up two declarations that share a name (defect 2)', async () => {
    const hitB = candidate({ id: 'id-ctor-b', name: 'constructor', filePath: '/x/b.ts', startLine: 3 });
    const hitC = candidate({ id: 'id-ctor-c', name: 'constructor', filePath: '/x/c.ts', startLine: 30 });
    const result = await enrichFromGraph(client, [hitB, hitC]);

    // Both hits must be individually retrievable and keep their own numbers.
    // A name-only key would only leave one entry in the map (last write
    // wins), so the /x/b.ts constructor's real callerCount of 2 would be
    // clobbered by, or would clobber, /x/c.ts's constructor's 0.
    const entries = Array.from(result.values());
    expect(entries).toHaveLength(2);

    const callerCounts = entries.map(e => e.callerCount).sort((a, b) => a - b);
    expect(callerCounts).toEqual([0, 2]);
  });

  it('produces no row (not a row of zeros) for a name with no matching node', async () => {
    const hit = candidate({ id: 'id-missing', name: 'doesNotExistAnywhere', filePath: '/x/nowhere.ts', startLine: 1 });
    const result = await enrichFromGraph(client, [hit]);
    expect(result.size).toBe(0);
  });
});
