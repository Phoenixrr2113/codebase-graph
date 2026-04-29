import { mkdirSync } from 'node:fs';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { spawnMCPClient, closeMCPClient } from './_mcp-base.js';
import type { BenchmarkAdapter, IngestStats, QueryOpts } from '../adapter.js';
import type { BenchmarkCorpus, RankedResult } from '../types.js';

// Re-exported so cli.ts `import { CodeGraphAdapter, type DocumentFormat }` continues to compile.
export type DocumentFormat = 'md' | 'pdf' | 'docx' | 'html' | 'csv';

export interface CodeGraphAdapterOptions {
  /** Where the adapter stores per-corpus state (FalkorDB data dir, etc.) */
  dataDir: string;
  /**
   * Path to the codegraph MCP server entry point. Defaults to spawning via
   * `pnpm tsx packages/mcp-server/src/index.ts` from the workspace root,
   * because `dist/index.js` has a pre-existing extensionless-ESM-import issue.
   */
  mcpServerCommand?: { command: string; args: string[] };
  /**
   * @deprecated Accepted for backwards compatibility with cli.ts call sites that
   * still pass documentFormat. Has no effect — the MCP server auto-detects format.
   */
  documentFormat?: DocumentFormat;
}

export class CodeGraphAdapter implements BenchmarkAdapter {
  readonly name = 'codegraph';
  readonly mode = 'mcp' as const;
  private client: Client | null = null;
  private readonly dataDir: string;
  private readonly mcpServerCommand: { command: string; args: string[] };

  constructor(opts: CodeGraphAdapterOptions) {
    this.dataDir = opts.dataDir;
    mkdirSync(this.dataDir, { recursive: true });

    // Default: spawn via tsx in dev mode (dist/index.js has a pre-existing
    // ESM-resolution issue that blocks `node dist/index.js`).
    this.mcpServerCommand = opts.mcpServerCommand ?? {
      command: 'pnpm',
      args: ['tsx', 'packages/mcp-server/src/index.ts'],
    };
  }

  /**
   * Lazily spawn the MCP server subprocess on first call. The subprocess
   * inherits CGBENCH_FALKORDB_HOST/PORT and CODEGRAPH_* env from the
   * benchmark CLI. CODEGRAPH_DATA_DIR is set to the adapter's dataDir.
   */
  private async getClient(): Promise<Client> {
    if (this.client) return this.client;

    this.client = await spawnMCPClient({
      command: this.mcpServerCommand.command,
      args: this.mcpServerCommand.args,
      env: {
        ...process.env,
        CODEGRAPH_DATA_DIR: this.dataDir,
        // Force local embeddings + no reranker for benchmark — no API spend.
        // Caller can override via env.
        CODEGRAPH_EMBEDDING_PROVIDER: process.env['CODEGRAPH_EMBEDDING_PROVIDER'] ?? 'local',
        CODEGRAPH_RERANK_PROVIDER: process.env['CODEGRAPH_RERANK_PROVIDER'] ?? 'none',
      } as Record<string, string>,
    });
    return this.client;
  }

  async ingest(_corpus: BenchmarkCorpus): Promise<IngestStats> {
    // TODO Task 9: implement via MCP tools
    await this.getClient(); // will be used by Task 9 implementation
    throw new Error('Not yet implemented (Task 9)');
  }

  async query(_question: string, _opts: QueryOpts = {}): Promise<RankedResult[]> {
    // TODO Tasks 10/11: implement task-routed MCP calls
    await this.getClient(); // will be used by Tasks 10/11 implementation
    throw new Error('Not yet implemented (Tasks 10/11)');
  }

  async destroy(): Promise<void> {
    if (this.client) {
      await closeMCPClient(this.client);
      this.client = null;
    }
  }
}
