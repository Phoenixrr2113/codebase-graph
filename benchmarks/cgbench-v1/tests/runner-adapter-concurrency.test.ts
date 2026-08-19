import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runSystem } from '../src/runner.js';
import type { BenchmarkAdapter, IngestStats, QueryOpts } from '../src/adapter.js';
import type { BenchmarkCorpus, RankedResult } from '../src/types.js';

/**
 * Records the high-water mark of concurrent query() calls so a test can assert
 * that the runner never exceeded an adapter's declared ceiling.
 */
class ConcurrencyProbeAdapter implements BenchmarkAdapter {
  name = 'probe';
  mode = 'native' as const;
  inFlight = 0;
  peakInFlight = 0;

  readonly maxQueryConcurrency?: number;

  constructor(maxQueryConcurrency?: number) {
    if (maxQueryConcurrency !== undefined) {
      this.maxQueryConcurrency = maxQueryConcurrency;
    }
  }

  async ingest(_corpus: BenchmarkCorpus): Promise<IngestStats> {
    return { totalDocs: 0, totalTokens: 0, durationMs: 1, diskBytesAfter: 0 };
  }

  async query(prompt: string, _opts: QueryOpts): Promise<RankedResult[]> {
    this.inFlight++;
    this.peakInFlight = Math.max(this.peakInFlight, this.inFlight);
    // Yield to the event loop so genuinely parallel dispatch overlaps here.
    await new Promise((resolve) => setTimeout(resolve, 5));
    this.inFlight--;
    return [{ id: prompt, score: 1.0, kind: 'code' as const }];
  }

  async destroy(): Promise<void> {}
}

describe('runSystem honours adapter-declared query concurrency', () => {
  let tmpDir: string;
  let questionsPath: string;
  const corpus: BenchmarkCorpus = { codeRoots: [] };

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cgbench-adapter-concurrency-'));
    questionsPath = join(tmpDir, 'questions.jsonl');
    const lines = Array.from({ length: 6 }, (_, i) => ({
      id: `a-${i + 1}`,
      task: 'A',
      language: 'typescript',
      prompt: `a-${i + 1}`,
      gold: [`a-${i + 1}`],
      difficulty: 'easy',
    }));
    writeFileSync(questionsPath, lines.map((l) => JSON.stringify(l)).join('\n'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('serialises queries when the adapter declares maxQueryConcurrency of 1', async () => {
    const adapter = new ConcurrencyProbeAdapter(1);

    await runSystem({ adapter, corpus, questionsPath, resultsDir: tmpDir, concurrency: 4 });

    expect(adapter.peakInFlight).toBe(1);
  });

  it('clamps to the adapter ceiling when the runner asks for more', async () => {
    const adapter = new ConcurrencyProbeAdapter(2);

    await runSystem({ adapter, corpus, questionsPath, resultsDir: tmpDir, concurrency: 5 });

    expect(adapter.peakInFlight).toBeLessThanOrEqual(2);
  });

  it('uses the runner concurrency when the adapter declares no ceiling', async () => {
    const adapter = new ConcurrencyProbeAdapter();

    await runSystem({ adapter, corpus, questionsPath, resultsDir: tmpDir, concurrency: 3 });

    expect(adapter.peakInFlight).toBeGreaterThan(1);
    expect(adapter.peakInFlight).toBeLessThanOrEqual(3);
  });
});
