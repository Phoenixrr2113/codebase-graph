// scripts/__tests__/benchmark-health-integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createClient } from '../../packages/graph/dist/index.js';

describe('benchmark fails fast on bad index', () => {
  const tempGraph = `bad-index-test-${randomBytes(4).toString('hex')}`;
  let client: Awaited<ReturnType<typeof createClient>>;

  beforeAll(async () => {
    client = await createClient({
      driver: 'falkordb',
      host: process.env['FALKORDB_HOST'] ?? 'localhost',
      port: Number(process.env['FALKORDB_PORT'] ?? '6379'),
      graphName: tempGraph,
    });
    // Seed scripts/-prefixed nodes — Check 4 should fail
    await client.query(
      'CREATE (:Function {filePath: "scripts/benchmark-search.ts", name: "calculateMRR"}), (:Function {filePath: "scripts/foo.ts", name: "bar"})',
      { params: {} },
    );
  });

  afterAll(async () => {
    await client.graph?.delete().catch(() => undefined);
    await client.close();
  });

  it('exits 1 with the scripts/-leaked fix message when scripts/ is in the index', () => {
    const result = spawnSync('npx', ['tsx', 'scripts/check-index-health.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, FALKORDB_GRAPH: tempGraph },
      encoding: 'utf-8',
      timeout: 30000,
    });
    expect(result.status).toBe(1);
    const output = (result.stdout ?? '') + (result.stderr ?? '');
    expect(output).toMatch(/scripts\/ leaked/);
    expect(output).toMatch(/regression-analysis-2026-03-19/);
  });
});
