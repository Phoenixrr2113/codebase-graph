import { describe, expect, it, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { renderFact, hasPandoc, markdownTablesToCsv } from '../scripts/render-docs.js';

const HAVE_PANDOC = (() => {
  try { execFileSync('pandoc', ['--version'], { stdio: 'pipe' }); return true; }
  catch { return false; }
})();

describe('hasPandoc', () => {
  it('matches the actual environment', () => {
    expect(hasPandoc()).toBe(HAVE_PANDOC);
  });
});

describe('markdownTablesToCsv', () => {
  it('returns empty string when there are no tables', () => {
    expect(markdownTablesToCsv('# title\n\nbody text\n')).toBe('');
  });

  it('skips tables inside fenced code blocks', () => {
    const md = '```\n| a | b |\n|---|---|\n| 1 | 2 |\n```\n';
    expect(markdownTablesToCsv(md)).toBe('');
  });

  it('extracts a real pipe-table outside fences', () => {
    const md = '| a | b |\n|---|---|\n| 1 | 2 |\n';
    expect(markdownTablesToCsv(md)).toBe('a,b\n1,2\n');
  });

  it('escapes cells containing commas and quotes', () => {
    const md = '| name | quote |\n|---|---|\n| a, b | she said "hi" |\n';
    expect(markdownTablesToCsv(md)).toBe('name,quote\n"a, b","she said ""hi"""\n');
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

  it('produces all 5 formats with non-empty content', async () => {
    await renderFact(join(sourceDir, `${factId}.md`), outDir);
    for (const fmt of ['md', 'pdf', 'docx', 'html', 'csv'] as const) {
      const out = join(outDir, fmt, `${factId}.${fmt}`);
      expect(existsSync(out)).toBe(true);
      expect(statSync(out).size).toBeGreaterThan(0);
    }
  });
});
