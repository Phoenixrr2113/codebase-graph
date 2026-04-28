import { mkdirSync } from 'node:fs';
import type { BenchmarkAdapter, IngestStats, QueryOpts } from '../adapter.js';
import type { BenchmarkCorpus, RankedResult } from '../types.js';

export interface CogneeAdapterOptions {
  dataDir: string;
}

const BLOCKED_REASON =
  'CogneeAdapter is a Plan 3 typed stub — full implementation deferred. ' +
  'Reason: Cognee requires (1) a repo clone + uv sync of cognee/cognee-mcp, ' +
  '(2) an LLM API key (OpenAI or compatible) for graph construction at ingest time, ' +
  'and (3) the Python 3.10–3.13 cognee SDK. ' +
  'The MCP server is not pip-installable and the Python integration is non-trivial. ' +
  'See COMPETITORS.md §2 and Plan 4 spec.';

/**
 * Typed stub for the Cognee adapter (https://github.com/topoteretes/cognee).
 *
 * Cognee builds structured knowledge graphs from text using an LLM at ingest
 * time. The MCP server lives in cognee/cognee-mcp and requires source-clone
 * install via uv. An LLM API key is mandatory even for local use.
 *
 * Full implementation is deferred to Plan 4. This stub satisfies the
 * BenchmarkAdapter interface so that makeAdapter() can compile with the
 * 'cognee' case wired in.
 */
export class CogneeAdapter implements BenchmarkAdapter {
  readonly name = 'cognee';
  readonly mode = 'native' as const;

  constructor(opts: CogneeAdapterOptions) {
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
