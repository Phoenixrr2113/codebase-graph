/**
 * Regression test: mergeEntities must not delete the duplicate entity when a
 * relationship/edge transfer step fails, or when a transfer step silently
 * finds nothing to move because one of the two entities is missing.
 *
 * Bug 1 (fixed): each transfer step (outgoing RELATES_TO, incoming RELATES_TO,
 * ABOUT) was wrapped in a bare `catch {}` that swallowed any error, and the
 * DETACH DELETE of the duplicate ran unconditionally afterward, outside every
 * try block. A failed transfer meant the duplicate's un-transferred edges were
 * destroyed by the delete, with no copy ever having been made: permanent,
 * silent data loss. Callers (packages/plugin-nlp/src/entity-resolution.ts)
 * discarded the return value and counted the merge as a success regardless.
 *
 * Bug 2 (fixed): a Cypher MATCH that finds no matching node does not throw,
 * it just returns zero rows. Each transfer query MATCHes both the duplicate
 * and the canonical entity, so if the canonical entity does not exist at call
 * time (e.g. it was already deleted by an earlier merge in the same
 * resolveEntities run - see packages/plugin-nlp/src/entity-resolution.ts,
 * where the same entity can appear in two Tier 3 candidate pairs), all three
 * transfer steps quietly report "0 edges moved" with no exception. The old
 * code could not tell that apart from "the duplicate legitimately had no
 * edges to move," so it went on to delete a duplicate whose edges had nowhere
 * to go: the exact same data loss as Bug 1, reached by a path that never
 * throws. The fix checks entity existence explicitly instead of inferring it
 * from transfer row counts, and treats the two absences differently: a
 * missing duplicate means the merge already happened (no-op success), while a
 * missing canonical means the edges have nowhere to go (hard failure, delete
 * aborted).
 *
 * This test uses a fake GraphClient (no FalkorDB required, no server started)
 * so it can simulate both a transfer step throwing and a transfer step
 * quietly returning zero rows because an entity is absent.
 */

import { describe, expect, it } from 'vitest';
import { createKnowledgeOperations, type KnowledgeOperations } from '../knowledge-operations';
import type { GraphClient, QueryOptions, QueryResult } from '../client';
import { falkorDialect } from '../drivers/falkordb';

type TransferStep = 'outgoing' | 'incoming' | 'about' | 'existence' | 'delete' | 'unknown';

/**
 * Classifies which step of mergeEntities issued a given Cypher string, using
 * substrings unique to each step's query in knowledge-operations.ts.
 */
function classifyMergeCypher(cypher: string): TransferStep {
  if (cypher.includes('DETACH DELETE e')) return 'delete';
  if (cypher.includes('RETURN count(dup) AS dupCount, count(canon) AS canonCount')) return 'existence';
  if (cypher.includes('(dup:Entity { text: $dupText, type: $dupType })-[r:RELATES_TO]->(other:Entity)')) {
    return 'outgoing';
  }
  if (cypher.includes('(other:Entity)-[r:RELATES_TO]->(dup:Entity { text: $dupText, type: $dupType })')) {
    return 'incoming';
  }
  if (cypher.includes('[a:ABOUT]->(target)')) return 'about';
  return 'unknown';
}

interface FakeMergeScenario {
  /** Throw a real error on this step, if set. Mutually exclusive in practice with the exists flags below. */
  failStep?: TransferStep | null;
  /** Whether the duplicate entity exists in the graph. Defaults to true. */
  dupExists?: boolean;
  /** Whether the canonical entity exists in the graph. Defaults to true. */
  canonExists?: boolean;
}

/**
 * Builds a fake GraphClient that records every query mergeEntities issues and
 * reproduces the two ways a merge step can fail to move an edge:
 *   - `failStep` makes that step's query throw, simulating a real DB error.
 *   - `dupExists` / `canonExists` (default true) control whether the
 *     outgoing/incoming/about transfer queries report an edge moved. When
 *     either entity is absent, those queries return `{ count: 0 }` without
 *     throwing, exactly like a real Cypher MATCH on a missing node.
 */
function createFakeMergeClient(scenario: FakeMergeScenario = {}): {
  client: GraphClient;
  calls: TransferStep[];
} {
  const { failStep = null, dupExists = true, canonExists = true } = scenario;
  const bothExist = dupExists && canonExists;
  const calls: TransferStep[] = [];

  const client: GraphClient = {
    graph: null,
    graphName: 'merge-entities-fake',
    dialect: falkorDialect,

    async query<T>(cypher: string, _options?: QueryOptions): Promise<QueryResult<T>> {
      const step = classifyMergeCypher(cypher);
      calls.push(step);

      if (step === failStep) {
        throw new Error(`simulated ${step} transfer failure`);
      }
      if (step === 'existence') {
        return {
          data: [{ dupCount: dupExists ? 1 : 0, canonCount: canonExists ? 1 : 0 }] as unknown as T[],
          metadata: [],
        };
      }
      if (step === 'delete') {
        return { data: [], metadata: [] };
      }
      // outgoing / incoming / about: an edge only actually moves when both
      // endpoints exist. If either is missing, the real MATCH finds nothing
      // and returns zero rows without throwing.
      return { data: [{ count: bothExist ? 1 : 0 }] as unknown as T[], metadata: [] };
    },

    async roQuery<T>(cypher: string, options?: QueryOptions): Promise<QueryResult<T>> {
      return client.query<T>(cypher, options);
    },

    async ensureIndexes(): Promise<void> {
      // not exercised by mergeEntities
    },

    async close(): Promise<void> {
      // not exercised by mergeEntities
    },
  };

  return { client, calls };
}

describe('mergeEntities - partial transfer failure', () => {
  it('does not delete the duplicate when the incoming-edge transfer fails', async () => {
    const { client, calls } = createFakeMergeClient({ failStep: 'incoming' });
    const kgOps: KnowledgeOperations = createKnowledgeOperations(client);

    await kgOps.mergeEntities(
      'Canonical Corp', 'Organization',
      'Canonical Corp Duplicate', 'Organization',
    );

    // The duplicate must survive so the merge can be retried later - its
    // edges were never fully copied to the canonical entity, so deleting it
    // now would permanently destroy data that was never transferred.
    expect(calls).not.toContain('delete');
  });

  it('reports failure to the caller instead of swallowing it, for each transfer step', async () => {
    for (const failStep of ['outgoing', 'incoming', 'about'] as const) {
      const { client, calls } = createFakeMergeClient({ failStep });
      const kgOps: KnowledgeOperations = createKnowledgeOperations(client);

      const result = await kgOps.mergeEntities(
        'Canonical Corp', 'Organization',
        'Canonical Corp Duplicate', 'Organization',
      );

      expect(result.success).toBe(false);
      expect(result.deleted).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain(failStep);
      expect(calls).not.toContain('delete');
    }
  });

  it('leaves outgoing-transferred edges untouched when incoming transfer fails, so a retry is idempotent', async () => {
    // Outgoing succeeds and moves its edge; incoming fails and never gets to
    // move its edge. The delete must not run - so on a later retry, the
    // outgoing step finds nothing left (already moved) while the incoming
    // step gets another chance at the edge it failed to move the first time.
    const { client, calls } = createFakeMergeClient({ failStep: 'incoming' });
    const kgOps: KnowledgeOperations = createKnowledgeOperations(client);

    const result = await kgOps.mergeEntities(
      'Canonical Corp', 'Organization',
      'Canonical Corp Duplicate', 'Organization',
    );

    // Leading 'existence' is the cardinality pre-check (see
    // merge-entities-identity.test.ts): it runs before any transfer to
    // confirm the key names exactly one physical node on each side.
    expect(calls).toEqual(['existence', 'outgoing', 'incoming', 'about']);
    expect(result.transferredRelationships).toBe(1); // outgoing's 1 edge counted
    expect(result.deleted).toBe(false);
  });

  it('deletes the duplicate only when every transfer step succeeds', async () => {
    const { client, calls } = createFakeMergeClient();
    const kgOps: KnowledgeOperations = createKnowledgeOperations(client);

    const result = await kgOps.mergeEntities(
      'Canonical Corp', 'Organization',
      'Canonical Corp Duplicate', 'Organization',
    );

    // First 'existence' is the upfront cardinality pre-check; second is the
    // pre-delete absence check (both use the same query shape, see
    // classifyMergeCypher's comment).
    expect(calls).toEqual(['existence', 'outgoing', 'incoming', 'about', 'existence', 'delete']);
    expect(result.success).toBe(true);
    expect(result.deleted).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.transferredRelationships).toBe(2);
    expect(result.transferredAboutEdges).toBe(1);
  });

  it('does not delete the duplicate when the canonical entity does not exist', async () => {
    // Every transfer query MATCHes the canonical entity too. If it is gone,
    // each transfer step quietly reports 0 rows moved instead of throwing -
    // there is no exception anywhere in this run. Without an explicit
    // existence check, that is indistinguishable from "duplicate had no
    // edges to move," and the old code deleted the duplicate anyway even
    // though its edges (if any) were never copied anywhere.
    const { client, calls } = createFakeMergeClient({ dupExists: true, canonExists: false });
    const kgOps: KnowledgeOperations = createKnowledgeOperations(client);

    const result = await kgOps.mergeEntities(
      'Canonical Corp', 'Organization',
      'Canonical Corp Duplicate', 'Organization',
    );

    expect(calls).not.toContain('delete');
    expect(result.success).toBe(false);
    expect(result.deleted).toBe(false);
    expect(result.errors.join(' ')).toContain('canonical');
  });

  it('treats an already-gone duplicate as a no-op success, not a failure', async () => {
    // The duplicate may already be gone because an earlier merge in the same
    // resolveEntities run (or a concurrent run) already consumed it - e.g.
    // the same entity named in two Tier 3 candidate pairs. There is nothing
    // left to transfer or delete, and that is not an error.
    const { client, calls } = createFakeMergeClient({ dupExists: false, canonExists: true });
    const kgOps: KnowledgeOperations = createKnowledgeOperations(client);

    const result = await kgOps.mergeEntities(
      'Canonical Corp', 'Organization',
      'Canonical Corp Duplicate', 'Organization',
    );

    expect(calls).not.toContain('delete');
    expect(result.success).toBe(true);
    expect(result.deleted).toBe(false);
    expect(result.transferredRelationships).toBe(0);
    expect(result.transferredAboutEdges).toBe(0);
  });
});
