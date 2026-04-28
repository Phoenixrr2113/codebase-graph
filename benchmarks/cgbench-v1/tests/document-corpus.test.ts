import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SDIR = join(__dirname, '../documents/source');

describe('document corpus', () => {
  const files = readdirSync(SDIR).filter((f) => f.match(/^fact-\d{3}\.md$/));

  it('has at least 8 fact files', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it('every fact file starts with an H1 heading', () => {
    for (const f of files) {
      const md = readFileSync(join(SDIR, f), 'utf-8');
      expect(md.split('\n')[0]).toMatch(/^# /);
    }
  });

  it('every fact file contains at least one pipe-table outside code fences', () => {
    for (const f of files) {
      const md = readFileSync(join(SDIR, f), 'utf-8');
      let inFence = false;
      let hasTable = false;
      for (const line of md.split('\n')) {
        if (line.trim().startsWith('```')) { inFence = !inFence; continue; }
        if (inFence) continue;
        if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
          hasTable = true; break;
        }
      }
      expect(hasTable).toBe(true);
    }
  });

  it('fact ids are sequential without gaps', () => {
    const ids = files.map((f) => parseInt(f.match(/^fact-(\d{3})\.md$/)![1]!, 10)).sort((a, b) => a - b);
    expect(ids[0]).toBe(1);
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).toBe(ids[i - 1]! + 1);
    }
  });
});
