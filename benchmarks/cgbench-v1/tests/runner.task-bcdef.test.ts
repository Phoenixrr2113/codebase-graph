import { describe, expect, it } from 'vitest';
import {
  scoreTaskA,
  scoreTaskB,
  scoreTaskC,
  scoreTaskD,
  scoreTaskE,
  scoreTaskF,
} from '../src/runner.js';
import type { Question } from '../src/types.js';

describe('scoreTaskA', () => {
  it('computes MRR + Recall@10 from rankings', () => {
    const rankings = [['x', 'a'], ['a']];
    const qs: Question[] = [
      { id: 'a-1', task: 'A', prompt: 'q1', gold: ['a'] },
      { id: 'a-2', task: 'A', prompt: 'q2', gold: ['a'] },
    ];
    const s = scoreTaskA(rankings, qs);
    expect(s.task).toBe('A');
    expect(s.count).toBe(2);
    if (s.task === 'A') {
      expect(s.mrr).toBeCloseTo((0.5 + 1) / 2);
      expect(s.recallAt10).toBe(1);
    }
  });
});

describe('scoreTaskB', () => {
  it('computes Recall@10 + Precision@5 from rankings', () => {
    const rankings = [['b', 'a', 'c'], ['x', 'y', 'a']];
    const qs: Question[] = [
      { id: 'b-1', task: 'B', prompt: 'q1', gold: ['a', 'c'] },
      { id: 'b-2', task: 'B', prompt: 'q2', gold: ['a'] },
    ];
    const s = scoreTaskB(rankings, qs);
    expect(s.task).toBe('B');
    expect(s.count).toBe(2);
    if (s.task === 'B') {
      expect(s.recallAt10).toBeCloseTo((2 / 2 + 1 / 1) / 2);
      expect(s.precisionAt5).toBeCloseTo((2 / 5 + 1 / 5) / 2);
    }
  });

  it('returns 0 for both metrics when rankings are empty per question', () => {
    const rankings = [[], []];
    const qs: Question[] = [
      { id: 'b-1', task: 'B', prompt: 'q1', gold: ['a'] },
      { id: 'b-2', task: 'B', prompt: 'q2', gold: ['b'] },
    ];
    const s = scoreTaskB(rankings, qs);
    expect(s.task).toBe('B');
    if (s.task === 'B') {
      expect(s.recallAt10).toBe(0);
      expect(s.precisionAt5).toBe(0);
    }
  });
});

describe('scoreTaskC', () => {
  it('computes F1 against gold set for top-10 retrieved', () => {
    const rankings = [['a', 'b', 'x'], ['y', 'z']];
    const qs: Question[] = [
      {
        id: 'c-1',
        task: 'C',
        prompt: 'q1',
        gold: ['a', 'b'],
        hopDistance: { a: 1, b: 2 },
      },
      {
        id: 'c-2',
        task: 'C',
        prompt: 'q2',
        gold: ['a', 'b'],
        hopDistance: { a: 1, b: 2 },
      },
    ];
    const s = scoreTaskC(rankings, qs);
    expect(s.task).toBe('C');
    expect(s.count).toBe(2);
    if (s.task === 'C') {
      const retrieved1 = new Set(['a', 'b', 'x']);
      const gold1 = new Set(['a', 'b']);
      const tp1 = 2;
      const p1 = tp1 / retrieved1.size;
      const r1 = tp1 / gold1.size;
      const f1q1 = (2 * p1 * r1) / (p1 + r1);
      expect(s.f1).toBeCloseTo((f1q1 + 0) / 2);
    }
  });
});

describe('scoreTaskD', () => {
  it('computes ExactMatch for point-in-time and Recall@10 for range queries', () => {
    const rankings = [
      ['knowledge-001'],
      ['knowledge-002'],
      ['knowledge-001', 'knowledge-003'],
    ];
    const qs: Question[] = [
      {
        id: 'd-1',
        task: 'D',
        prompt: 'pt1',
        gold: ['knowledge-001'],
        validAt: '2025-12-15T00:00:00Z',
      },
      {
        id: 'd-2',
        task: 'D',
        prompt: 'pt2',
        gold: ['knowledge-999'],
        validAt: '2026-01-10T00:00:00Z',
      },
      {
        id: 'd-3',
        task: 'D',
        prompt: 'range1',
        gold: ['knowledge-001', 'knowledge-003'],
      },
    ];
    const s = scoreTaskD(rankings, qs);
    expect(s.task).toBe('D');
    expect(s.count).toBe(3);
    if (s.task === 'D') {
      expect(s.pointInTimeCount).toBe(2);
      expect(s.rangeCount).toBe(1);
      expect(s.emPointInTime).toBeCloseTo((1 + 0) / 2);
      expect(s.recallAt10Range).toBeCloseTo(1);
    }
  });

  it('returns 0 for both sub-scores when no applicable questions exist', () => {
    const rankings: string[][] = [];
    const qs: Question[] = [];
    const s = scoreTaskD(rankings, qs);
    if (s.task === 'D') {
      expect(s.emPointInTime).toBe(0);
      expect(s.recallAt10Range).toBe(0);
    }
  });
});

describe('scoreTaskE', () => {
  it('computes Recall@10 against gold union goldKnowledge', () => {
    const rankings = [['code-a', 'knowledge-001', 'x'], ['code-b']];
    const qs: Question[] = [
      {
        id: 'e-1',
        task: 'E',
        prompt: 'q1',
        gold: ['code-a'],
        goldKnowledge: ['knowledge-001'],
      },
      {
        id: 'e-2',
        task: 'E',
        prompt: 'q2',
        gold: ['code-b'],
        goldKnowledge: ['knowledge-002'],
      },
    ];
    const s = scoreTaskE(rankings, qs);
    expect(s.task).toBe('E');
    expect(s.count).toBe(2);
    if (s.task === 'E') {
      expect(s.recallAt10).toBeCloseTo((2 / 2 + 1 / 2) / 2);
    }
  });
});

describe('scoreTaskF', () => {
  it('computes Recall@10 against gold', () => {
    const rankings = [['fact-001'], ['x', 'fact-002']];
    const qs: Question[] = [
      { id: 'f-1', task: 'F', prompt: 'q1', gold: ['fact-001'], format: 'md' },
      { id: 'f-2', task: 'F', prompt: 'q2', gold: ['fact-002'], format: 'pdf' },
    ];
    const s = scoreTaskF(rankings, qs);
    expect(s.task).toBe('F');
    expect(s.count).toBe(2);
    if (s.task === 'F') {
      expect(s.recallAt10).toBe(1);
    }
  });
});
