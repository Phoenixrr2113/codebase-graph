import { describe, expect, it } from 'vitest';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { aggregate } from '../src/aggregator.js';
import type { RunResult } from '../src/runner.js';

function makeTmpDir(): string {
  const dir = join('/tmp', `agg-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeResult(overrides: Partial<RunResult> = {}): RunResult {
  return {
    system: 'codegraph',
    questionCount: 12,
    tasks: {
      A: { task: 'A', count: 12, mrr: 0.85, recallAt10: 0.92 },
    },
    latency: {
      all: { count: 12, p50: 50, p95: 200, p99: 300, mean: 100, min: 30, max: 350 },
      cold: { count: 2, p50: 120, p95: 300, p99: 300, mean: 150, min: 100, max: 300 },
      warm: { count: 10, p50: 45, p95: 190, p99: 290, mean: 90, min: 30, max: 290 },
    },
    ingestion: { durationMs: 5000, totalDocs: 3, totalTokens: 100, diskBytesAfter: 1000, tokensPerSecond: 20 },
    ...overrides,
  };
}

describe('aggregator', () => {
  it('combines a single per-system result into a summary', () => {
    const tmp = makeTmpDir();
    try {
      const result = makeResult();
      const path = join(tmp, 'codegraph.json');
      writeFileSync(path, JSON.stringify(result));

      const summary = aggregate({
        perSystemFiles: [{ system: 'codegraph', path }],
      });

      expect(summary.systems).toEqual(['codegraph']);
      expect(summary.perTask.A?.['codegraph']?.mrr).toBe(0.85);
      expect(summary.perTask.A?.['codegraph']?.recallAt10).toBe(0.92);
      expect(summary.perSystemLatency['codegraph']?.p50).toBe(50);
      expect(summary.perSystemLatency['codegraph']?.p95).toBe(200);
      expect(summary.perSystemLatency['codegraph']?.p99).toBe(300);
      expect(summary.perSystemLatency['codegraph']?.mean).toBe(100);
      expect(summary.perSystemIngestion['codegraph']?.durationMs).toBe(5000);
      expect(summary.perSystemIngestion['codegraph']?.tokensPerSecond).toBe(20);
      expect(summary.perSystemIngestion['codegraph']?.totalDocs).toBe(3);
      expect(summary.caveats).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('combines two per-system results with different task coverage', () => {
    const tmp = makeTmpDir();
    try {
      const cgResult = makeResult({
        system: 'codegraph',
        tasks: {
          A: { task: 'A', count: 10, mrr: 0.85, recallAt10: 0.92 },
          B: { task: 'B', count: 5, recallAt10: 0.80, precisionAt5: 0.60 },
        },
      });
      const cgPath = join(tmp, 'codegraph.json');
      writeFileSync(cgPath, JSON.stringify(cgResult));

      const mpResult = makeResult({
        system: 'mempalace',
        questionCount: 10,
        tasks: {
          A: { task: 'A', count: 10, mrr: 0.55, recallAt10: 0.70 },
        },
        latency: {
          all: { count: 10, p50: 80, p95: 300, p99: 400, mean: 150, min: 50, max: 450 },
          cold: { count: 0, p50: 0, p95: 0, p99: 0, mean: 0, min: 0, max: 0 },
          warm: { count: 0, p50: 0, p95: 0, p99: 0, mean: 0, min: 0, max: 0 },
        },
        ingestion: { durationMs: 8000, totalDocs: 5, totalTokens: 200, diskBytesAfter: 2000, tokensPerSecond: 25 },
      });
      const mpPath = join(tmp, 'mempalace.json');
      writeFileSync(mpPath, JSON.stringify(mpResult));

      const summary = aggregate({
        perSystemFiles: [
          { system: 'codegraph', path: cgPath },
          { system: 'mempalace', path: mpPath },
        ],
        caveats: ['Test caveat'],
      });

      expect(summary.systems).toEqual(['codegraph', 'mempalace']);

      // Both have task A
      expect(summary.perTask.A?.['codegraph']?.mrr).toBe(0.85);
      expect(summary.perTask.A?.['mempalace']?.mrr).toBe(0.55);

      // Only codegraph has task B — mempalace entry should be absent
      expect(summary.perTask.B?.['codegraph']?.recallAt10).toBe(0.80);
      expect(summary.perTask.B?.['mempalace']).toBeUndefined();

      // Latency per system
      expect(summary.perSystemLatency['codegraph']?.p50).toBe(50);
      expect(summary.perSystemLatency['mempalace']?.p50).toBe(80);

      // Ingestion per system
      expect(summary.perSystemIngestion['mempalace']?.durationMs).toBe(8000);

      // Caveats passthrough
      expect(summary.caveats).toEqual(['Test caveat']);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('handles all six task types', () => {
    const tmp = makeTmpDir();
    try {
      const result = makeResult({
        system: 'all-tasks',
        tasks: {
          A: { task: 'A', count: 5, mrr: 0.90, recallAt10: 0.95 },
          B: { task: 'B', count: 5, recallAt10: 0.75, precisionAt5: 0.55 },
          C: { task: 'C', count: 5, f1: 0.68 },
          D: {
            task: 'D',
            count: 6,
            emPointInTime: 0.80,
            recallAt10Range: 0.85,
            pointInTimeCount: 3,
            rangeCount: 3,
          },
          E: { task: 'E', count: 5, recallAt10: 0.78 },
          F: { task: 'F', count: 5, recallAt10: 0.82 },
        },
      });
      const path = join(tmp, 'all-tasks.json');
      writeFileSync(path, JSON.stringify(result));

      const summary = aggregate({
        perSystemFiles: [{ system: 'all-tasks', path }],
      });

      expect(summary.perTask.A?.['all-tasks']?.mrr).toBe(0.90);
      expect(summary.perTask.B?.['all-tasks']?.precisionAt5).toBe(0.55);
      expect(summary.perTask.C?.['all-tasks']?.f1).toBe(0.68);
      expect(summary.perTask.D?.['all-tasks']?.emPointInTime).toBe(0.80);
      expect(summary.perTask.D?.['all-tasks']?.pointInTimeCount).toBe(3);
      expect(summary.perTask.E?.['all-tasks']?.recallAt10).toBe(0.78);
      expect(summary.perTask.F?.['all-tasks']?.recallAt10).toBe(0.82);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('uses provided timestamp and passes caveats through', () => {
    const tmp = makeTmpDir();
    try {
      const result = makeResult();
      const path = join(tmp, 'codegraph.json');
      writeFileSync(path, JSON.stringify(result));

      const ts = '2026-04-27T12:00:00.000Z';
      const caveats = ['Caveat one', 'Caveat two'];
      const summary = aggregate({
        perSystemFiles: [{ system: 'codegraph', path }],
        timestamp: ts,
        caveats,
      });

      expect(summary.timestamp).toBe(ts);
      expect(summary.caveats).toEqual(caveats);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('produces empty perTask when system has no task scores', () => {
    const tmp = makeTmpDir();
    try {
      const result = makeResult({ tasks: {} });
      const path = join(tmp, 'empty.json');
      writeFileSync(path, JSON.stringify(result));

      const summary = aggregate({ perSystemFiles: [{ system: 'codegraph', path }] });
      expect(summary.perTask).toEqual({});
      expect(summary.systems).toEqual(['codegraph']);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
