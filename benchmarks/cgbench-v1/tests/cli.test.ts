import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

describe('CLI', () => {
  // Use /tmp directly instead of tmpdir() because macOS tmpdir() paths are too long
  // for FalkorDBLite's Unix socket (>104 bytes).
  const resultsDir = mkdtempSync(`/tmp/cgbench-cli-`);

  it('runs `bench run --system codegraph` against fixtures and writes JSON', () => {
    const fixtureCorpus = join(ROOT, 'fixtures/code/tiny-ts');
    const fixtureQs = join(ROOT, 'fixtures/questions/smoke.jsonl');
    execFileSync(
      'npx',
      ['tsx', 'src/cli.ts', 'run',
        '--system', 'codegraph',
        '--corpus', fixtureCorpus,
        '--questions', fixtureQs,
        '--results-dir', resultsDir],
      { cwd: ROOT, stdio: 'inherit' },
    );
    const subdirs = readdirSync(resultsDir);
    expect(subdirs.length).toBe(1);
    const runDir = join(resultsDir, subdirs[0]!);
    expect(existsSync(join(runDir, 'per-system/codegraph.json'))).toBe(true);
    const data = JSON.parse(readFileSync(join(runDir, 'per-system/codegraph.json'), 'utf-8'));
    expect(data.system).toBe('codegraph');
    expect(data.questionCount).toBeGreaterThan(0);
    rmSync(resultsDir, { recursive: true, force: true });
  }, 180_000);
});
