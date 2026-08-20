/**
 * Regression test: mergeEntities must not delete the duplicate entity when a
 * relationship/edge transfer step fails.
 *
 * Bug: each transfer step (outgoing RELATES_TO, incoming RELATES_TO, ABOUT) was
 * wrapped in a bare `catch {}` that swallowed any error, and the DETACH DELETE
 * of the duplicate ran unconditionally afterward, outside every try block. A
 * failed transfer meant the duplicate's un-transferred edges were destroyed by
 * the delete, with no copy ever having been made: permanent, silent data loss.
 * Callers (packages/plugin-nlp/src/entity-resolution.ts) discarded the return
 * value and counted the merge as a success regardless.
 *
 * This test uses a fake GraphClient (no FalkorDB required, no server started)
 * so it can simulate a transfer step throwing, and asserts that the duplicate
 * is never deleted when that happens.
 */

import { describe, expect, it } from 'vitest';
import { createKnowledgeOperations, type KnowledgeOperations } from '../knowledge-operations';
import type { GraphClient, QueryOptions, QueryResult } from '../client';
import { falkorDialect } from '../drivers/falkordb';

type TransferStep = 'outgoing' | 'incoming' | 'about' | 'delete' | 'unknown';

/**
 * Classifies which step of mergeEntities issued a given Cypher string, using
 * substrings unique to each step's query in knowledge-operations.ts.
 */
function classifyMergeCypher(cypher: string): TransferStep {
  if (cypher.includes('DETACH DELETE e')) return 'delete';
  if (cypher.includes('(dup:Entity { text: $dupText, type: $dupType })-[r:RELATES_TO]->(other:Entity)')) {
    return 'outgoing';
  }
  if (cypher.includes('(other:Entity)-[r:RELATES_TO]->(dup:Entity { text: $dupText, type: $dupType })')) {
    return 'incoming';
  }
  if (cypher.includes('[a:ABOUT]->(target)')) return 'about';
  return 'unknown';
}

/**
 * Builds a fake GraphClient that records every query mergeEntities issues and
 * throws on the step named by `failStep` (if any), so we can simulate a
 * transfer failure without a real FalkorDB instance.
 */
function createFakeMergeClient(failStep: TransferStep | null): {
  client: GraphClient;
  calls: TransferStep[];
} {
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
      if (step === 'delete') {
        return { data: [], metadata: [] };
      }
      // outgoing / incoming / about: report one edge transferred
      return { data: [{ count: 1 }] as unknown as T[], metadata: [] };
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
    const { client, calls } = createFakeMergeClient('incoming');
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
      const { client, calls } = createFakeMergeClient(failStep);
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
    const { client, calls } = createFakeMergeClient('incoming');
    const kgOps: KnowledgeOperations = createKnowledgeOperations(client);

    const result = await kgOps.mergeEntities(
      'Canonical Corp', 'Organization',
      'Canonical Corp Duplicate', 'Organization',
    );

    expect(calls).toEqual(['outgoing', 'incoming', 'about']);
    expect(result.transferredRelationships).toBe(1); // outgoing's 1 edge counted
    expect(result.deleted).toBe(false);
  });

  it('deletes the duplicate only when every transfer step succeeds', async () => {
    const { client, calls } = createFakeMergeClient(null);
    const kgOps: KnowledgeOperations = createKnowledgeOperations(client);

    const result = await kgOps.mergeEntities(
      'Canonical Corp', 'Organization',
      'Canonical Corp Duplicate', 'Organization',
    );

    expect(calls).toEqual(['outgoing', 'incoming', 'about', 'delete']);
    expect(result.success).toBe(true);
    expect(result.deleted).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.transferredRelationships).toBe(2);
    expect(result.transferredAboutEdges).toBe(1);
  });
});
