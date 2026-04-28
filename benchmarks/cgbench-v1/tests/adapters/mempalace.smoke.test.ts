import { describe, expect, it, afterAll } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { MempalaceAdapter } from '../../src/adapters/mempalace.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '../../fixtures/code/tiny-ts');

describe('MempalaceAdapter smoke', () => {
  // Use /tmp directly to avoid macOS Unix-socket path-length issues with chromadb
  const dataDir = mkdtempSync('/tmp/cgbench-mempalace-');
  const adapter = new MempalaceAdapter({ dataDir });

  afterAll(async () => {
    await adapter.destroy().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('ingests fixture and returns non-zero stats', async () => {
    const stats = await adapter.ingest({
      codeRoots: [{ language: 'typescript', path: FIXTURE, commitSha: 'fixture' }],
    });
    expect(stats.durationMs).toBeGreaterThan(0);
    expect(stats.totalDocs).toBeGreaterThan(0);
    expect(stats.diskBytesAfter).toBeGreaterThan(0);
  }, 120_000);

  it('returns ranked results for a retry query', async () => {
    const results = await adapter.query('function that retries failed requests', { topK: 10 });
    expect(results.length).toBeGreaterThan(0);
    // retry.ts should be near the top
    const topId = results[0]?.id ?? '';
    expect(topId).toContain('retry');
  }, 60_000);

  it('result IDs follow the <basename>#<basename> format', async () => {
    const results = await adapter.query('authentication token', { topK: 5 });
    for (const r of results) {
      expect(r.id).toMatch(/^.+#.+$/);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
      expect(r.kind).toBe('code');
    }
  }, 60_000);
});
