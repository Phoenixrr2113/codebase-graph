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

  it('ingests code + knowledge and queries surface both kinds', async () => {
    const stats = await adapter.ingest({
      codeRoots: [{ language: 'typescript', path: FIXTURE_CODE, commitSha: 'fixture' }],
      knowledgeRoot: KNOWLEDGE_DIR,
    });
    // 3 code files + 10 knowledge files = > 3
    expect(stats.totalDocs).toBeGreaterThan(3);

    // knowledge-001.md is about "retry policy decision" — query should surface it
    const results = await adapter.query('retry policy decision', { topK: 10 });
    expect(results.length).toBeGreaterThan(0);

    // At least one knowledge result should be present
    const knowledgeResults = results.filter((r) => r.kind === 'knowledge');
    expect(knowledgeResults.length).toBeGreaterThan(0);

    // The knowledge-001 document should appear with correct ID format
    const ids = knowledgeResults.map((r) => r.id);
    const hasKnowledge001 = ids.some((id) => id.includes('knowledge-001'));
    expect(hasKnowledge001).toBe(true);
  }, 90_000);
});

describe('CodeGraphAdapter — document corpus ingest', () => {
  const dataDir = mkdtempSync(join('/tmp', 'cgd-'));
  const adapter = new CodeGraphAdapter({ dataDir, documentFormat: 'md' });
  afterAll(async () => {
    await adapter.destroy().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('ingests document corpus and queries surface fact content', async () => {
    const stats = await adapter.ingest({
      codeRoots: [{ language: 'typescript', path: FIXTURE_CODE, commitSha: 'fixture' }],
      documentRoot: DOCUMENTS_DIR,
    });
    // 3 code files + 10 fact docs = > 3
    expect(stats.totalDocs).toBeGreaterThan(3);

    // fact-001.md contains the Q1 retro date "2026-04-15"
    const results = await adapter.query('Q1 retro date', { topK: 10 });
    expect(results.length).toBeGreaterThan(0);

    // At least one knowledge result (document entity) should surface
    const knowledgeResults = results.filter((r) => r.kind === 'knowledge');
    expect(knowledgeResults.length).toBeGreaterThan(0);

    // fact-001 document should appear with correct ID format <stem>#<stem>
    const ids = knowledgeResults.map((r) => r.id);
    const hasFact001 = ids.some((id) => id.includes('fact-001'));
    expect(hasFact001).toBe(true);
  }, 90_000);

  it('throws for deferred binary formats (pdf)', async () => {
    const binDir = mkdtempSync(join('/tmp', 'cgd-pdf-'));
    const binAdapter = new CodeGraphAdapter({ dataDir: binDir, documentFormat: 'pdf' });
    try {
      await expect(
        binAdapter.ingest({
          codeRoots: [{ language: 'typescript', path: FIXTURE_CODE, commitSha: 'fixture' }],
          documentRoot: DOCUMENTS_DIR,
        }),
      ).rejects.toThrow(/DEFERRED/);
    } finally {
      await binAdapter.destroy().catch(() => {});
      rmSync(binDir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe.skipIf(skipVector)('CodeGraphAdapter — vector+reranker query path', () => {
  // Uses the local HuggingFace transformer provider (nomic-ai/nomic-embed-text-v1.5).
  // No API key required. First run downloads ~140MB model to ~/.cache/huggingface.
  // Reranker is disabled (rerankerProvider: 'none') — vector similarity scores only.
  // Use /tmp directly — macOS tmpdir() path is too long for FalkorDBLite's Unix socket
  const dataDir = mkdtempSync('/tmp/cgbench-cg-vec-');
  const adapter = new CodeGraphAdapter({
    dataDir,
    embeddingProvider: 'local',
    rerankerProvider: 'none',
  });
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
