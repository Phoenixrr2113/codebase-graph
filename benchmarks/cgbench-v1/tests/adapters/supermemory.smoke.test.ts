import { describe, expect, it, afterAll } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { SupermemoryAdapter } from '../../src/adapters/supermemory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '../../fixtures/code/tiny-ts');
const HAS_KEY = !!process.env['SUPERMEMORY_API_KEY'];

describe('SupermemoryAdapter (no key)', () => {
  it('throws BLOCKED on ingest when no API key provided', async () => {
    const adapter = new SupermemoryAdapter({
      dataDir: mkdtempSync('/tmp/cgbench-supermemory-stub-'),
    });
    await expect(
      adapter.ingest({ codeRoots: [{ language: 'typescript', path: FIXTURE, commitSha: 'test' }] }),
    ).rejects.toThrow(/BLOCKED/);
  });

  it('throws BLOCKED on query when no API key provided', async () => {
    const adapter = new SupermemoryAdapter({
      dataDir: mkdtempSync('/tmp/cgbench-supermemory-stub-'),
    });
    await expect(adapter.query('retry function')).rejects.toThrow(/BLOCKED/);
  });
});

describe.skipIf(!HAS_KEY)('SupermemoryAdapter smoke (requires SUPERMEMORY_API_KEY)', () => {
  const dataDir = mkdtempSync('/tmp/cgbench-supermemory-');
  const adapter = new SupermemoryAdapter({
    dataDir,
    apiKey: process.env['SUPERMEMORY_API_KEY'],
  });

  afterAll(async () => {
    await adapter.destroy().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('ingests fixture and returns non-zero stats', async () => {
    const stats = await adapter.ingest({
      codeRoots: [{ language: 'typescript', path: FIXTURE, commitSha: 'fixture' }],
    });
    expect(stats.totalDocs).toBeGreaterThan(0);
    expect(stats.durationMs).toBeGreaterThan(0);
  }, 90_000);

  it('queries return results', async () => {
    const results = await adapter.query('function that retries failed requests', { topK: 10 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toMatchObject({ kind: 'knowledge' });
  }, 60_000);
});
