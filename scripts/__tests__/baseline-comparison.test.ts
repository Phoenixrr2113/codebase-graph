// scripts/__tests__/baseline-comparison.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findComparisonBaseline, type RunMeta } from '../check-index-health.js';

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
});
