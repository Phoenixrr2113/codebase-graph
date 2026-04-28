import type { BenchmarkCorpus, RankedResult } from './types.js';

export type AdapterMode = 'mcp' | 'native';

export interface IngestStats {
  durationMs: number;
  totalDocs: number;
  totalTokens: number;
  diskBytesAfter: number;
}

export interface QueryOpts {
  topK?: number;
  scope?: 'code' | 'knowledge' | 'all';
}

export interface BenchmarkAdapter {
  readonly name: string;
  readonly mode: AdapterMode;
  ingest(corpus: BenchmarkCorpus): Promise<IngestStats>;
  query(question: string, opts?: QueryOpts): Promise<RankedResult[]>;
  destroy(): Promise<void>;
}
