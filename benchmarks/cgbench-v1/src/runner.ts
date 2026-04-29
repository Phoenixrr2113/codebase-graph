import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import type { BenchmarkAdapter } from './adapter.js';
import type { BenchmarkCorpus, Question, QuestionScore, TaskLetter } from './types.js';
import { QuestionSchema } from './types.js';
import { mrr } from './score/mrr.js';
import { recallAtK, precisionAtK } from './score/recall.js';
import { f1 } from './score/f1.js';
import { exactMatch } from './score/em.js';
import { aggregate, type LatencyReport } from './metrics/latency.js';
import { ingestionReport, type IngestionReport } from './metrics/ingestion.js';

export interface RunSystemArgs {
  adapter: BenchmarkAdapter;
  corpus: BenchmarkCorpus;
  questionsPath: string;
  coldQueriesCount?: number;
}

export type TaskScore =
  | { task: 'A'; count: number; mrr: number; recallAt10: number }
  | { task: 'B'; count: number; recallAt10: number; precisionAt5: number }
  | { task: 'C'; count: number; f1: number }
  | {
      task: 'D';
      count: number;
      emPointInTime: number;
      recallAt10Range: number;
      pointInTimeCount: number;
      rangeCount: number;
    }
  | { task: 'E'; count: number; recallAt10: number }
  | { task: 'F'; count: number; recallAt10: number };

export interface RunResult {
  system: string;
  questionCount: number;
  tasks: Partial<Record<'A' | 'B' | 'C' | 'D' | 'E' | 'F', TaskScore>>;
  latency: LatencyReport;
  ingestion: IngestionReport;
}

export function scoreTaskA(rankings: string[][], questions: Question[]): Extract<TaskScore, { task: 'A' }> {
  const golds = questions.map((q) => new Set(q.gold));
  const r10s = rankings.map((r, i) => recallAtK(r, golds[i]!, 10));
  return {
    task: 'A',
    count: rankings.length,
    mrr: mrr(rankings, golds),
    recallAt10: r10s.reduce((a, b) => a + b, 0) / r10s.length,
  };
}

export function scoreTaskB(rankings: string[][], questions: Question[]): Extract<TaskScore, { task: 'B' }> {
  const golds = questions.map((q) => new Set(q.gold));
  const r10s = rankings.map((r, i) => recallAtK(r, golds[i]!, 10));
  const p5s = rankings.map((r, i) => precisionAtK(r, golds[i]!, 5));
  return {
    task: 'B',
    count: rankings.length,
    recallAt10: r10s.reduce((a, b) => a + b, 0) / r10s.length,
    precisionAt5: p5s.reduce((a, b) => a + b, 0) / p5s.length,
  };
}

export function scoreTaskC(rankings: string[][], questions: Question[]): Extract<TaskScore, { task: 'C' }> {
  const f1s = rankings.map((r, i) => {
    const retrieved = new Set(r.slice(0, 10));
    const gold = new Set(questions[i]!.gold);
    return f1(retrieved, gold);
  });
  return {
    task: 'C',
    count: rankings.length,
    f1: f1s.reduce((a, b) => a + b, 0) / f1s.length,
  };
}

export function scoreTaskD(rankings: string[][], questions: Question[]): Extract<TaskScore, { task: 'D' }> {
  let emHits = 0;
  let emCount = 0;
  let r10Sum = 0;
  let r10Count = 0;

  for (let i = 0; i < rankings.length; i++) {
    const q = questions[i]!;
    if (q.validAt !== undefined) {
      emHits += exactMatch(rankings[i]!, q.gold[0]!);
      emCount++;
    } else {
      r10Sum += recallAtK(rankings[i]!, new Set(q.gold), 10);
      r10Count++;
    }
  }

  return {
    task: 'D',
    count: rankings.length,
    emPointInTime: emCount > 0 ? emHits / emCount : 0,
    recallAt10Range: r10Count > 0 ? r10Sum / r10Count : 0,
    pointInTimeCount: emCount,
    rangeCount: r10Count,
  };
}

export function scoreTaskE(rankings: string[][], questions: Question[]): Extract<TaskScore, { task: 'E' }> {
  const golds = questions.map((q) => new Set([...q.gold, ...(q.goldKnowledge ?? [])]));
  const r10s = rankings.map((r, i) => recallAtK(r, golds[i]!, 10));
  return {
    task: 'E',
    count: rankings.length,
    recallAt10: r10s.reduce((a, b) => a + b, 0) / r10s.length,
  };
}

export function scoreTaskF(rankings: string[][], questions: Question[]): Extract<TaskScore, { task: 'F' }> {
  const golds = questions.map((q) => new Set(q.gold));
  const r10s = rankings.map((r, i) => recallAtK(r, golds[i]!, 10));
  return {
    task: 'F',
    count: rankings.length,
    recallAt10: r10s.reduce((a, b) => a + b, 0) / r10s.length,
  };
}

/**
 * Score a single question's ranking against its gold.
 * Shape of the returned object depends on task type:
 * - A: { mrr, recallAt10 }
 * - B: { recallAt10, precisionAt5 }
 * - C: { f1 }
 * - D: { exactMatch } if validAt is set, else { recallAt10 }
 * - E: { recallAt10 } across gold + goldKnowledge
 * - F: { recallAt10 }
 */
export function scoreQuestion(
  question: Question,
  ranking: string[],
  taskType: TaskLetter,
): QuestionScore {
  const gold = new Set(question.gold);
  switch (taskType) {
    case 'A': {
      const r = recallAtK(ranking, gold, 10);
      const m = mrr([ranking], [gold]);
      return { mrr: m, recallAt10: r };
    }
    case 'B': {
      const r = recallAtK(ranking, gold, 10);
      const p = precisionAtK(ranking, gold, 5);
      return { recallAt10: r, precisionAt5: p };
    }
    case 'C': {
      const retrieved = new Set(ranking.slice(0, 10));
      return { f1: f1(retrieved, gold) };
    }
    case 'D': {
      if (question.validAt !== undefined) {
        return { exactMatch: exactMatch(ranking, question.gold[0]!) };
      }
      return { recallAt10: recallAtK(ranking, gold, 10) };
    }
    case 'E': {
      const combined = new Set([...question.gold, ...(question.goldKnowledge ?? [])]);
      return { recallAt10: recallAtK(ranking, combined, 10) };
    }
    case 'F': {
      return { recallAt10: recallAtK(ranking, gold, 10) };
    }
  }
}

export async function runSystem(args: RunSystemArgs): Promise<RunResult> {
  const questions: Question[] = readFileSync(args.questionsPath, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => QuestionSchema.parse(JSON.parse(l)));

  const ingestStats = await args.adapter.ingest(args.corpus);

  const latencySamples: { ms: number; cold: boolean }[] = [];
  const perTaskGroups: Map<string, { rankings: string[][]; questions: Question[] }> = new Map();

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    const cold = i < (args.coldQueriesCount ?? 0);
    const t0 = performance.now();
    const results = await args.adapter.query(q.prompt, { topK: 10 });
    const ms = performance.now() - t0;
    latencySamples.push({ ms, cold });

    const ranking = results.map((r) => r.id);
    const bucket = perTaskGroups.get(q.task) ?? { rankings: [], questions: [] };
    bucket.rankings.push(ranking);
    bucket.questions.push(q);
    perTaskGroups.set(q.task, bucket);
  }

  const tasks: RunResult['tasks'] = {};
  for (const [task, { rankings, questions: taskQuestions }] of perTaskGroups) {
    switch (task) {
      case 'A':
        tasks.A = scoreTaskA(rankings, taskQuestions);
        break;
      case 'B':
        tasks.B = scoreTaskB(rankings, taskQuestions);
        break;
      case 'C':
        tasks.C = scoreTaskC(rankings, taskQuestions);
        break;
      case 'D':
        tasks.D = scoreTaskD(rankings, taskQuestions);
        break;
      case 'E':
        tasks.E = scoreTaskE(rankings, taskQuestions);
        break;
      case 'F':
        tasks.F = scoreTaskF(rankings, taskQuestions);
        break;
    }
  }

  return {
    system: args.adapter.name,
    questionCount: questions.length,
    tasks,
    latency: aggregate(latencySamples),
    ingestion: ingestionReport(ingestStats),
  };
}
