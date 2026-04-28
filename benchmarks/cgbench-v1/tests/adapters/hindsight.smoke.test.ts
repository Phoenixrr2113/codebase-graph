import { describe, expect, it, afterAll } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { HindsightAdapter } from '../../src/adapters/hindsight.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '../../fixtures/code/tiny-ts');
// HINDSIGHT_URL must be set to confirm the Docker container is running
const HAS_URL = !!process.env['HINDSIGHT_URL'];

describe('HindsightAdapter (no Docker)', () => {
  it('throws BLOCKED on ingest when HINDSIGHT_URL is not set', async () => {
    // Only run this guard test if the URL is NOT set (normal CI)
    if (HAS_URL) return;
    const adapter = new HindsightAdapter({
      dataDir: mkdtempSync('/tmp/cgbench-hindsight-stub-'),
    });
    await expect(
      adapter.ingest({ codeRoots: [{ language: 'typescript', path: FIXTURE, commitSha: 'test' }] }),
    ).rejects.toThrow(/BLOCKED/);
  });

  it('throws BLOCKED on query when HINDSIGHT_URL is not set', async () => {
    if (HAS_URL) return;
    const adapter = new HindsightAdapter({
      dataDir: mkdtempSync('/tmp/cgbench-hindsight-stub-'),
    });
    await expect(adapter.query('retry function')).rejects.toThrow(/BLOCKED/);
  });
});

describe.skipIf(!HAS_URL)('HindsightAdapter smoke (requires HINDSIGHT_URL + running Docker)', () => {
  const dataDir = mkdtempSync('/tmp/cgbench-hindsight-');
  const adapter = new HindsightAdapter({ dataDir });

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
  }, 60_000);
});
