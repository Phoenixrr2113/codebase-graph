// scripts/__tests__/baseline-comparison.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findComparisonBaseline, computeDiff, printDiffTable, type RunMeta, type BenchmarkRow } from '../check-index-health.js';

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

const META_OPENROUTER: RunMeta = {
  ...META_VOYAGE_JINA,
  embeddingProvider: 'openrouter',
  embeddingModel: 'text-embedding-3-small',
  embeddingDim: 1536,
};

function makeBaselineFile(dir: string, name: string, meta: RunMeta | null, mtime: number): void {
  const filepath = join(dir, name);
  const body = meta === null
    ? { label: name, results: [] }  // legacy without meta
    : { label: name, meta, results: [] };
  writeFileSync(filepath, JSON.stringify(body));
  utimesSync(filepath, mtime / 1000, mtime / 1000);
}

describe('findComparisonBaseline', () => {
  it('returns null when directory has no matching baseline', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baseline-test-'));
    try {
      makeBaselineFile(dir, 'a.json', META_OPENROUTER, Date.now() - 1000);
      const result = findComparisonBaseline(dir, META_VOYAGE_JINA);
      expect(result).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when directory has only pre-meta legacy files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baseline-test-'));
    try {
      makeBaselineFile(dir, 'legacy.json', null, Date.now() - 1000);
      const result = findComparisonBaseline(dir, META_VOYAGE_JINA);
      expect(result).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('picks the most recent matching baseline', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baseline-test-'));
    try {
      makeBaselineFile(dir, 'old.json', META_VOYAGE_JINA, Date.now() - 60000);
      makeBaselineFile(dir, 'new.json', META_VOYAGE_JINA, Date.now() - 1000);
      makeBaselineFile(dir, 'mismatch.json', META_OPENROUTER, Date.now());  // most recent but wrong config
      const result = findComparisonBaseline(dir, META_VOYAGE_JINA);
      expect(result).not.toBeNull();
      expect(result!.path).toMatch(/new\.json$/);
      expect(result!.meta.embeddingProvider).toBe('voyage');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips files with corrupt JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baseline-test-'));
    try {
      writeFileSync(join(dir, 'corrupt.json'), '{ this is not valid json');
      makeBaselineFile(dir, 'good.json', META_VOYAGE_JINA, Date.now());
      const result = findComparisonBaseline(dir, META_VOYAGE_JINA);
      expect(result).not.toBeNull();
      expect(result!.path).toMatch(/good\.json$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips files where meta is malformed (not an object)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baseline-test-'));
    try {
      writeFileSync(join(dir, 'malformed.json'), JSON.stringify({ label: 'm', meta: 42, results: [] }));
      writeFileSync(join(dir, 'array-meta.json'), JSON.stringify({ label: 'a', meta: [], results: [] }));
      makeBaselineFile(dir, 'good.json', META_VOYAGE_JINA, Date.now());
      const result = findComparisonBaseline(dir, META_VOYAGE_JINA);
      expect(result).not.toBeNull();
      expect(result!.path).toMatch(/good\.json$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('skips the excludePath even when it is the most recent match', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baseline-test-'));
    try {
      makeBaselineFile(dir, 'older.json', META_VOYAGE_JINA, Date.now() - 60000);
      makeBaselineFile(dir, 'newer.json', META_VOYAGE_JINA, Date.now() - 1000);
      const result = findComparisonBaseline(dir, META_VOYAGE_JINA, join(dir, 'newer.json'));
      expect(result).not.toBeNull();
      expect(result!.path).toMatch(/older\.json$/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when excludePath is the only match', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baseline-test-'));
    try {
      makeBaselineFile(dir, 'only.json', META_VOYAGE_JINA, Date.now());
      const result = findComparisonBaseline(dir, META_VOYAGE_JINA, join(dir, 'only.json'));
      expect(result).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const RESULTS_BASELINE: BenchmarkRow[] = [
  { query: 'q1', category: 'disambiguation', mrr: 1.0, ndcg5: 1.0, ndcg10: 1.0, success1: true, success5: true, recall10: 1.0, latencyMs: 400 },
  { query: 'q2', category: 'importance', mrr: 0.5, ndcg5: 0.6, ndcg10: 0.6, success1: false, success5: true, recall10: 0.8, latencyMs: 450 },
];

const RESULTS_CURRENT_NO_REGRESSION: BenchmarkRow[] = RESULTS_BASELINE.map((r) => ({ ...r }));

const RESULTS_CURRENT_REGRESSION: BenchmarkRow[] = [
  { query: 'q1', category: 'disambiguation', mrr: 1.0, ndcg5: 1.0, ndcg10: 1.0, success1: true, success5: true, recall10: 1.0, latencyMs: 400 },
  { query: 'q2', category: 'importance', mrr: 0.0, ndcg5: 0.0, ndcg10: 0.0, success1: false, success5: false, recall10: 0.0, latencyMs: 450 },
];

describe('computeDiff', () => {
  it('flags no regression when current matches baseline', () => {
    const diff = computeDiff(
      { results: RESULTS_BASELINE },
      { results: RESULTS_CURRENT_NO_REGRESSION },
      { threshold: 0.05 },
    );
    expect(diff.hasRegression).toBe(false);
    expect(diff.overallMrrDelta).toBeCloseTo(0, 5);
    expect(diff.perCategory.every((c) => !c.regressed)).toBe(true);
    expect(diff.perQueryRegressions).toEqual([]);
  });

  it('flags regression when a category MRR drops more than threshold', () => {
    const diff = computeDiff(
      { results: RESULTS_BASELINE },
      { results: RESULTS_CURRENT_REGRESSION },
      { threshold: 0.05 },
    );
    expect(diff.hasRegression).toBe(true);
    const importance = diff.perCategory.find((c) => c.category === 'importance');
    expect(importance?.delta).toBeCloseTo(-0.5, 5);
    expect(importance?.regressed).toBe(true);
    // Per-query regression for q2: 0.5 → 0.0, delta -0.5 (well past 10% threshold)
    expect(diff.perQueryRegressions).toHaveLength(1);
    expect(diff.perQueryRegressions[0]!.query).toBe('q2');
  });

  it('respects custom threshold', () => {
    const tinyDrop = RESULTS_BASELINE.map((r) => ({ ...r, mrr: r.mrr - 0.01 }));
    const diffStrict = computeDiff({ results: RESULTS_BASELINE }, { results: tinyDrop }, { threshold: 0.005 });
    const diffLoose = computeDiff({ results: RESULTS_BASELINE }, { results: tinyDrop }, { threshold: 0.05 });
    expect(diffStrict.hasRegression).toBe(true);
    expect(diffLoose.hasRegression).toBe(false);
  });

  it('computes overall NDCG@5, S@1, S@5, and latency p50 deltas', () => {
    const diff = computeDiff(
      { results: RESULTS_BASELINE },
      { results: RESULTS_CURRENT_REGRESSION },
      { threshold: 0.05 },
    );
    // Baseline avg ndcg5 = (1.0 + 0.6) / 2 = 0.8; current = (1.0 + 0.0) / 2 = 0.5; delta = -0.3
    expect(diff.overallNdcg5Delta).toBeCloseTo(-0.3, 5);
    // S@1: baseline (1+0)/2 = 0.5, current (1+0)/2 = 0.5, delta = 0
    expect(diff.overallS1Delta).toBeCloseTo(0, 5);
    // S@5: baseline (1+1)/2 = 1.0, current (1+0)/2 = 0.5, delta = -0.5
    expect(diff.overallS5Delta).toBeCloseTo(-0.5, 5);
    // Latency p50: baseline median(400, 450) = 425; current median(400, 450) = 425; delta = 0
    expect(diff.latencyP50Delta).toBe(0);
  });
});

const META_VOYAGE_JINA_FOR_DIFF: RunMeta = {
  embeddingProvider: 'voyage',
  embeddingModel: 'voyage-code-3',
  embeddingDim: 1024,
  rerankerProvider: 'jina',
  rerankerModel: 'jina-reranker-v2-base-multilingual',
  llmProvider: 'cerebras',
  llmModel: 'qwen-3-235b-a22b-instruct-2507',
  gitSha: 'abc12345abcdef',
  gitDirty: false,
  corpusNodeCount: 2310,
};

describe('printDiffTable', () => {
  it('renders header with baseline label, config match, git delta', () => {
    const diff = computeDiff({ results: RESULTS_BASELINE }, { results: RESULTS_CURRENT_REGRESSION }, { threshold: 0.05 });
    const lines = printDiffTable({
      baseline: { label: 'v6-chunk2-task4', timestamp: '2026-04-27T00:25:43Z', meta: META_VOYAGE_JINA_FOR_DIFF, results: RESULTS_BASELINE },
      current: { label: 'clean-rebuild-2026-04-30', meta: { ...META_VOYAGE_JINA_FOR_DIFF, gitSha: 'def45678abcdef' }, results: RESULTS_CURRENT_REGRESSION },
      diff,
    });
    const text = lines.join('\n');
    expect(text).toMatch(/v6-chunk2-task4/);
    expect(text).toMatch(/abc12345/);
    expect(text).toMatch(/def45678/);
    expect(text).toMatch(/voyage/);
    expect(text).toMatch(/jina/);
    expect(text).toMatch(/cerebras/);
  });

  it('flags REGRESSION on overall MRR drop beyond threshold', () => {
    const diff = computeDiff({ results: RESULTS_BASELINE }, { results: RESULTS_CURRENT_REGRESSION }, { threshold: 0.05 });
    const lines = printDiffTable({
      baseline: { label: 'b', timestamp: 't', meta: META_VOYAGE_JINA_FOR_DIFF, results: RESULTS_BASELINE },
      current: { label: 'c', meta: META_VOYAGE_JINA_FOR_DIFF, results: RESULTS_CURRENT_REGRESSION },
      diff,
    });
    expect(lines.join('\n')).toMatch(/REGRESSION/);
  });

  it('lists per-query regressions when any exceed 10% drop', () => {
    const diff = computeDiff({ results: RESULTS_BASELINE }, { results: RESULTS_CURRENT_REGRESSION }, { threshold: 0.05 });
    const lines = printDiffTable({
      baseline: { label: 'b', timestamp: 't', meta: META_VOYAGE_JINA_FOR_DIFF, results: RESULTS_BASELINE },
      current: { label: 'c', meta: META_VOYAGE_JINA_FOR_DIFF, results: RESULTS_CURRENT_REGRESSION },
      diff,
    });
    expect(lines.join('\n')).toMatch(/q2/);
  });

  it('shows "no regression detected" when there are none', () => {
    const diff = computeDiff({ results: RESULTS_BASELINE }, { results: RESULTS_CURRENT_NO_REGRESSION }, { threshold: 0.05 });
    const lines = printDiffTable({
      baseline: { label: 'b', timestamp: 't', meta: META_VOYAGE_JINA_FOR_DIFF, results: RESULTS_BASELINE },
      current: { label: 'c', meta: META_VOYAGE_JINA_FOR_DIFF, results: RESULTS_CURRENT_NO_REGRESSION },
      diff,
    });
    const text = lines.join('\n');
    expect(text).not.toMatch(/REGRESSION/);
    expect(text).toMatch(/no regression detected/i);
  });

  it('respects custom threshold for overall REGRESSION flag', () => {
    const tinyDrop = RESULTS_BASELINE.map((r) => ({ ...r, mrr: r.mrr - 0.03 }));
    const diff = computeDiff({ results: RESULTS_BASELINE }, { results: tinyDrop }, { threshold: 0.10 });
    // 0.03 drop is below the strict 0.10 threshold; should NOT flag
    const linesLoose = printDiffTable({
      baseline: { label: 'b', timestamp: 't', meta: META_VOYAGE_JINA_FOR_DIFF, results: RESULTS_BASELINE },
      current: { label: 'c', meta: META_VOYAGE_JINA_FOR_DIFF, results: tinyDrop },
      diff,
      threshold: 0.10,
    });
    expect(linesLoose.join('\n')).not.toMatch(/REGRESSION/);
  });
});
