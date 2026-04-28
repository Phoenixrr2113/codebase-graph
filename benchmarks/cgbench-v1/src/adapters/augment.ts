import { mkdirSync } from 'node:fs';
import type { BenchmarkAdapter, IngestStats, QueryOpts } from '../adapter.js';
import type { BenchmarkCorpus, RankedResult } from '../types.js';

export interface AugmentAdapterOptions {
  dataDir: string;
}

const BLOCKED_REASON =
  'AugmentAdapter is a Plan 3 typed stub — full implementation deferred to Plan 4. ' +
  'Reason: Augment Code requires paid account ($20/mo minimum, credit-based pricing) ' +
  'and confirmation of cost budget before any benchmark queries are run. ' +
  "See COMPETITORS.md and the spec's \"Augment runs LAST\" rule.";

/**
 * Typed stub for the Augment Code adapter (https://www.augmentcode.com/).
 *
 * Augment Code is an AI coding assistant with deep codebase indexing via its
 * MCP server. The user has the MCP server installed locally, but operational
 * benchmark runs require paying per-query credits.
 *
 * Full implementation is deferred to Plan 4. This stub satisfies the
 * BenchmarkAdapter interface so that makeAdapter() can compile with the
 * 'augment' case wired in.
 */
export class AugmentAdapter implements BenchmarkAdapter {
  readonly name = 'augment';
  readonly mode = 'mcp' as const;

  constructor(opts: AugmentAdapterOptions) {
    mkdirSync(opts.dataDir, { recursive: true });
  }

  async ingest(_corpus: BenchmarkCorpus): Promise<IngestStats> {
    throw new Error(`BLOCKED: ${BLOCKED_REASON}`);
  }

  async query(_question: string, _opts?: QueryOpts): Promise<RankedResult[]> {
    throw new Error(`BLOCKED: ${BLOCKED_REASON}`);
  }

  async destroy(): Promise<void> {
    // no-op
  }
}
