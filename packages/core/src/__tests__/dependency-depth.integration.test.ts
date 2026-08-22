/**
 * Dependency-depth enrichment: regression cover for the hub blowup.
 *
 * A symbol name that resolves to many densely interconnected nodes (the shape
 * recursive parsers produce, e.g. zod's `_parse`) used to stall the whole
 * search. The query asked for the shortest path from an entry file under
 * OPTIONAL MATCH, so when no such path existed the engine had to enumerate the
 * symbol's entire six-hop neighbourhood to prove absence.
 *
 * The fixture below is deliberately tiny and still reproduces it: with 16
 * same-named functions calling each other (240 CALLS edges), the old form ran
 * past 10s while the current one answers in about a millisecond.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, resolveEmbeddedBinaryPaths, type GraphClient } from '@codegraph/graph';
import { DEPENDENCY_DEPTH_CYPHER } from '../enrichedSearchV2';

// The embedded driver ships binaries for darwin-arm64 and linux-x64 only.
const describeIfAvailable = resolveEmbeddedBinaryPaths() ? describe : describe.skip;

/** Comfortably above the fixed cost, far below the old form's runaway. */
const BUDGET_MS = 10_000;
const HUB_SIZE = 16;

describeIfAvailable('dependency depth enrichment', () => {
  let client: GraphClient;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'cg-depth-'));
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: 'depth_regression',
    } as never);

    // entry.ts is imported by other.ts, so it is not an entry point, and
    // nothing reaches lib.ts from an entry point. Every `_parse` below is
    // therefore unreachable, which is the case that used to be pathological.
    await client.query(`
      CREATE (root:File {filePath: '/x/entry.ts', name: 'entry.ts'})
      CREATE (lib:File {filePath: '/x/lib.ts', name: 'lib.ts'})
      CREATE (root)-[:IMPORTS]->(lib)
      CREATE (other:File {filePath: '/x/other.ts', name: 'other.ts'})
      CREATE (other)-[:IMPORTS]->(root)
    `);
    await client.query(
      `UNWIND range(0, $hub - 1) AS i
       MATCH (lib:File {filePath: '/x/lib.ts'})
       CREATE (f:Function {id: 'hub-' + toString(i), name: '_parse', filePath: '/x/lib.ts', startLine: i + 1})
       CREATE (lib)-[:CONTAINS]->(f)`,
      { params: { hub: HUB_SIZE } },
    );
    await client.query(`
      MATCH (a:Function {name: '_parse'}) WITH collect(a) AS fs
      UNWIND fs AS src UNWIND fs AS dst
      WITH src, dst WHERE id(src) <> id(dst)
      CREATE (src)-[:CALLS]->(dst)
    `);

    // A genuinely reachable symbol, to pin the values the query returns.
    await client.query(`
      MATCH (other:File {filePath: '/x/other.ts'})
      CREATE (r:Function {id: 'id-reachable', name: 'reachable', filePath: '/x/other.ts', startLine: 1})
      CREATE (other)-[:CONTAINS]->(r)
    `);
  }, 60_000);

  afterAll(async () => {
    await client?.close();
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it('answers for an unreachable hub symbol well inside the budget', async () => {
    const started = Date.now();
    const result = await client.roQuery<{ symbolId: string; minDepth: number | null }>(
      DEPENDENCY_DEPTH_CYPHER,
      { params: { ids: ['hub-0'] }, timeout: BUDGET_MS },
    );
    expect(Date.now() - started).toBeLessThan(BUDGET_MS);
    // Unreachable symbols yield no row, which the caller reads as "depth unknown".
    expect(result.data).toHaveLength(0);
  });

  it('reports the depth of a reachable symbol', async () => {
    const result = await client.roQuery<{ symbolId: string; minDepth: number | null }>(
      DEPENDENCY_DEPTH_CYPHER,
      { params: { ids: ['id-reachable'] }, timeout: BUDGET_MS },
    );
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.minDepth).toBe(1);
  });

  it('stays fast when a hub symbol is batched with ordinary ones', async () => {
    const started = Date.now();
    const result = await client.roQuery<{ symbolId: string; minDepth: number | null }>(
      DEPENDENCY_DEPTH_CYPHER,
      { params: { ids: ['id-reachable', 'hub-0', 'id-missing'] }, timeout: BUDGET_MS },
    );
    expect(Date.now() - started).toBeLessThan(BUDGET_MS);
    expect(result.data.map((r) => r.symbolId)).toEqual(['id-reachable']);
  });
});
