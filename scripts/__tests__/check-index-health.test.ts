import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { checkIndexHealth, type HealthCheckResult } from '../check-index-health.js';
import { checkFalkorDBReachable, checkEmbeddingDim, checkScriptsExclusion, checkRerankerExplicit, checkBaselineConfigMatches } from '../check-index-health.js';
import type { RunMeta } from '../check-index-health.js';
import { createClient } from '../../packages/graph/dist/index.js';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('checkIndexHealth', () => {
  it('returns a HealthCheckResult shape', async () => {
    const result: HealthCheckResult = await checkIndexHealth({ requireIndex: false });
    expect(result).toHaveProperty('checks');
    expect(result).toHaveProperty('hasFailures');
    expect(result).toHaveProperty('hasWarnings');
    expect(Array.isArray(result.checks)).toBe(true);
    expect(result.hasFailures).toBe(false);
    expect(result.hasWarnings).toBe(false);
  });
});

describe('Check 1: FalkorDB reachable', () => {
  it('passes against a live FalkorDB Docker', async () => {
    const result = await checkFalkorDBReachable({
      host: process.env['FALKORDB_HOST'] ?? 'localhost',
      port: Number(process.env['FALKORDB_PORT'] ?? '6379'),
    });
    expect(result.status).toBe('pass');
    expect(result.name).toBe('falkordb-reachable');
  });

  it('fails with fix message when host is unreachable', async () => {
    const result = await checkFalkorDBReachable({
      host: 'localhost',
      port: 64999,  // intentionally closed port
    });
    expect(result.status).toBe('fail');
    expect(result.message).toMatch(/not reachable/i);
    expect(result.fix).toMatch(/docker run/);
    expect(result.fix).toMatch(/64999/);
  });
});

describe('Check 2: Embedding dim matches', () => {
  const tempGraph = `embdim-test-${randomBytes(4).toString('hex')}`;
  let client: Awaited<ReturnType<typeof createClient>>;

  beforeAll(async () => {
    client = await createClient({
      driver: 'falkordb',
      host: process.env['FALKORDB_HOST'] ?? 'localhost',
      port: Number(process.env['FALKORDB_PORT'] ?? '6379'),
      graphName: tempGraph,
    });
  });

  afterAll(async () => {
    await client.graph?.delete().catch(() => undefined);
    await client.close();
  });

  afterEach(async () => {
    await client.query('MATCH (n) DETACH DELETE n', { params: {} });
  });

  it('passes when index dim matches voyage (1024)', async () => {
    const e = Array.from({ length: 1024 }, () => 0.1);
    await client.query('CREATE (:Function {name: $n, embedding: vecf32($e)})', { params: { n: 'foo', e } });
    const result = await checkEmbeddingDim(client, 'voyage');
    expect(result.status).toBe('pass');
  });

  it('fails with fix message when index dim is wrong', async () => {
    const e = Array.from({ length: 768 }, () => 0.1);  // local-sized embedding
    await client.query('CREATE (:Function {name: $n, embedding: vecf32($e)})', { params: { n: 'foo', e } });
    const result = await checkEmbeddingDim(client, 'voyage');
    expect(result.status).toBe('fail');
    expect(result.message).toMatch(/768.*1024|1024.*768/);
    expect(result.fix).toMatch(/clear-and-reindex/);
  });

  it('fails when no embeddings exist (requireIndex=true case)', async () => {
    await client.query('MATCH (n) DETACH DELETE n', { params: {} });
    const result = await checkEmbeddingDim(client, 'voyage');
    expect(result.status).toBe('fail');
    expect(result.message).toMatch(/no embeddings/i);
  });
});

import { checkEmbeddingCoverage } from '../check-index-health.js';

describe('Check 3: Embedding coverage per label', () => {
  const tempGraph = `cov-test-${randomBytes(4).toString('hex')}`;
  let client: Awaited<ReturnType<typeof createClient>>;

  beforeAll(async () => {
    client = await createClient({
      driver: 'falkordb',
      host: process.env['FALKORDB_HOST'] ?? 'localhost',
      port: Number(process.env['FALKORDB_PORT'] ?? '6379'),
      graphName: tempGraph,
    });
  });

  afterAll(async () => {
    await client.graph?.delete().catch(() => undefined);
    await client.close();
  });

  afterEach(async () => {
    await client.query('MATCH (n) DETACH DELETE n', { params: {} });
  });

  it('passes when all nodes have embeddings', async () => {
    const e = Array.from({ length: 1024 }, () => 0.1);
    await client.query(
      'CREATE (:Function {name: "a", embedding: vecf32($e)}), (:Function {name: "b", embedding: vecf32($e)})',
      { params: { e } },
    );
    const result = await checkEmbeddingCoverage(client, ['Function']);
    expect(result.status).toBe('pass');
  });

  it('warns when >10% of nodes for a label are missing embeddings', async () => {
    const e = Array.from({ length: 1024 }, () => 0.1);
    // 1 with, 2 without — 67% missing
    await client.query(
      'CREATE (:Class {name: "a", embedding: vecf32($e)}), (:Class {name: "b"}), (:Class {name: "c"})',
      { params: { e } },
    );
    const result = await checkEmbeddingCoverage(client, ['Class']);
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/Class.*2\/3/);
  });
});

describe('Check 5: Reranker explicitly set', () => {
  it('warns when CODEGRAPH_RERANK_PROVIDER is unset', () => {
    const result = checkRerankerExplicit({});
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/0\.969 baseline used Jina/);
  });

  it('warns when set to "none"', () => {
    const result = checkRerankerExplicit({ CODEGRAPH_RERANK_PROVIDER: 'none' });
    expect(result.status).toBe('warn');
  });

  it('passes when set to a real provider', () => {
    const result = checkRerankerExplicit({ CODEGRAPH_RERANK_PROVIDER: 'jina' });
    expect(result.status).toBe('pass');
  });
});

describe('Check 4: scripts/ excluded', () => {
  const tempGraph = `scripts-excl-test-${randomBytes(4).toString('hex')}`;
  let client: Awaited<ReturnType<typeof createClient>>;

  beforeAll(async () => {
    client = await createClient({
      driver: 'falkordb',
      host: process.env['FALKORDB_HOST'] ?? 'localhost',
      port: Number(process.env['FALKORDB_PORT'] ?? '6379'),
      graphName: tempGraph,
    });
  });

  afterAll(async () => {
    await client.graph?.delete().catch(() => undefined);
    await client.close();
  });

  afterEach(async () => {
    await client.query('MATCH (n) DETACH DELETE n', { params: {} });
  });

  it('passes when no scripts/ nodes exist', async () => {
    await client.query(
      'CREATE (:Function {filePath: "packages/core/src/foo.ts", name: "foo"})',
      { params: {} },
    );
    const result = await checkScriptsExclusion(client);
    expect(result.status).toBe('pass');
  });

  it('fails with fix message when scripts/ nodes leak in', async () => {
    await client.query(
      'CREATE (:Function {filePath: "scripts/benchmark-search.ts", name: "calculateMRR"}), (:Function {filePath: "scripts/foo.ts", name: "bar"})',
      { params: {} },
    );
    const result = await checkScriptsExclusion(client);
    expect(result.status).toBe('fail');
    expect(result.message).toMatch(/2 nodes/);
    expect(result.fix).toMatch(/regression-analysis-2026-03-19/);
  });
});

describe('Check 6: Provider config matches baseline', () => {
  const META_VOYAGE_JINA: RunMeta = {
    embeddingProvider: 'voyage',
    embeddingModel: 'voyage-3-large',
    embeddingDim: 1024,
    rerankerProvider: 'jina',
    rerankerModel: 'jina-reranker-v2-base-multilingual',
    llmProvider: 'cerebras',
    llmModel: 'qwen-3-235b-a22b-instruct-2507',
    gitSha: 'abc123',
    gitDirty: false,
    corpusNodeCount: 2310,
  };
  const META_OPENROUTER: RunMeta = { ...META_VOYAGE_JINA, embeddingProvider: 'openrouter', embeddingModel: 'text-embedding-3-small', embeddingDim: 1536 };

  it('passes when no comparable baseline exists (this run becomes new reference)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check6-'));
    try {
      const result = checkBaselineConfigMatches({
        currentMeta: META_VOYAGE_JINA,
        baselineDir: dir,
        explicitBaselinePath: undefined,
      });
      expect(result.status).toBe('pass');
      expect(result.message).toMatch(/no comparable baseline/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('passes when baseline metadata matches current run', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check6-'));
    try {
      writeFileSync(join(dir, 'baseline.json'), JSON.stringify({ label: 'b', meta: META_VOYAGE_JINA, results: [] }));
      const result = checkBaselineConfigMatches({
        currentMeta: META_VOYAGE_JINA,
        baselineDir: dir,
        explicitBaselinePath: undefined,
      });
      expect(result.status).toBe('pass');
      expect(result.message).toMatch(/Baseline config matches/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails with both options in fix message when configs disagree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check6-'));
    try {
      const baselinePath = join(dir, 'baseline.json');
      writeFileSync(baselinePath, JSON.stringify({ label: 'b', meta: META_OPENROUTER, results: [] }));
      const result = checkBaselineConfigMatches({
        currentMeta: META_VOYAGE_JINA,
        baselineDir: dir,
        explicitBaselinePath: baselinePath,  // explicit forces match attempt
      });
      expect(result.status).toBe('fail');
      expect(result.message).toMatch(/Cannot compare apples-to-apples/);
      expect(result.fix).toMatch(/--compare-against/);
      expect(result.fix).toMatch(/--no-compare/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails with helpful message when explicit baseline file lacks meta field', () => {
    const dir = mkdtempSync(join(tmpdir(), 'check6-'));
    try {
      const baselinePath = join(dir, 'legacy.json');
      writeFileSync(baselinePath, JSON.stringify({ label: 'b', results: [] }));  // no meta
      const result = checkBaselineConfigMatches({
        currentMeta: META_VOYAGE_JINA,
        baselineDir: dir,
        explicitBaselinePath: baselinePath,
      });
      expect(result.status).toBe('fail');
      expect(result.message).toMatch(/no meta field/i);
      expect(result.fix).toMatch(/--no-compare/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
