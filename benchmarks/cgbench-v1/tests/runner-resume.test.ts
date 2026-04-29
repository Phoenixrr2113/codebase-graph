import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSystem } from '../src/runner.js';
import type { BenchmarkAdapter, IngestStats, QueryOpts } from '../src/adapter.js';
import type { BenchmarkCorpus, RankedResult } from '../src/types.js';

class StubAdapter implements BenchmarkAdapter {
  name = 'stub';
  mode = 'native' as const;
  callCount = 0;
  async ingest(_corpus: BenchmarkCorpus): Promise<IngestStats> {
    return { totalDocs: 0, totalTokens: 0, durationMs: 1, diskBytesAfter: 0 };
  }
  async query(prompt: string, _opts: QueryOpts): Promise<RankedResult[]> {
    this.callCount++;
    return [{ id: prompt, score: 1.0, kind: 'code' as const }];
  }
  async destroy(): Promise<void> {}
}

describe('runSystem — per-question + parallel + resume', () => {
  let tmpDir: string;
  let questionsPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cgbench-resume-'));
    questionsPath = join(tmpDir, 'questions.jsonl');
    const lines = [
      { id: 'a-1', task: 'A', language: 'typescript', prompt: 'a-1', gold: ['a-1'], difficulty: 'easy' },
      { id: 'a-2', task: 'A', language: 'typescript', prompt: 'a-2', gold: ['a-2'], difficulty: 'easy' },
      { id: 'a-3', task: 'A', language: 'typescript', prompt: 'a-3', gold: ['a-3'], difficulty: 'easy' },
      { id: 'a-4', task: 'A', language: 'typescript', prompt: 'a-4', gold: ['a-4'], difficulty: 'easy' },
    ];
    writeFileSync(questionsPath, lines.map((l) => JSON.stringify(l)).join('\n'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes per-question result files', async () => {
    const adapter = new StubAdapter();
    const corpus: BenchmarkCorpus = { codeRoots: [] };
    await runSystem({ adapter, corpus, questionsPath, resultsDir: tmpDir, concurrency: 2 });

    const perQuestionDir = join(tmpDir, 'per-question');
    expect(existsSync(perQuestionDir)).toBe(true);
    const files = readdirSync(perQuestionDir);
    expect(files.length).toBe(4);
    expect(files.sort()).toEqual([
      'A-a-1.json',
      'A-a-2.json',
      'A-a-3.json',
      'A-a-4.json',
    ]);
    expect(adapter.callCount).toBe(4);
  });

  it('resumes — skips questions whose result file exists', async () => {
    const adapter = new StubAdapter();
    const corpus: BenchmarkCorpus = { codeRoots: [] };

    // Pre-seed two completed per-question result files
    const { writeAtomic } = await import('../src/runner-utils.js');
    await writeAtomic(
      join(tmpDir, 'per-question', 'A-a-1.json'),
      JSON.stringify({
        questionId: 'a-1',
        taskType: 'A',
        prompt: 'a-1',
        gold: ['a-1'],
        ranking: [],
        score: { mrr: 1, recallAt10: 1 },
        latencyMs: 1,
        status: 'ok',
      }),
    );
    await writeAtomic(
      join(tmpDir, 'per-question', 'A-a-2.json'),
      JSON.stringify({
        questionId: 'a-2',
        taskType: 'A',
        prompt: 'a-2',
        gold: ['a-2'],
        ranking: [],
        score: { mrr: 1, recallAt10: 1 },
        latencyMs: 1,
        status: 'ok',
      }),
    );

    await runSystem({ adapter, corpus, questionsPath, resultsDir: tmpDir, concurrency: 2 });

    // Adapter should only have been called for the 2 unfinished questions
    expect(adapter.callCount).toBe(2);
    expect(existsSync(join(tmpDir, 'per-question', 'A-a-3.json'))).toBe(true);
    expect(existsSync(join(tmpDir, 'per-question', 'A-a-4.json'))).toBe(true);
  });
});
