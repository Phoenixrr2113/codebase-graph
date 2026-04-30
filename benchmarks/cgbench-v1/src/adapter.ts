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
  /**
   * Optional. Called when the runner is in --skip-ingest mode (reusing a
   * populated index). Adapters that need to update mutable state per-corpus
   * (e.g. configure active projects, set search scope, point at a cached
   * graph) should implement this. Adapters that need no per-corpus state
   * can leave it undefined.
   */
  attach?(corpus: BenchmarkCorpus): Promise<void>;
  query(question: string, opts?: QueryOpts): Promise<RankedResult[]>;
  destroy(): Promise<void>;
}
