import { describe, expect, it } from 'vitest';
import { renderBenchmarksMarkdown } from '../src/report.js';
import type { BenchmarkSummary } from '../src/aggregator.js';

function makeSummary(overrides: Partial<BenchmarkSummary> = {}): BenchmarkSummary {
  return {
    timestamp: '2026-04-27T12:00:00.000Z',
    systems: ['codegraph'],
    perTask: {
      A: { codegraph: { mrr: 0.85, recallAt10: 0.92 } },
    },
    perSystemLatency: {
      codegraph: { p50: 50, p95: 200, p99: 300, mean: 100 },
    },
    perSystemIngestion: {
      codegraph: { durationMs: 5000, tokensPerSecond: 20, totalDocs: 3 },
    },
    caveats: [],
    ...overrides,
  };
}

describe('renderBenchmarksMarkdown', () => {
  it('emits required top-level headers', () => {
    const md = renderBenchmarksMarkdown(makeSummary());
    expect(md).toContain('# CGBench v1 — Results');
    expect(md).toContain('## Quality');
    expect(md).toContain('## Latency (ms)');
    expect(md).toContain('## Ingestion');
    expect(md).toContain('## Methodology');
  });

  it('includes the run timestamp and system names', () => {
    const md = renderBenchmarksMarkdown(makeSummary());
    expect(md).toContain('2026-04-27T12:00:00.000Z');
    expect(md).toContain('codegraph');
  });

  it('renders Task A table with correct values', () => {
    const md = renderBenchmarksMarkdown(makeSummary());
    expect(md).toContain('### Task A — NL→code retrieval');
    expect(md).toContain('| System | MRR | Recall@10 |');
    expect(md).toContain('| codegraph | 0.850 | 0.920 |');
  });

  it('renders latency table rows', () => {
    const md = renderBenchmarksMarkdown(makeSummary());
    expect(md).toContain('| System | p50 | p95 | p99 | mean |');
    expect(md).toContain('| codegraph | 50 | 200 | 300 | 100 |');
  });

  it('renders ingestion table with duration in seconds', () => {
    const md = renderBenchmarksMarkdown(makeSummary());
    expect(md).toContain('| System | Duration (s) | Tokens/sec | Docs |');
    // durationMs 5000 → 5.000s
    expect(md).toContain('| codegraph | 5.000 | 20 | 3 |');
  });

  it('includes caveats section when caveats are provided', () => {
    const md = renderBenchmarksMarkdown(makeSummary({ caveats: ['Caveat one', 'Caveat two'] }));
    expect(md).toContain('## Caveats');
    expect(md).toContain('- Caveat one');
    expect(md).toContain('- Caveat two');
  });

  it('omits caveats section when caveats array is empty', () => {
    const md = renderBenchmarksMarkdown(makeSummary({ caveats: [] }));
    expect(md).not.toContain('## Caveats');
  });

  it('renders all six task sections when all tasks are present', () => {
    const summary = makeSummary({
      systems: ['alpha'],
      perTask: {
        A: { alpha: { mrr: 0.90, recallAt10: 0.95 } },
        B: { alpha: { recallAt10: 0.80, precisionAt5: 0.60 } },
        C: { alpha: { f1: 0.70 } },
        D: { alpha: { emPointInTime: 0.75, recallAt10Range: 0.85, pointInTimeCount: 3, rangeCount: 3 } },
        E: { alpha: { recallAt10: 0.78 } },
        F: { alpha: { recallAt10: 0.82 } },
      },
      perSystemLatency: { alpha: { p50: 40, p95: 150, p99: 250, mean: 80 } },
      perSystemIngestion: { alpha: { durationMs: 3000, tokensPerSecond: 30, totalDocs: 5 } },
    });
    const md = renderBenchmarksMarkdown(summary);
    expect(md).toContain('### Task A — NL→code retrieval');
    expect(md).toContain('### Task B — multi-hop code retrieval');
    expect(md).toContain('### Task C — dependency graph traversal');
    expect(md).toContain('### Task D — temporal knowledge retrieval');
    expect(md).toContain('### Task E — cross-modal retrieval (code + knowledge)');
    expect(md).toContain('### Task F — document retrieval');
  });

  it('uses em dash for missing system metrics', () => {
    const summary = makeSummary({
      systems: ['codegraph', 'other'],
      perTask: {
        A: { codegraph: { mrr: 0.85, recallAt10: 0.92 } },
        // 'other' has no Task A entry
      },
      perSystemLatency: {
        codegraph: { p50: 50, p95: 200, p99: 300, mean: 100 },
        other: { p50: 60, p95: 210, p99: 310, mean: 110 },
      },
      perSystemIngestion: {
        codegraph: { durationMs: 5000, tokensPerSecond: 20, totalDocs: 3 },
        other: { durationMs: 6000, tokensPerSecond: 25, totalDocs: 4 },
      },
    });
    const md = renderBenchmarksMarkdown(summary);
    // other has no Task A — should have em dashes for mrr and recallAt10
    expect(md).toContain('| other | — | — |');
  });

  it('includes methodology links', () => {
    const md = renderBenchmarksMarkdown(makeSummary());
    expect(md).toContain('benchmarks/cgbench-v1/README.md');
    expect(md).toContain('benchmarks/cgbench-v1/COMPETITORS.md');
    expect(md).toContain('benchmarks/cgbench-v1/questions/REVIEW.md');
  });

  it('omits task sections that are absent from perTask', () => {
    // Summary only has Task A — no B, C, D, E, F
    const md = renderBenchmarksMarkdown(makeSummary());
    expect(md).not.toContain('### Task B');
    expect(md).not.toContain('### Task C');
    expect(md).not.toContain('### Task D');
    expect(md).not.toContain('### Task E');
    expect(md).not.toContain('### Task F');
  });
});
