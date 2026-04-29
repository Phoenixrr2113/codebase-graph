import { mkdirSync } from 'node:fs';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { spawnMCPClient, callMCPTool, closeMCPClient } from './_mcp-base.js';
import type { BenchmarkAdapter, IngestStats, QueryOpts } from '../adapter.js';
import type { BenchmarkCorpus, RankedResult } from '../types.js';
import { measureDiskBytes } from '../metrics/resources.js';

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
    // Relative to the workspace root — the cgbench CLI must be invoked from
    // the workspace root, which is the convention for `pnpm tsx ...` commands.
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

  async ingest(corpus: BenchmarkCorpus): Promise<IngestStats> {
    const start = Date.now();
    const client = await this.getClient();

    // 1) Configure projects via codebase persona
    const codeRootPaths = corpus.codeRoots.map((r) => r.path);
    if (codeRootPaths.length > 0) {
      await callMCPTool(client, 'codebase', {
        action: 'configure',
        projectAction: 'set',
        projects: codeRootPaths,
      });
    }

    // 2) Trigger full reindex
    await callMCPTool(client, 'codebase', {
      action: 'reindex',
      mode: 'full',
    });

    // 3) Poll status until indexing complete (or timeout)
    const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
    const POLL_INTERVAL_MS = 2000;
    const pollStart = Date.now();
    while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
      const status = (await callMCPTool<{ indexing?: boolean }>(client, 'codebase', {
        action: 'status',
      })) ?? {};
      if (status.indexing !== true) break;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }

    // 4) Knowledge corpus ingest via knowledge persona
    if (corpus.documentRoot) {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const entries = await fs.readdir(corpus.documentRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (entry.name.startsWith('.')) continue;
        const filePath = path.join(corpus.documentRoot, entry.name);
        const slug = path.basename(entry.name, path.extname(entry.name));
        await callMCPTool(client, 'knowledge', {
          action: 'add',
          input: filePath,
          source: `cgbench:${slug}`,
        });
      }
    }

    const durationMs = Date.now() - start;
    const diskBytesAfter = await measureDiskBytes(this.dataDir);
    const totalTokens = Math.floor(diskBytesAfter / 4);
    const totalDocs = codeRootPaths.length + (corpus.documentRoot ? 1 : 0);
    return { totalDocs, totalTokens, durationMs, diskBytesAfter };
  }

  async query(_question: string, _opts: QueryOpts = {}): Promise<RankedResult[]> {
    throw new Error('Not yet implemented (Tasks 10/11)');
  }

  async destroy(): Promise<void> {
    if (this.client) {
      await closeMCPClient(this.client);
      this.client = null;
    }
  }
}
