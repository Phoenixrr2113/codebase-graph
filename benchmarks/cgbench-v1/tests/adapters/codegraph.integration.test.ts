import { describe, expect, it, afterAll } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { CodeGraphAdapter } from '../../src/adapters/codegraph.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '../../fixtures/code/tiny-ts');

describe('CodeGraphAdapter — ingest', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'cgbench-cg-'));
  const adapter = new CodeGraphAdapter({ dataDir });
  afterAll(async () => {
    await adapter.destroy().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('ingests fixture corpus and returns non-zero stats', async () => {
    const stats = await adapter.ingest({
      codeRoots: [{ language: 'typescript', path: FIXTURE, commitSha: 'fixture' }],
    });
    expect(stats.durationMs).toBeGreaterThan(0);
    expect(stats.totalDocs).toBeGreaterThan(0);
    expect(stats.diskBytesAfter).toBeGreaterThan(0);
  }, 90_000);

  it('returns ranked results that include the retry function', async () => {
    const results = await adapter.query('function that retries failed requests', { topK: 10 });
    expect(results.length).toBeGreaterThan(0);
    const ids = results.map((r) => r.id);
    const hasRetry = ids.some((id) => /retry/i.test(id));
    expect(hasRetry).toBe(true);
  }, 60_000);

  it('destroy removes data dir and closes the client', async () => {
    const localDir = mkdtempSync(join('/tmp', 'cg-dst-'));
    const a = new CodeGraphAdapter({ dataDir: localDir });
    await a.ingest({
      codeRoots: [{ language: 'typescript', path: FIXTURE, commitSha: 'fixture' }],
    });
    await a.destroy();
    expect(existsSync(localDir)).toBe(false);
  }, 60_000);
});
