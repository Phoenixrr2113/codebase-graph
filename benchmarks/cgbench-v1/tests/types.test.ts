import { describe, expect, it } from 'vitest';
import {
  BenchmarkCorpusSchema,
  QuestionSchema,
  RankedResultSchema,
} from '../src/types.js';

describe('schemas', () => {
  it('BenchmarkCorpus accepts code-only corpus', () => {
    const corpus = {
      codeRoots: [{ language: 'typescript' as const, path: '/tmp/x', commitSha: 'abc' }],
      knowledgeRoot: undefined,
      documentRoot: undefined,
    };
    expect(BenchmarkCorpusSchema.parse(corpus)).toMatchObject(corpus);
  });

  it('Question requires id, task, prompt, gold', () => {
    const q = {
      id: 'a-001',
      task: 'A' as const,
      prompt: 'find the function that retries',
      gold: ['psf/requests/sessions.py#retry'],
    };
    expect(QuestionSchema.parse(q)).toMatchObject(q);
  });

  it('Question rejects unknown task letter', () => {
    expect(() =>
      QuestionSchema.parse({ id: 'x', task: 'Z', prompt: 'p', gold: [] }),
    ).toThrow();
  });

  it('RankedResult requires id, score, kind', () => {
    const r = { id: 'foo.ts#bar', score: 0.5, kind: 'code' as const };
    expect(RankedResultSchema.parse(r)).toMatchObject(r);
  });
});
