import type { BenchmarkCorpus, RankedResult, TaskLetter } from './types.js';

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
  /** Task type — used by adapters to route to the correct production capability */
  task?: TaskLetter;
  /** Bitemporal point-in-time filter (ISO timestamp) — used by Task D */
  validAt?: string;
}

export interface BenchmarkAdapter {
  readonly name: string;
  readonly mode: AdapterMode;
  ingest(corpus: BenchmarkCorpus): Promise<IngestStats>;
  query(question: string, opts?: QueryOpts): Promise<RankedResult[]>;
  destroy(): Promise<void>;
}
