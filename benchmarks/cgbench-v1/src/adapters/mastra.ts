import { mkdirSync } from 'node:fs';
import type { BenchmarkAdapter, IngestStats, QueryOpts } from '../adapter.js';
import type { BenchmarkCorpus, RankedResult } from '../types.js';

export interface MastraAdapterOptions {
  dataDir: string;
}

const BLOCKED_REASON =
  'MastraAdapter is a Plan 3 typed stub — full implementation deferred. ' +
  'Reason: Mastra observational memory (@mastra/memory) is not standalone — it ' +
  'requires embedding inside a full Mastra agent (Observer + Reflector LLMs). ' +
  'The retrieval mode is experimental. An LLM API key (default: Google Gemini) ' +
  'is required at ingest time. The root repo license is NOASSERTION per GitHub API ' +
  '(package.json says Apache-2.0 — verify before use in any benchmark publication). ' +
  'See COMPETITORS.md §5 and Plan 4 spec.';

/**
 * Typed stub for the Mastra observational memory adapter
 * (https://mastra.ai/docs/memory/observational-memory).
 *
 * Mastra wraps conversation turns through an Observer agent that condenses them
 * into observations and a Reflector agent that generates insights. Retrieval is
 * via a `recall` tool exposed to the Mastra agent.
 *
 * This stub satisfies the BenchmarkAdapter interface so that makeAdapter() can
 * compile with the 'mastra' case wired in. Full implementation requires building
 * a headless Mastra agent harness, which is deferred to Plan 4.
 */
export class MastraAdapter implements BenchmarkAdapter {
  readonly name = 'mastra-memory';
  readonly mode = 'native' as const;

  constructor(opts: MastraAdapterOptions) {
    mkdirSync(opts.dataDir, { recursive: true });
  }

  async ingest(_corpus: BenchmarkCorpus): Promise<IngestStats> {
    throw new Error(`DEFERRED: ${BLOCKED_REASON}`);
  }

  async query(_question: string, _opts?: QueryOpts): Promise<RankedResult[]> {
    throw new Error(`DEFERRED: ${BLOCKED_REASON}`);
  }

  async destroy(): Promise<void> {
    // no-op
  }
}
