import { describe, expect, it, afterAll } from 'vitest';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { CodeGraphAdapter } from '../src/adapters/codegraph.js';
import { runSystem } from '../src/runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, '../fixtures/code/tiny-ts');
const QUESTIONS = join(__dirname, '../fixtures/questions/smoke.jsonl');

describe('runSystem with CodeGraph + smoke questions', () => {
  // Use /tmp directly — macOS tmpdir() path is too long for FalkorDBLite's Unix socket
  const dataDir = mkdtempSync('/tmp/cgbench-runner-');
  const adapter = new CodeGraphAdapter({ dataDir });
  afterAll(async () => {
    await adapter.destroy().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('runs end to end and returns scored results', async () => {
    const result = await runSystem({
      adapter,
      corpus: { codeRoots: [{ language: 'typescript', path: FIXTURE, commitSha: 'fixture' }] },
      questionsPath: QUESTIONS,
      coldQueriesCount: 1,
    });
    expect(result.system).toBe('codegraph');
    expect(result.questionCount).toBe(3);
    const aScore = result.tasks.A;
    expect(aScore?.task).toBe('A');
    if (aScore?.task === 'A') {
      expect(aScore.mrr).toBeGreaterThan(0);
    }
    expect(result.latency.all.count).toBe(3);
    expect(result.ingestion.durationMs).toBeGreaterThan(0);
    expect(result.ingestion.diskBytesAfter).toBeGreaterThan(0);
  }, 120_000);
});
