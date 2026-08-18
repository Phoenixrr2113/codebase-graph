import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createClient } from '../client';
import { createKnowledgeOperations } from '../knowledge-operations';
import type { GraphClient } from '../client';
import type { KnowledgeOperations } from '../knowledge-operations';

const TEST_HOST = process.env['FALKORDB_HOST'] ?? 'localhost';
const TEST_PORT = process.env['FALKORDB_PORT'] ?? '6379';

describe('AboutEdgeInput.crossEncoderScore', () => {
  let client: GraphClient;
  let kgOps: KnowledgeOperations;

  beforeAll(async () => {
    client = await createClient({
      driver: 'falkordb',
      host: TEST_HOST,
      port: Number(TEST_PORT),
      graphName: `test-about-score-${Date.now()}`,
    });
    kgOps = createKnowledgeOperations(client);

    // Seed: an entity and a code node to link
    await client.query(`CREATE (e:Entity {text: 'redirect logic', type: 'Concept', sampleIds: ['s1']})`);
    await client.query(`CREATE (f:Function {name: 'resolve_redirects', filePath: 'sessions.py'})`);
  });

  afterAll(async () => {
    if (client) {
      try { await client.query('MATCH (n) DETACH DELETE n', { params: {} }); } catch { /* ok */ }
      await client.close();
    }
  });

  it('persists crossEncoderScore on ABOUT edge', async () => {
    const created = await kgOps.createAboutEdge({
      entityText: 'redirect logic',
      entityType: 'Concept',
      targetLabel: 'Function',
      targetKey: 'name',
      targetValue: 'resolve_redirects',
      confidence: 0.9,
      crossEncoderScore: 0.83,
      method: 'exact_match',
    });
    expect(created).toBe(true);

    const result = await client.roQuery<{ score: number | null }>(
      `MATCH (e:Entity {text: 'redirect logic'})-[r:ABOUT]->(f:Function {name: 'resolve_redirects'})
       RETURN r.crossEncoderScore AS score`,
      { params: {} },
    );
    expect(result.data[0]?.score).toBe(0.83);
  });

  it('defaults to null when crossEncoderScore is omitted (legacy compat)', async () => {
    // Same edge as test 1: MERGE + ON MATCH SET overwrites crossEncoderScore back to null.
    await kgOps.createAboutEdge({
      entityText: 'redirect logic',
      entityType: 'Concept',
      targetLabel: 'Function',
      targetKey: 'name',
      targetValue: 'resolve_redirects',
      confidence: 0.9,
      method: 'exact_match',
      // crossEncoderScore omitted
    });

    const result = await client.roQuery<{ score: number | null }>(
      `MATCH (e:Entity {text: 'redirect logic'})-[r:ABOUT]->(f:Function {name: 'resolve_redirects'})
       RETURN r.crossEncoderScore AS score`,
      { params: {} },
    );
    expect(result.data[0]?.score).toBeNull();
  });
});
