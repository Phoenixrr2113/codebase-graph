import { existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Bounded-concurrency primitive. `run(fn)` resolves with the function's
 * return value once a slot is available.
 */
export class Semaphore {
  private inUse = 0;
  private waiters: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number) {
    if (maxConcurrent <= 0) throw new Error('Semaphore concurrency must be positive');
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inUse >= this.maxConcurrent) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.inUse++;
    try {
      return await fn();
    } finally {
      this.inUse--;
      const next = this.waiters.shift();
      if (next) next();
    }
  }
}

/**
 * Write to a temp file then rename — survives crashes mid-write.
 * Creates parent directories as needed.
 */
export async function writeAtomic(targetPath: string, contents: string): Promise<void> {
  const dir = dirname(targetPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${targetPath}.tmp`;
  writeFileSync(tmpPath, contents, 'utf-8');
  renameSync(tmpPath, targetPath);
}

/**
 * Scan a results directory and return the set of question IDs that already
 * have per-question result files. The file naming convention is
 * `<task>-<questionId>.json` in `<resultsDir>/per-question/`.
 */
export function scanResultsDir(resultsDir: string): Set<string> {
  const perQuestionDir = join(resultsDir, 'per-question');
  if (!existsSync(perQuestionDir)) return new Set();

  const ids = new Set<string>();
  for (const file of readdirSync(perQuestionDir)) {
    if (!file.endsWith('.json')) continue;
    // Strip extension and leading "<task>-"
    const stem = file.slice(0, -'.json'.length);
    const dashIdx = stem.indexOf('-');
    if (dashIdx === -1) continue;
    const questionId = stem.slice(dashIdx + 1);
    if (questionId.length > 0) ids.add(questionId);
  }
  return ids;
}
