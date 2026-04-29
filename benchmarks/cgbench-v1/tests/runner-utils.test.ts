import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Semaphore, writeAtomic, scanResultsDir } from '../src/runner-utils';

describe('Semaphore', () => {
  it('rejects non-positive maxConcurrent in constructor', () => {
    expect(() => new Semaphore(0)).toThrow();
    expect(() => new Semaphore(-1)).toThrow();
  });

  it('limits concurrent operations', async () => {
    const sem = new Semaphore(2);
    const inFlight: number[] = [];
    let max = 0;

    const run = (id: number) =>
      sem.run(async () => {
        inFlight.push(id);
        max = Math.max(max, inFlight.length);
        await new Promise((r) => setTimeout(r, 10));
        const idx = inFlight.indexOf(id);
        inFlight.splice(idx, 1);
        return id;
      });

    const results = await Promise.all([1, 2, 3, 4, 5].map(run));
    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(max).toBe(2);
  });
});

describe('writeAtomic', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cgbench-test-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes a file then renames into place', async () => {
    const target = join(tmpDir, 'output.json');
    await writeAtomic(target, '{"hello":"world"}');
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf-8')).toBe('{"hello":"world"}');
  });

  it('overwrites an existing file atomically', async () => {
    const target = join(tmpDir, 'output.json');
    await writeAtomic(target, 'first');
    await writeAtomic(target, 'second');
    expect(readFileSync(target, 'utf-8')).toBe('second');
  });

  it('does not leave .tmp artifacts in normal operation', async () => {
    const target = join(tmpDir, 'output.json');
    await writeAtomic(target, 'data');
    expect(existsSync(`${target}.tmp`)).toBe(false);
  });

  it('creates parent directories as needed', async () => {
    const target = join(tmpDir, 'nested', 'deeply', 'output.json');
    await writeAtomic(target, 'data');
    expect(readFileSync(target, 'utf-8')).toBe('data');
  });
});

describe('scanResultsDir', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cgbench-test-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty set when results dir does not exist', () => {
    const result = scanResultsDir(join(tmpDir, 'does-not-exist'));
    expect(result).toEqual(new Set());
  });

  it('returns set of question IDs from per-question files', async () => {
    const perQuestionDir = join(tmpDir, 'per-question');
    await writeAtomic(join(perQuestionDir, 'A-a-py-001.json'), '{}');
    await writeAtomic(join(perQuestionDir, 'B-b-py-001.json'), '{}');
    await writeAtomic(join(perQuestionDir, 'A-a-py-002.json'), '{}');

    const result = scanResultsDir(tmpDir);
    expect(result).toEqual(new Set(['a-py-001', 'b-py-001', 'a-py-002']));
  });

  it('ignores non-JSON files', async () => {
    const perQuestionDir = join(tmpDir, 'per-question');
    await writeAtomic(join(perQuestionDir, 'A-a-py-001.json'), '{}');
    await writeAtomic(join(perQuestionDir, 'README.md'), 'note');

    const result = scanResultsDir(tmpDir);
    expect(result).toEqual(new Set(['a-py-001']));
  });
});
