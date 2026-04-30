import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { checkIndexHealth, type HealthCheckResult } from '../check-index-health.js';
import { checkFalkorDBReachable, checkEmbeddingDim } from '../check-index-health.js';
import { createClient } from '../../packages/graph/dist/index.js';
import { randomBytes } from 'node:crypto';

describe('checkIndexHealth', () => {
  it('returns a HealthCheckResult shape', async () => {
    const result: HealthCheckResult = await checkIndexHealth({ requireIndex: false });
    expect(result).toHaveProperty('checks');
    expect(result).toHaveProperty('hasFailures');
    expect(result).toHaveProperty('hasWarnings');
    expect(Array.isArray(result.checks)).toBe(true);
    expect(result.hasFailures).toBe(false);
    expect(result.hasWarnings).toBe(false);
  });
});

describe('Check 1: FalkorDB reachable', () => {
  it('passes against a live FalkorDB Docker', async () => {
    const result = await checkFalkorDBReachable({
      host: process.env['FALKORDB_HOST'] ?? 'localhost',
      port: Number(process.env['FALKORDB_PORT'] ?? '6379'),
    });
    expect(result.status).toBe('pass');
    expect(result.name).toBe('falkordb-reachable');
  });

  it('fails with fix message when host is unreachable', async () => {
    const result = await checkFalkorDBReachable({
      host: 'localhost',
      port: 64999,  // intentionally closed port
    });
    expect(result.status).toBe('fail');
    expect(result.message).toMatch(/not reachable/i);
    expect(result.fix).toMatch(/docker run/);
    expect(result.fix).toMatch(/64999/);
  });
});

describe('Check 2: Embedding dim matches', () => {
  const tempGraph = `embdim-test-${randomBytes(4).toString('hex')}`;
  let client: Awaited<ReturnType<typeof createClient>>;

  beforeAll(async () => {
    client = await createClient({
      driver: 'falkordb',
      host: process.env['FALKORDB_HOST'] ?? 'localhost',
      port: Number(process.env['FALKORDB_PORT'] ?? '6379'),
      graphName: tempGraph,
    });
  });

  afterAll(async () => {
    await client.graph?.delete().catch(() => undefined);
    await client.close();
  });

  it('passes when index dim matches voyage (1024)', async () => {
    const e = Array.from({ length: 1024 }, () => 0.1);
    await client.query('CREATE (:Function {name: $n, embedding: vecf32($e)})', { params: { n: 'foo', e } });
    const result = await checkEmbeddingDim(client, 'voyage');
    expect(result.status).toBe('pass');
    await client.query('MATCH (n) DETACH DELETE n', { params: {} });
  });

  it('fails with fix message when index dim is wrong', async () => {
    const e = Array.from({ length: 768 }, () => 0.1);  // local-sized embedding
    await client.query('CREATE (:Function {name: $n, embedding: vecf32($e)})', { params: { n: 'foo', e } });
    const result = await checkEmbeddingDim(client, 'voyage');
    expect(result.status).toBe('fail');
    expect(result.message).toMatch(/768.*1024|1024.*768/);
    expect(result.fix).toMatch(/clear-and-reindex/);
    await client.query('MATCH (n) DETACH DELETE n', { params: {} });
  });

  it('fails when no embeddings exist (requireIndex=true case)', async () => {
    await client.query('MATCH (n) DETACH DELETE n', { params: {} });
    const result = await checkEmbeddingDim(client, 'voyage');
    expect(result.status).toBe('fail');
    expect(result.message).toMatch(/no embeddings/i);
  });
});
