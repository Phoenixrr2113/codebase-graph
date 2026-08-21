/**
 * Regression test: mergeEntities identifies entities by {text, type}, the
 * same key every other method on KnowledgeOperations uses. Nothing in the
 * schema guaranteed that key was unique, so two shapes of call could
 * destroy data mergeEntities was meant to preserve:
 *
 *   1. Self-merge: canonicalText/Type equal duplicateText/Type. dup and
 *      canon both bind to the same node, the transfer steps create edges
 *      from the node to itself, and DETACH DELETE removes the entity that
 *      was supposed to survive as canonical.
 *
 *   2. Two physical nodes sharing a key: since {text, type} cannot name one
 *      node and not the other, merging them is only expressible as the same
 *      self-merge call above. Both nodes match both the `dup` and `canon`
 *      patterns, so the transfer queries cross-join (every dup-side edge
 *      gets paired with every canon-side node, inflating the reported
 *      count), and the final DETACH DELETE - matching by key, not by node -
 *      removes every physical node carrying that key, not just one.
 *
 * Both are reachable from production: findExactMatches in
 * entity-resolution.ts groups entities by normalized text + type and picks
 * a canonical/duplicate pair from the group by sorting; if two physically
 * distinct Entity nodes carry byte-identical text and type, every
 * tiebreaker ties and the two ends of the resulting merge call are the same
 * key. ensureSchema (falkordb-shared.ts) now creates a uniqueness
 * constraint for Entity(text, type) so new duplicates like this should stop
 * forming, but FalkorDB constraints apply asynchronously and silently do
 * not take effect if the graph already has conflicting data - so
 * mergeEntities cannot assume the constraint is protecting it. It has to
 * detect and refuse both shapes itself, which is what this test verifies.
 *
 * Requires the real embedded FalkorDBLite driver, not the fake GraphClient
 * used in merge-entities-partial-failure.test.ts: a fake object cannot
 * express "two physical nodes with the same {text, type}" the way a real
 * graph can. Each test gets its own throwaway on-disk graph in a temp
 * directory (no Docker, no shared/dev-server state). Skipped if
 * falkordblite is not installed.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createClient, type GraphClient } from '../client';
import { createKnowledgeOperations, type KnowledgeOperations } from '../knowledge-operations';
import { mkdtemp, rm } from 'node:fs/promises';

// Skip tests if falkordblite is not available
let falkordbliteAvailable = false;
try {
  await import('falkordblite');
  falkordbliteAvailable = true;
} catch {
  // not installed
}

const describeIfAvailable = falkordbliteAvailable ? describe : describe.skip;

describeIfAvailable('mergeEntities - identity (FalkorDBLite)', () => {
  let client: GraphClient;
  let kgOps: KnowledgeOperations;
  let dataDir: string;

  beforeEach(async () => {
    // Short prefix: embedded driver binds a Unix socket under this dir, and
    // socket paths have a ~106 byte length limit.
    dataDir = await mkdtemp('/tmp/cg-mid-');
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: `t_mid_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    });
    // Deliberately not calling client.ensureIndexes() here: this test is
    // about mergeEntities' own runtime guard, not the schema constraint
    // (which is verified separately, and which cannot be relied on to have
    // taken effect on every graph - see the file header). Seeding two
    // physical nodes with the same key must not be blocked by the index
    // setup this test is specifically trying to route around.
    kgOps = createKnowledgeOperations(client);
  }, 30_000);

  afterEach(async () => {
    try { await client.close(); } catch { /* best effort */ }
    try { await rm(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  it('does not delete the entity or its edge when canonical and duplicate are the same key', async () => {
    await client.query(`
      CREATE (s:Entity {text: 'Sarah', type: 'Person', id: 'sarah-1', confidence: 0.9})
      CREATE (r:Entity {text: 'Randy', type: 'Person', id: 'randy-1', confidence: 0.9})
      CREATE (s)-[:RELATES_TO {type: 'KNOWS', confidence: 0.9, fact: 'Sarah knows Randy'}]->(r)
    `, { params: {} });

    const result = await kgOps.mergeEntities('Sarah', 'Person', 'Sarah', 'Person');

    expect(result.success).toBe(false);
    expect(result.deleted).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join(' ')).toContain('itself');

    const sarahCount = await client.roQuery<{ n: number }>(
      `MATCH (e:Entity {text: 'Sarah', type: 'Person'}) RETURN count(e) AS n`,
      { params: {} },
    );
    expect(sarahCount.data[0]?.n).toBe(1);

    const edgeCount = await client.roQuery<{ n: number }>(
      `MATCH (:Entity {text: 'Sarah', type: 'Person'})-[r:RELATES_TO]->(:Entity {text: 'Randy', type: 'Person'}) RETURN count(r) AS n`,
      { params: {} },
    );
    expect(edgeCount.data[0]?.n).toBe(1);
  });

  it('does not touch either node when two physical nodes share a key', async () => {
    // Two physically distinct Entity nodes, byte-identical {text, type} -
    // the state findExactMatches' tiebreakers cannot distinguish, and the
    // state a UNIQUE constraint (once OPERATIONAL) is meant to prevent.
    await client.query(`
      CREATE (a1:Entity {text: 'Acme Corp', type: 'Organization', id: 'acme-1', confidence: 0.9})
      CREATE (a2:Entity {text: 'Acme Corp', type: 'Organization', id: 'acme-2', confidence: 0.9})
      CREATE (t1:Entity {text: 'Widget Line', type: 'Product', id: 'widget-1', confidence: 0.9})
      CREATE (t2:Entity {text: 'Gadget Line', type: 'Product', id: 'gadget-1', confidence: 0.9})
      CREATE (a1)-[:RELATES_TO {type: 'MAKES', confidence: 0.9, fact: 'acme-1 makes widgets'}]->(t1)
      CREATE (a2)-[:RELATES_TO {type: 'MAKES', confidence: 0.9, fact: 'acme-2 makes gadgets'}]->(t2)
    `, { params: {} });

    const result = await kgOps.mergeEntities('Acme Corp', 'Organization', 'Acme Corp', 'Organization');

    expect(result.success).toBe(false);
    expect(result.deleted).toBe(false);
    // Nothing should have been transferred - the guard runs before any
    // transfer query, so there is no cross-join to inflate this count.
    expect(result.transferredRelationships).toBe(0);
    expect(result.transferredAboutEdges).toBe(0);

    const acmeCount = await client.roQuery<{ n: number }>(
      `MATCH (e:Entity {text: 'Acme Corp', type: 'Organization'}) RETURN count(e) AS n`,
      { params: {} },
    );
    expect(acmeCount.data[0]?.n).toBe(2);

    // Both original edges survive, each still pointing at its own original
    // target - no duplication from a cross-join, no loss from the delete.
    const widgetEdge = await client.roQuery<{ n: number }>(
      `MATCH (:Entity {id: 'acme-1'})-[r:RELATES_TO]->(:Entity {text: 'Widget Line', type: 'Product'}) RETURN count(r) AS n`,
      { params: {} },
    );
    expect(widgetEdge.data[0]?.n).toBe(1);

    const gadgetEdge = await client.roQuery<{ n: number }>(
      `MATCH (:Entity {id: 'acme-2'})-[r:RELATES_TO]->(:Entity {text: 'Gadget Line', type: 'Product'}) RETURN count(r) AS n`,
      { params: {} },
    );
    expect(gadgetEdge.data[0]?.n).toBe(1);

    const totalRelatesTo = await client.roQuery<{ n: number }>(
      `MATCH (:Entity {text: 'Acme Corp', type: 'Organization'})-[r:RELATES_TO]->() RETURN count(r) AS n`,
      { params: {} },
    );
    expect(totalRelatesTo.data[0]?.n).toBe(2);
  });

  // ==========================================================================
  // Asymmetric cardinality: two DIFFERENT keys, only one of them ambiguous.
  //
  // The self-merge cases above use the same key on both sides, so an
  // inflated count lands on both sides equally and cannot expose a
  // mismatch between "which side is ambiguous" and "which side the error
  // message blames". These two tests use distinct canonical/duplicate keys
  // with different cardinalities specifically to catch that: the cross-join
  // bug in the cardinality query (fixed by count(DISTINCT ...)) reported
  // dupCardinality * canonCardinality on BOTH sides, so whichever side's
  // check ran first (duplicate) always looked ambiguous whenever EITHER
  // side actually was - including runs where the canonical side was the
  // real problem and the duplicate side was fine.
  // ==========================================================================

  it('blames the canonical key, not the duplicate, when only the canonical key is ambiguous', async () => {
    await client.query(`
      CREATE (:Entity {text: 'Sarah', type: 'Person', id: 'sarah-1', confidence: 0.9})
      CREATE (:Entity {text: 'Sarah', type: 'Person', id: 'sarah-2', confidence: 0.9})
      CREATE (:Entity {text: 'Sarah', type: 'Person', id: 'sarah-3', confidence: 0.9})
      CREATE (:Entity {text: 'Sarah Chen', type: 'Person', id: 'sarahchen-1', confidence: 0.9})
    `, { params: {} });

    // canonical = 'Sarah' (3 physical nodes, ambiguous)
    // duplicate = 'Sarah Chen' (1 physical node, fine)
    const result = await kgOps.mergeEntities('Sarah', 'Person', 'Sarah Chen', 'Person');

    expect(result.success).toBe(false);
    expect(result.deleted).toBe(false);
    const message = result.errors.join(' ');
    expect(message).toContain('canonical key matches 3 physical nodes');
    expect(message).not.toContain('duplicate key matches');
  });

  it('blames the duplicate key, not the canonical, when only the duplicate key is ambiguous', async () => {
    await client.query(`
      CREATE (:Entity {text: 'Sarah', type: 'Person', id: 'sarah-1', confidence: 0.9})
      CREATE (:Entity {text: 'Sarah', type: 'Person', id: 'sarah-2', confidence: 0.9})
      CREATE (:Entity {text: 'Sarah', type: 'Person', id: 'sarah-3', confidence: 0.9})
      CREATE (:Entity {text: 'Sarah Chen', type: 'Person', id: 'sarahchen-1', confidence: 0.9})
    `, { params: {} });

    // canonical = 'Sarah Chen' (1 physical node, fine)
    // duplicate = 'Sarah' (3 physical nodes, ambiguous)
    const result = await kgOps.mergeEntities('Sarah Chen', 'Person', 'Sarah', 'Person');

    expect(result.success).toBe(false);
    expect(result.deleted).toBe(false);
    const message = result.errors.join(' ');
    expect(message).toContain('duplicate key matches 3 physical nodes');
    expect(message).not.toContain('canonical key matches');
  });
});
