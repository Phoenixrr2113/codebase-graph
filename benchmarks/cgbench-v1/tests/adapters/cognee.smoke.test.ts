import { describe, expect, it, afterAll } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { CogneeAdapter } from '../../src/adapters/cognee.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '../../fixtures/code/tiny-ts');

// Probe Ollama at module load — synchronous skip-decision via top-level await (ESM).
const HAS_OLLAMA = await (async () => {
  try {
    const res = await fetch('http://localhost:11434/api/tags');
    return res.ok;
  } catch {
    return false;
  }
})();

describe.skipIf(!HAS_OLLAMA)('CogneeAdapter smoke (requires local Ollama)', () => {
  const dataDir = mkdtempSync('/tmp/cgbench-cognee-');
  const adapter = new CogneeAdapter({ dataDir });

  afterAll(async () => {
    await adapter.destroy().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('ingests fixture corpus + queries return results', async () => {
    const stats = await adapter.ingest({
      codeRoots: [{ language: 'typescript', path: FIXTURE, commitSha: 'fixture' }],
    });
    expect(stats.totalDocs).toBeGreaterThan(0);
    expect(stats.durationMs).toBeGreaterThan(0);
    expect(stats.diskBytesAfter).toBeGreaterThan(0);

    const results = await adapter.query('function that retries failed requests', { topK: 10 });
    expect(results.length).toBeGreaterThan(0);

    // Log result IDs for visibility
    console.log('cognee retry query result IDs:', results.map((r) => r.id));

    expect(results[0]).toBeDefined();
    expect(results[0]?.score).toBeGreaterThanOrEqual(0);
    expect(results[0]?.kind).toMatch(/^(code|knowledge)$/);
  }, 600_000); // 10 min — cognify makes LLM calls per chunk; qwen3.5:9b on M-series ~10-30 min
});
