import { readFileSync } from 'node:fs';
import type { RunResult } from './runner.js';

export interface BenchmarkSummary {
  timestamp: string;
  systems: string[];
  perTask: {
    A?: Record<string, { mrr: number; recallAt10: number }>;
    B?: Record<string, { recallAt10: number; precisionAt5: number }>;
    C?: Record<string, { f1: number }>;
    D?: Record<string, { emPointInTime: number; recallAt10Range: number; pointInTimeCount: number; rangeCount: number }>;
    E?: Record<string, { recallAt10: number }>;
    F?: Record<string, { recallAt10: number }>;
  };
  perSystemLatency: Record<string, { p50: number; p95: number; p99: number; mean: number }>;
  perSystemIngestion: Record<string, { durationMs: number; tokensPerSecond: number; totalDocs: number }>;
  caveats: string[];
}

export interface AggregateInput {
  perSystemFiles: { system: string; path: string }[];
  caveats?: string[];
  timestamp?: string;
}

export function aggregate(input: AggregateInput): BenchmarkSummary {
  const summary: BenchmarkSummary = {
    timestamp: input.timestamp ?? new Date().toISOString(),
    systems: input.perSystemFiles.map((f) => f.system),
    perTask: {},
    perSystemLatency: {},
    perSystemIngestion: {},
    caveats: input.caveats ?? [],
  };

  for (const { system, path } of input.perSystemFiles) {
    const result = JSON.parse(readFileSync(path, 'utf-8')) as RunResult;

    for (const score of Object.values(result.tasks)) {
      if (!score) continue;
      switch (score.task) {
        case 'A':
          summary.perTask.A ??= {};
          summary.perTask.A[system] = { mrr: score.mrr, recallAt10: score.recallAt10 };
          break;
        case 'B':
          summary.perTask.B ??= {};
          summary.perTask.B[system] = { recallAt10: score.recallAt10, precisionAt5: score.precisionAt5 };
          break;
        case 'C':
          summary.perTask.C ??= {};
          summary.perTask.C[system] = { f1: score.f1 };
          break;
        case 'D':
          summary.perTask.D ??= {};
          summary.perTask.D[system] = {
            emPointInTime: score.emPointInTime,
            recallAt10Range: score.recallAt10Range,
            pointInTimeCount: score.pointInTimeCount,
            rangeCount: score.rangeCount,
          };
          break;
        case 'E':
          summary.perTask.E ??= {};
          summary.perTask.E[system] = { recallAt10: score.recallAt10 };
          break;
        case 'F':
          summary.perTask.F ??= {};
          summary.perTask.F[system] = { recallAt10: score.recallAt10 };
          break;
      }
    }

    summary.perSystemLatency[system] = {
      p50: result.latency.all.p50,
      p95: result.latency.all.p95,
      p99: result.latency.all.p99,
      mean: result.latency.all.mean,
    };

    summary.perSystemIngestion[system] = {
      durationMs: result.ingestion.durationMs,
      tokensPerSecond: result.ingestion.tokensPerSecond,
      totalDocs: result.ingestion.totalDocs,
    };
  }

  return summary;
}
