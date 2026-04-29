import { mkdirSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { spawnMCPClient, callMCPTool, closeMCPClient } from './_mcp-base.js';
import type { BenchmarkAdapter, IngestStats, QueryOpts } from '../adapter.js';
import type { BenchmarkCorpus, RankedResult } from '../types.js';
import { measureDiskBytes } from '../metrics/resources.js';
import { generateCypher } from './_ollama.js';

// Re-exported so cli.ts `import { CodeGraphAdapter, type DocumentFormat }` continues to compile.
export type DocumentFormat = 'md' | 'pdf' | 'docx' | 'html' | 'csv';

type MCPCodeResult = {
  source?: string;
  id?: string;
  name?: string;
  filePath?: string;
  score?: number;
};

type MCPKnowledgeResult = {
  source?: string;
  slug?: string;
  sampleIds?: string[];
  text?: string;
  score?: number;
};

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
    let indexingComplete = false;
    while (Date.now() - pollStart < POLL_TIMEOUT_MS) {
      const status = (await callMCPTool<{ indexing?: boolean }>(client, 'codebase', {
        action: 'status',
      })) ?? {};
      if (status.indexing !== true) {
        indexingComplete = true;
        break;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    if (!indexingComplete) {
      throw new Error('CodeGraph reindex timed out after 5 minutes');
    }

    // 4) Knowledge corpus ingest via knowledge persona
    let knowledgeFileCount = 0;
    if (corpus.documentRoot) {
      const entries = await readdir(corpus.documentRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (entry.name.startsWith('.')) continue;
        const filePath = join(corpus.documentRoot, entry.name);
        const slug = basename(entry.name, extname(entry.name));
        try {
          await callMCPTool(client, 'knowledge', {
            action: 'add',
            input: filePath,
            source: `cgbench:${slug}`,
          });
          knowledgeFileCount++;
        } catch (err) {
          console.warn(
            `[codegraph adapter] knowledge.add failed for ${filePath}: ${
              err instanceof Error ? err.message : String(err)
            }. Skipping.`,
          );
        }
      }
    }

    const durationMs = Date.now() - start;
    const diskBytesAfter = await measureDiskBytes(this.dataDir);
    const totalTokens = Math.floor(diskBytesAfter / 4);
    const totalDocs = codeRootPaths.length + knowledgeFileCount;
    return { totalDocs, totalTokens, durationMs, diskBytesAfter };
  }

  async query(question: string, opts: QueryOpts = {}): Promise<RankedResult[]> {
    const client = await this.getClient();
    const limit = opts.topK ?? 10;
    const task = opts.task;

    if (task === 'A') {
      const result = (await callMCPTool<{ results?: Array<MCPCodeResult> }>(
        client,
        'search',
        { action: 'find', query: question, limit },
      )) ?? {};
      return (result.results ?? []).map((r, i) => ({
        id: this.codeId(r.filePath, r.name),
        score: r.score ?? 1 / (i + 1),
        kind: 'code' as const,
      }));
    }

    if (task === 'D') {
      const args: Record<string, unknown> = { action: 'recall', text: question };
      if (opts.validAt) args['at'] = opts.validAt;
      const result = (await callMCPTool<{ results?: Array<MCPKnowledgeResult> }>(
        client,
        'knowledge',
        args,
      )) ?? {};
      return (result.results ?? []).map((r, i) => ({
        id: this.knowledgeId(r),
        score: r.score ?? 1 / (i + 1),
        kind: 'knowledge' as const,
      }));
    }

    if (task === 'E') {
      const result = (await callMCPTool<{ results?: Array<MCPCodeResult & MCPKnowledgeResult> }>(
        client,
        'search',
        { action: 'find', query: question, searchScope: 'all', limit },
      )) ?? {};
      return (result.results ?? []).map((r, i) => ({
        id: r.source === 'knowledge' ? this.knowledgeId(r) : this.codeId(r.filePath, r.name),
        score: r.score ?? 1 / (i + 1),
        kind: r.source === 'knowledge' ? ('knowledge' as const) : ('code' as const),
      }));
    }

    if (task === 'F') {
      // Task F is non-temporal document retrieval — validAt is deliberately omitted
      // (vs Task D which honors validAt for point-in-time queries).
      const result = (await callMCPTool<{ results?: Array<MCPKnowledgeResult> }>(
        client,
        'knowledge',
        { action: 'recall', text: question },
      )) ?? {};
      return (result.results ?? []).map((r, i) => ({
        id: this.knowledgeId(r),
        score: r.score ?? 1 / (i + 1),
        kind: 'knowledge' as const,
      }));
    }

    if (task === 'B' || task === 'C') {
      const gen = await generateCypher({ question, taskHint: task });

      if (gen.cypher === null) {
        // LLM failed twice; return empty ranking (will score as 0)
        console.warn(`[codegraph adapter] Ollama failed to generate valid Cypher for ${task} question; scoring as 0`);
        return [];
      }

      const result = (await callMCPTool<{ success?: boolean; data?: Array<Record<string, unknown>> }>(
        client,
        'query',
        { cypher: gen.cypher },  // limit removed — query tool doesn't accept it; rely on .slice() below
      )) ?? {};

      return (result.data ?? []).slice(0, limit).map((row, i) => {
        // Find the first node-shaped value in the row (has filePath + name).
        // NOTE: when Cypher returns multiple node columns (e.g. RETURN caller, callee),
        // the winner depends on column order — Object.values is insertion-order stable.
        let node: { filePath?: string; name?: string } | null = null;
        for (const v of Object.values(row)) {
          if (v && typeof v === 'object' && 'name' in v && 'filePath' in v) {
            node = v as { filePath?: string; name?: string };
            break;
          }
        }
        return {
          id: this.codeId(node?.filePath, node?.name),
          score: 1 / (i + 1),
          kind: 'code' as const,
        };
      });
    }

    // Default fallback (no task metadata) — text retrieval semantics
    const result = (await callMCPTool<{ results?: Array<MCPCodeResult> }>(
      client,
      'search',
      { action: 'find', query: question, limit },
    )) ?? {};
    return (result.results ?? []).map((r, i) => ({
      id: this.codeId(r.filePath, r.name),
      score: r.score ?? 1 / (i + 1),
      kind: 'code' as const,
    }));
  }

  private codeId(filePath: string | undefined, name: string | undefined): string {
    const basename = (filePath ?? 'unknown').split('/').pop() ?? 'unknown';
    return `${basename}#${name ?? 'unknown'}`;
  }

  private knowledgeId(result: { slug?: string; sampleIds?: string[]; text?: string }): string {
    if (result.sampleIds) {
      for (const sid of result.sampleIds) {
        if (sid.startsWith('cgbench:')) return sid.slice('cgbench:'.length);
      }
    }
    return result.slug ?? result.text ?? 'unknown';
  }

  async destroy(): Promise<void> {
    if (this.client) {
      await closeMCPClient(this.client);
      this.client = null;
    }
  }
}
