import { describe, it, expect } from 'vitest';
import { scoreQuestion } from '../src/runner';
import type { Question } from '../src/types';

describe('scoreQuestion', () => {
  it('Task A: MRR + Recall@10', () => {
    const q: Question = {
      id: 'a-1',
      task: 'A',
      language: 'typescript',
      prompt: 'p',
      gold: ['util.ts#foo'],
      difficulty: 'easy',
    };
    const ranking = ['util.ts#bar', 'util.ts#foo', 'util.ts#baz'];
    const result = scoreQuestion(q, ranking, 'A');
    expect(result.mrr).toBeCloseTo(0.5, 5);
    expect(result.recallAt10).toBe(1);
  });

  it('Task B: Recall@10 + Precision@5', () => {
    const q: Question = {
      id: 'b-1',
      task: 'B',
      language: 'python',
      prompt: 'p',
      gold: ['a.py#x', 'a.py#y'],
      difficulty: 'medium',
    };
    const ranking = ['a.py#x', 'a.py#z', 'a.py#y'];
    const result = scoreQuestion(q, ranking, 'B');
    expect(result.recallAt10).toBe(1);
    expect(result.precisionAt5).toBeCloseTo(2 / 5, 5);
  });

  it('Task C: F1 on top-10 retrieved set', () => {
    const q: Question = {
      id: 'c-1',
      task: 'C',
      language: 'python',
      prompt: 'p',
      gold: ['a.py#x', 'a.py#y'],
      difficulty: 'hard',
    };
    const ranking = ['a.py#x', 'a.py#y', 'a.py#z'];
    const result = scoreQuestion(q, ranking, 'C');
    // Retrieved (top-10) = {x, y, z}, gold = {x, y}
    // Precision = 2/3, Recall = 2/2 = 1.0, F1 = 2*P*R/(P+R) = 0.8
    expect(result.f1).toBeCloseTo(0.8, 5);
  });

  it('Task D point-in-time: exactMatch on first ranking', () => {
    const q: Question = {
      id: 'd-1',
      task: 'D',
      prompt: 'p',
      gold: ['knowledge-001'],
      validAt: '2026-01-01T00:00:00Z',
      difficulty: 'easy',
    };
    const ranking = ['knowledge-001'];
    const result = scoreQuestion(q, ranking, 'D');
    expect(result.exactMatch).toBe(1);
  });

  it('Task D point-in-time: exactMatch=0 when first ranking does not match', () => {
    const q: Question = {
      id: 'd-2',
      task: 'D',
      prompt: 'p',
      gold: ['knowledge-001'],
      validAt: '2026-01-01T00:00:00Z',
      difficulty: 'easy',
    };
    const ranking = ['knowledge-002', 'knowledge-001'];
    const result = scoreQuestion(q, ranking, 'D');
    expect(result.exactMatch).toBe(0);
  });

  it('Task D range: recall@10 when no validAt', () => {
    const q: Question = {
      id: 'd-3',
      task: 'D',
      prompt: 'p',
      gold: ['knowledge-001', 'knowledge-002'],
      difficulty: 'medium',
    };
    const ranking = ['knowledge-001', 'knowledge-002'];
    const result = scoreQuestion(q, ranking, 'D');
    expect(result.recallAt10).toBe(1);
  });

  it('Task E: Recall@10 across gold + goldKnowledge', () => {
    const q: Question = {
      id: 'e-1',
      task: 'E',
      prompt: 'p',
      gold: ['adapters.py#HTTPAdapter'],
      goldKnowledge: ['knowledge-001'],
      difficulty: 'hard',
    };
    const ranking = ['adapters.py#HTTPAdapter', 'knowledge-001'];
    const result = scoreQuestion(q, ranking, 'E');
    expect(result.recallAt10).toBe(1);
  });

  it('Task F: Recall@10', () => {
    const q: Question = {
      id: 'f-1',
      task: 'F',
      prompt: 'p',
      gold: ['fact-001'],
      difficulty: 'easy',
    };
    const ranking = ['fact-001'];
    const result = scoreQuestion(q, ranking, 'F');
    expect(result.recallAt10).toBe(1);
  });
});
