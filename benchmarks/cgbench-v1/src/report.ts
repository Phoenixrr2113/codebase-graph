import type { BenchmarkSummary } from './aggregator.js';

export function renderBenchmarksMarkdown(summary: BenchmarkSummary): string {
  const lines: string[] = [];

  lines.push('# CGBench v1 — Results');
  lines.push('');
  lines.push(`**Run timestamp:** ${summary.timestamp}`);
  lines.push(`**Systems tested:** ${summary.systems.join(', ')}`);
  lines.push('');

  lines.push('## Quality');
  lines.push('');

  if (summary.perTask.A) {
    lines.push('### Task A — NL→code retrieval');
    lines.push('| System | MRR | Recall@10 |');
    lines.push('|---|---|---|');
    for (const sys of summary.systems) {
      const s = summary.perTask.A[sys];
      lines.push(`| ${sys} | ${fmt(s?.mrr)} | ${fmt(s?.recallAt10)} |`);
    }
    lines.push('');
  }

  if (summary.perTask.B) {
    lines.push('### Task B — multi-hop code retrieval');
    lines.push('| System | Recall@10 | Precision@5 |');
    lines.push('|---|---|---|');
    for (const sys of summary.systems) {
      const s = summary.perTask.B[sys];
      lines.push(`| ${sys} | ${fmt(s?.recallAt10)} | ${fmt(s?.precisionAt5)} |`);
    }
    lines.push('');
  }

  if (summary.perTask.C) {
    lines.push('### Task C — dependency graph traversal');
    lines.push('| System | F1 |');
    lines.push('|---|---|');
    for (const sys of summary.systems) {
      const s = summary.perTask.C[sys];
      lines.push(`| ${sys} | ${fmt(s?.f1)} |`);
    }
    lines.push('');
  }

  if (summary.perTask.D) {
    lines.push('### Task D — temporal knowledge retrieval');
    lines.push('| System | EM (point-in-time) | Recall@10 (range) |');
    lines.push('|---|---|---|');
    for (const sys of summary.systems) {
      const s = summary.perTask.D[sys];
      lines.push(`| ${sys} | ${fmt(s?.emPointInTime)} | ${fmt(s?.recallAt10Range)} |`);
    }
    lines.push('');
  }

  if (summary.perTask.E) {
    lines.push('### Task E — cross-modal retrieval (code + knowledge)');
    lines.push('| System | Recall@10 |');
    lines.push('|---|---|');
    for (const sys of summary.systems) {
      const s = summary.perTask.E[sys];
      lines.push(`| ${sys} | ${fmt(s?.recallAt10)} |`);
    }
    lines.push('');
  }

  if (summary.perTask.F) {
    lines.push('### Task F — document retrieval');
    lines.push('| System | Recall@10 |');
    lines.push('|---|---|');
    for (const sys of summary.systems) {
      const s = summary.perTask.F[sys];
      lines.push(`| ${sys} | ${fmt(s?.recallAt10)} |`);
    }
    lines.push('');
  }

  lines.push('## Latency (ms)');
  lines.push('| System | p50 | p95 | p99 | mean |');
  lines.push('|---|---|---|---|---|');
  for (const sys of summary.systems) {
    const l = summary.perSystemLatency[sys];
    lines.push(`| ${sys} | ${fmt0(l?.p50)} | ${fmt0(l?.p95)} | ${fmt0(l?.p99)} | ${fmt0(l?.mean)} |`);
  }
  lines.push('');

  lines.push('## Ingestion');
  lines.push('| System | Duration (s) | Tokens/sec | Docs |');
  lines.push('|---|---|---|---|');
  for (const sys of summary.systems) {
    const i = summary.perSystemIngestion[sys];
    const sec = i !== undefined ? i.durationMs / 1000 : null;
    lines.push(`| ${sys} | ${fmt(sec)} | ${fmt0(i?.tokensPerSecond)} | ${fmt0(i?.totalDocs)} |`);
  }
  lines.push('');

  if (summary.caveats.length > 0) {
    lines.push('## Caveats');
    for (const c of summary.caveats) lines.push(`- ${c}`);
    lines.push('');
  }

  lines.push('## Methodology');
  lines.push('');
  lines.push('- See `benchmarks/cgbench-v1/README.md` for setup');
  lines.push('- See `benchmarks/cgbench-v1/COMPETITORS.md` for system status');
  lines.push('- See `benchmarks/cgbench-v1/questions/REVIEW.md` for question authoring discipline');
  lines.push('');

  return lines.join('\n');
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toFixed(3);
}

function fmt0(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return n.toFixed(0);
}
