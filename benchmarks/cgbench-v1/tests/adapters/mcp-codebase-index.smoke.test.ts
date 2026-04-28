import { describe, expect, it, afterAll } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { McpCodebaseIndexAdapter } from '../../src/adapters/mcp-codebase-index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '../../fixtures/code/tiny-ts');

describe('McpCodebaseIndexAdapter smoke', () => {
  // Use /tmp directly to avoid any path-length issues
  const dataDir = mkdtempSync('/tmp/cgbench-mcp-codebase-index-');
  const adapter = new McpCodebaseIndexAdapter({ dataDir });

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
  }, 90_000);

  it('returns ranked results for a retry query', async () => {
    const results = await adapter.query('function that retries failed requests', { topK: 10 });
    expect(results.length).toBeGreaterThan(0);
    // retry.ts should appear in results
    const hasRetry = results.some((r) => r.id.includes('retry'));
    expect(hasRetry).toBe(true);
  }, 60_000);

  it('result IDs follow the <basename>#<symbol> format', async () => {
    const results = await adapter.query('authentication token', { topK: 5 });
    for (const r of results) {
      expect(r.id).toMatch(/^.+#.+$/);
      expect(typeof r.score).toBe('number');
      expect(r.kind).toBe('code');
    }
  }, 60_000);
});
