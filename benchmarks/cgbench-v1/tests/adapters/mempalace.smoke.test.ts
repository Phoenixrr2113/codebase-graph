import { describe, expect, it, afterAll } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { MempalaceAdapter } from '../../src/adapters/mempalace.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '../../fixtures/code/tiny-ts');
const KNOWLEDGE_DIR = join(__dirname, '../../corpora/knowledge');

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

  // Knowledge-ingest test: gated on the corpora/knowledge directory existing.
  // Verifies that ingesting a corpus with knowledgeRoot does not crash and that
  // querying for knowledge content returns results with bare-stem IDs.
  it.skipIf(!existsSync(KNOWLEDGE_DIR))(
    'ingests knowledge corpus without crash',
    async () => {
      const knowledgeDataDir = mkdtempSync('/tmp/cgbench-mempalace-know-');
      const knowledgeAdapter = new MempalaceAdapter({ dataDir: knowledgeDataDir });
      try {
        const stats = await knowledgeAdapter.ingest({
          codeRoots: [{ language: 'typescript', path: FIXTURE, commitSha: 'fixture' }],
          knowledgeRoot: KNOWLEDGE_DIR,
        });
        // 3 code files from tiny-ts + 10 knowledge docs
        expect(stats.totalDocs).toBeGreaterThan(3);
      } finally {
        await knowledgeAdapter.destroy().catch(() => {});
        rmSync(knowledgeDataDir, { recursive: true, force: true });
      }
    },
    120_000,
  );

  it.skipIf(!existsSync(KNOWLEDGE_DIR))(
    'knowledge results use bare-stem IDs (e.g. knowledge-001)',
    async () => {
      const knowledgeDataDir = mkdtempSync('/tmp/cgbench-mempalace-know2-');
      const knowledgeAdapter = new MempalaceAdapter({ dataDir: knowledgeDataDir });
      try {
        await knowledgeAdapter.ingest({
          codeRoots: [{ language: 'typescript', path: FIXTURE, commitSha: 'fixture' }],
          knowledgeRoot: KNOWLEDGE_DIR,
        });
        // Query for a topic covered by the knowledge corpus
        const results = await knowledgeAdapter.query('HTTP retry policy requests library', { topK: 10 });
        expect(results.length).toBeGreaterThan(0);
        // At least one result should be a bare-stem ID (no '#') — a knowledge result
        const knowledgeResults = results.filter((r) => !r.id.includes('#'));
        expect(knowledgeResults.length).toBeGreaterThan(0);
        // knowledge IDs should look like "knowledge-NNN"
        for (const r of knowledgeResults) {
          expect(r.id).toMatch(/^knowledge-\d+$/);
          expect(r.kind).toBe('knowledge');
        }
      } finally {
        await knowledgeAdapter.destroy().catch(() => {});
        rmSync(knowledgeDataDir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
