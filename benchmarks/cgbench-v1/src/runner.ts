import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import type { BenchmarkAdapter } from './adapter.js';
import type { BenchmarkCorpus, Question } from './types.js';
import { QuestionSchema } from './types.js';
import { mrr } from './score/mrr.js';
import { recallAtK } from './score/recall.js';
import { aggregate, type LatencyReport } from './metrics/latency.js';
import { ingestionReport, type IngestionReport } from './metrics/ingestion.js';

export interface RunSystemArgs {
  adapter: BenchmarkAdapter;
  corpus: BenchmarkCorpus;
  questionsPath: string;
  coldQueriesCount?: number;
}

export interface TaskScore {
  count: number;
  mrr?: number;
  recallAt10?: number;
}

export interface RunResult {
  system: string;
  questionCount: number;
  tasks: Partial<Record<'A' | 'B' | 'C' | 'D' | 'E' | 'F', TaskScore>>;
  latency: LatencyReport;
  ingestion: IngestionReport;
}

export async function runSystem(args: RunSystemArgs): Promise<RunResult> {
  const questions: Question[] = readFileSync(args.questionsPath, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => QuestionSchema.parse(JSON.parse(l)));

  const ingestStats = await args.adapter.ingest(args.corpus);

  const latencySamples: { ms: number; cold: boolean }[] = [];
  const perTaskRankings: Map<string, { rankings: string[][]; golds: Set<string>[] }> = new Map();

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    const cold = i < (args.coldQueriesCount ?? 0);
    const t0 = performance.now();
    const results = await args.adapter.query(q.prompt, { topK: 10 });
    const ms = performance.now() - t0;
    latencySamples.push({ ms, cold });

    const ranking = results.map((r) => r.id);
    const gold = new Set(q.gold);
    const bucket = perTaskRankings.get(q.task) ?? { rankings: [], golds: [] };
    bucket.rankings.push(ranking);
    bucket.golds.push(gold);
    perTaskRankings.set(q.task, bucket);
  }

  const tasks: RunResult['tasks'] = {};
  for (const [task, { rankings, golds }] of perTaskRankings) {
    const r10s = rankings.map((r, i) => recallAtK(r, golds[i]!, 10));
    tasks[task as keyof RunResult['tasks']] = {
      count: rankings.length,
      mrr: mrr(rankings, golds),
      recallAt10: r10s.reduce((a, b) => a + b, 0) / r10s.length,
    };
  }

  return {
    system: args.adapter.name,
    questionCount: questions.length,
    tasks,
    latency: aggregate(latencySamples),
    ingestion: ingestionReport(ingestStats),
  };
}
