import { z } from 'zod';

export const LanguageSchema = z.enum(['python', 'typescript', 'go', 'rust']);
export type Language = z.infer<typeof LanguageSchema>;

export const CodeRootSchema = z.object({
  language: LanguageSchema,
  path: z.string(),
  commitSha: z.string(),
});
export type CodeRoot = z.infer<typeof CodeRootSchema>;

export const BenchmarkCorpusSchema = z.object({
  codeRoots: z.array(CodeRootSchema),
  knowledgeRoot: z.string().optional(),
  documentRoot: z.string().optional(),
});
export type BenchmarkCorpus = z.infer<typeof BenchmarkCorpusSchema>;

export const TaskLetterSchema = z.enum(['A', 'B', 'C', 'D', 'E', 'F']);
export type TaskLetter = z.infer<typeof TaskLetterSchema>;

export const QuestionSchema = z.object({
  id: z.string(),
  task: TaskLetterSchema,
  prompt: z.string(),
  gold: z.array(z.string()),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  language: LanguageSchema.optional(),
  validAt: z.string().optional(),
  hopDistance: z.record(z.string(), z.number()).optional(),
  goldKnowledge: z.array(z.string()).optional(),
  format: z.enum(['md', 'pdf', 'docx', 'html', 'csv']).optional(),
});
export type Question = z.infer<typeof QuestionSchema>;

export const RankedResultSchema = z.object({
  id: z.string(),
  score: z.number(),
  kind: z.enum(['code', 'knowledge']),
  raw: z.unknown().optional(),
});
export type RankedResult = z.infer<typeof RankedResultSchema>;
