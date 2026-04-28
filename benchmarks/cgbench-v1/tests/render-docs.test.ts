import { describe, expect, it, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderFact, hasPandoc } from '../scripts/render-docs.js';

const HAVE_PANDOC = (() => {
  try { execSync('pandoc --version', { stdio: 'pipe' }); return true; }
  catch { return false; }
})();

describe('hasPandoc', () => {
  it('matches the actual environment', () => {
    expect(hasPandoc()).toBe(HAVE_PANDOC);
  });
});

describe.skipIf(!HAVE_PANDOC)('renderFact', () => {
  const workDir = join(tmpdir(), `cgbench-render-${Date.now()}`);
  const sourceDir = join(workDir, 'source');
  const outDir = join(workDir, 'rendered');
  const factId = 'fact-001';

  beforeAll(() => {
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(
      join(sourceDir, `${factId}.md`),
      '# Q1 Retro\n\nThe Q1 retro happened on 2026-04-15.\n\n| key | value |\n|---|---|\n| date | 2026-04-15 |\n',
    );
  });

  it('produces all 5 formats from a markdown source', async () => {
    await renderFact(join(sourceDir, `${factId}.md`), outDir);
    expect(existsSync(join(outDir, 'md', `${factId}.md`))).toBe(true);
    expect(existsSync(join(outDir, 'pdf', `${factId}.pdf`))).toBe(true);
    expect(existsSync(join(outDir, 'docx', `${factId}.docx`))).toBe(true);
    expect(existsSync(join(outDir, 'html', `${factId}.html`))).toBe(true);
    expect(existsSync(join(outDir, 'csv', `${factId}.csv`))).toBe(true);
  });
});
