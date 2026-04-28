import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { QuestionSchema, type Question } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const QDIR = join(__dirname, '../questions');

function loadJsonl(file: string): Question[] {
  return readFileSync(file, 'utf-8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => QuestionSchema.parse(JSON.parse(l)));
}

const expected: Record<string, { task: 'A' | 'B' | 'C' | 'D' | 'E' | 'F'; count: number }> = {
  'task-a.jsonl': { task: 'A', count: 12 },
  'task-b.jsonl': { task: 'B', count: 12 },
  'task-c.jsonl': { task: 'C', count: 8 },
  'task-d.jsonl': { task: 'D', count: 8 },
  'task-e.jsonl': { task: 'E', count: 8 },
  'task-f.jsonl': { task: 'F', count: 10 },
};

for (const [filename, { task, count }] of Object.entries(expected)) {
  describe(filename, () => {
    const qs = loadJsonl(join(QDIR, filename));

    it(`has exactly ${count} questions`, () => {
      expect(qs).toHaveLength(count);
    });

    it(`every entry has task '${task}'`, () => {
      for (const q of qs) expect(q.task).toBe(task);
    });

    it('every gold is non-empty', () => {
      for (const q of qs) expect(q.gold.length).toBeGreaterThan(0);
    });

    if (task === 'C') {
      it('every gold has a hopDistance entry', () => {
        for (const q of qs) {
          for (const g of q.gold) expect(q.hopDistance?.[g]).toBeDefined();
        }
      });
    }

    if (task === 'E') {
      it('goldKnowledge is non-empty', () => {
        for (const q of qs) expect(q.goldKnowledge?.length ?? 0).toBeGreaterThan(0);
      });
    }

    if (task === 'F') {
      it('format is set', () => {
        for (const q of qs) expect(q.format).toBeDefined();
      });
    }
  });
}
