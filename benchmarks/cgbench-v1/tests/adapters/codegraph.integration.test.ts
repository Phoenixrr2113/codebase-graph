import { describe, expect, it, afterAll } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { CodeGraphAdapter } from '../../src/adapters/codegraph.js';

// Detect whether the local HuggingFace transformer can load.
// The 'local' provider requires @huggingface/transformers which downloads
// ~140MB on first run. Skip the vector test suite in environments where this
// is known to fail (e.g., CI without HF cache, memory-constrained runners).
const skipVector = process.env['CGBENCH_SKIP_VECTOR'] === '1';

// Detect whether an LLM is available for entity extraction.
// documentIngestion.add() requires a configured LLM to produce Entity nodes.
// Without one, chunks are processed but no entities are extracted, so
// knowledge-kind results cannot be asserted.
// Mirrors the provider resolution in @codegraph/plugin-nlp isLLMAvailable():
//   cerebras (default) requires CEREBRAS_API_KEY
//   openrouter requires OPENROUTER_API_KEY
//   ollama is always available (no key needed)
const llmAvailable = ((): boolean => {
  const provider = process.env['LLM_PROVIDER']?.toLowerCase();
  if (provider === 'ollama') return true;
  if (provider === 'openrouter') return !!process.env['OPENROUTER_API_KEY'];
  if (provider === 'cerebras') return !!process.env['CEREBRAS_API_KEY'];
  // default: cerebras first, then openrouter
  return !!process.env['CEREBRAS_API_KEY'] || !!process.env['OPENROUTER_API_KEY'];
})();

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_CODE = join(__dirname, '../../fixtures/code/tiny-ts');
const KNOWLEDGE_DIR = join(__dirname, '../../corpora/knowledge');
const DOCUMENTS_DIR = join(__dirname, '../../documents/source');

describe('CodeGraphAdapter — ingest', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'cgbench-cg-'));
  const adapter = new CodeGraphAdapter({ dataDir });
  afterAll(async () => {
    await adapter.destroy().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('ingests fixture corpus and returns non-zero stats', async () => {
    const stats = await adapter.ingest({
      codeRoots: [{ language: 'typescript', path: FIXTURE_CODE, commitSha: 'fixture' }],
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
      codeRoots: [{ language: 'typescript', path: FIXTURE_CODE, commitSha: 'fixture' }],
    });
    await a.destroy();
    expect(existsSync(localDir)).toBe(false);
  }, 60_000);
});

describe('CodeGraphAdapter — code + knowledge ingest', () => {
  const dataDir = mkdtempSync(join('/tmp', 'cgk-'));
  const adapter = new CodeGraphAdapter({ dataDir });
  afterAll(async () => {
    await adapter.destroy().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('ingests code root with knowledgeRoot provided (knowledgeRoot is a no-op in new ingest path)', async () => {
    // knowledgeRoot is no longer processed by the adapter — documentIngestion.add()
    // replaced the old createEntity() path; knowledge ingest now happens via documentRoot.
    const stats = await adapter.ingest({
      codeRoots: [{ language: 'typescript', path: FIXTURE_CODE, commitSha: 'fixture' }],
      knowledgeRoot: KNOWLEDGE_DIR,
    });
    // Only code files counted — knowledgeRoot is ignored
    expect(stats.totalDocs).toBeGreaterThan(0);
    expect(stats.durationMs).toBeGreaterThan(0);

    // Code results should still surface
    const results = await adapter.query('retry policy decision', { topK: 10 });
    expect(results.length).toBeGreaterThan(0);
  }, 90_000);
});

describe('CodeGraphAdapter — document corpus ingest', () => {
  const dataDir = mkdtempSync(join('/tmp', 'cgd-'));
  const adapter = new CodeGraphAdapter({ dataDir, documentFormat: 'md' });
  afterAll(async () => {
    await adapter.destroy().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('ingests document corpus via documentIngestion.add() and returns non-zero stats', async () => {
    // documentIngestion.add() handles all formats (md, html, csv, pdf, docx, URLs).
    // Entity extraction requires an LLM — without one, chunks are processed but produce
    // 0 entities. The ingest succeeds and stats reflect files processed.
    const stats = await adapter.ingest({
      codeRoots: [{ language: 'typescript', path: FIXTURE_CODE, commitSha: 'fixture' }],
      documentRoot: DOCUMENTS_DIR,
    });
    // 3 code files + N document files counted by totalDocs
    expect(stats.totalDocs).toBeGreaterThan(3);
    expect(stats.durationMs).toBeGreaterThan(0);
    // diskBytesAfter > 0 confirms the loader+chunker pipeline ran and wrote to the graph
    expect(stats.diskBytesAfter).toBeGreaterThan(0);

    // Code results should still surface (entity extraction does not affect code index)
    const results = await adapter.query('Q1 retro date', { topK: 10 });
    expect(results.length).toBeGreaterThan(0);

    // When an LLM is available, entity extraction runs and knowledge-kind results
    // should surface. fact-001.md contains the Q1 retro date "2026-04-15".
    if (llmAvailable) {
      const knowledgeResults = results.filter((r) => r.kind === 'knowledge');
      expect(knowledgeResults.length, 'expected knowledge-kind results when LLM is available').toBeGreaterThan(0);
      const ids = knowledgeResults.map((r) => r.id);
      const hasFact001 = ids.some((id) => id.includes('fact-001'));
      expect(hasFact001, `fact-001 not found in knowledge results; got: ${ids.join(', ')}`).toBe(true);
    }
  }, 90_000);

  it('accepts pdf documentFormat without throwing (add() handles all formats)', async () => {
    // The old DEFERRED throw has been removed — documentIngestion.add() supports pdf natively.
    const binDir = mkdtempSync(join('/tmp', 'cgd-pdf-'));
    const binAdapter = new CodeGraphAdapter({ dataDir: binDir, documentFormat: 'pdf' });
    try {
      const stats = await binAdapter.ingest({
        codeRoots: [{ language: 'typescript', path: FIXTURE_CODE, commitSha: 'fixture' }],
        documentRoot: DOCUMENTS_DIR,
      });
      expect(stats.totalDocs).toBeGreaterThan(0);
    } finally {
      await binAdapter.destroy().catch(() => {});
      rmSync(binDir, { recursive: true, force: true });
    }
  }, 90_000);
});

describe.skipIf(skipVector)('CodeGraphAdapter — vector+reranker query path', () => {
  // Uses the local HuggingFace transformer provider (nomic-ai/nomic-embed-text-v1.5).
  // No API key required. First run downloads ~140MB model to ~/.cache/huggingface.
  // Reranker is disabled (rerankerProvider: 'none') — vector similarity scores only.
  // Use /tmp directly — macOS tmpdir() path is too long for FalkorDBLite's Unix socket
  const dataDir = mkdtempSync('/tmp/cgbench-cg-vec-');
  // v2 adapter: embedding/reranker config is passed via env to the MCP subprocess.
  // CODEGRAPH_EMBEDDING_PROVIDER and CODEGRAPH_RERANK_PROVIDER env vars control this.
  const adapter = new CodeGraphAdapter({ dataDir });
  afterAll(async () => {
    await adapter.destroy().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('ingests fixture with embeddings and vector-queries the retry function into top 3', async () => {
    await adapter.ingest({
      codeRoots: [{ language: 'typescript', path: FIXTURE_CODE, commitSha: 'fixture' }],
    });

    const results = await adapter.query('function that retries failed requests', { topK: 10 });
    expect(results.length).toBeGreaterThan(0);

    const ids = results.map((r) => r.id);
    // The retry function should rank highly with vector embeddings
    const retryIdx = ids.findIndex((id) => /retry/i.test(id));
    expect(retryIdx, `retry not found in results; got: ${ids.join(', ')}`).toBeGreaterThanOrEqual(0);
    expect(retryIdx, `retry ranked at ${retryIdx}, expected top 3`).toBeLessThan(3);
  }, 180_000);
});
