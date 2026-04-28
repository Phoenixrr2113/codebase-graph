import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

describe('CLI run-all', () => {
  it('runs codegraph against the smoke fixture and produces summary.json + BENCHMARKS.md', async () => {
    const resultsDir = mkdtempSync('/tmp/cgbench-run-all-');
    try {
      const fixtureCorpus = join(ROOT, 'fixtures/code/tiny-ts');
      const fixtureQsDir = join(ROOT, 'fixtures/questions');

      execFileSync(
        'npx',
        [
          'tsx', 'src/cli.ts', 'run-all',
          '--systems', 'codegraph',
          '--code-corpus', fixtureCorpus,
          '--questions-dir', fixtureQsDir,
          '--results-dir', resultsDir,
          '--language', 'typescript',
        ],
        { cwd: ROOT, stdio: 'inherit' },
      );

      // Exactly one run subdirectory should exist.
      const subdirs = readdirSync(resultsDir);
      expect(subdirs.length).toBe(1);

      const runDir = join(resultsDir, subdirs[0]!);

      // per-system/codegraph.json must exist and be valid RunResult
      const perSystemPath = join(runDir, 'per-system', 'codegraph.json');
      expect(existsSync(perSystemPath)).toBe(true);
      const perSystem = JSON.parse(readFileSync(perSystemPath, 'utf-8')) as Record<string, unknown>;
      expect(perSystem['system']).toBe('codegraph');
      expect(typeof perSystem['questionCount']).toBe('number');

      // summary.json must exist and be a valid BenchmarkSummary
      const summaryPath = join(runDir, 'summary.json');
      expect(existsSync(summaryPath)).toBe(true);
      const summary = JSON.parse(readFileSync(summaryPath, 'utf-8')) as Record<string, unknown>;
      expect(Array.isArray(summary['systems'])).toBe(true);
      expect((summary['systems'] as string[]).includes('codegraph')).toBe(true);
      expect(typeof summary['timestamp']).toBe('string');
      expect(typeof summary['perTask']).toBe('object');
      expect(typeof summary['perSystemLatency']).toBe('object');
      expect(typeof summary['perSystemIngestion']).toBe('object');
      expect(Array.isArray(summary['caveats'])).toBe(true);

      // BENCHMARKS.md must exist and contain expected content
      const mdPath = join(runDir, 'BENCHMARKS.md');
      expect(existsSync(mdPath)).toBe(true);
      const md = readFileSync(mdPath, 'utf-8');
      expect(md).toContain('# CGBench v1 — Results');
      expect(md).toContain('## Quality');
      expect(md).toContain('## Latency (ms)');
      expect(md).toContain('## Ingestion');
      expect(md).toContain('codegraph');
    } finally {
      rmSync(resultsDir, { recursive: true, force: true });
    }
  }, 600_000);
});
