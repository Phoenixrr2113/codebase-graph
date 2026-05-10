import { mkdirSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { spawnMCPClient, callMCPTool, closeMCPClient } from './_mcp-base.js';
import type { BenchmarkAdapter, IngestStats, QueryOpts } from '../adapter.js';
import type { BenchmarkCorpus, RankedResult } from '../types.js';
import { measureDiskBytes } from '../metrics/resources.js';

// Re-exported so cli.ts `import { CodeGraphAdapter, type DocumentFormat }` continues to compile.
export type DocumentFormat = 'md' | 'pdf' | 'docx' | 'html' | 'csv';

type MCPCodeResult = {
  source?: string;
  id?: string;
  name?: string;
  filePath?: string;
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

    if (opts.mcpServerCommand) {
      this.mcpServerCommand = opts.mcpServerCommand;
    } else {
      // Resolve MCP server path absolutely so it works regardless of CWD.
      // This adapter file lives at:
      //   <repo-root>/benchmarks/cgbench-v1/src/adapters/codegraph.ts
      // Walking up four levels: adapters → src → cgbench-v1 → benchmarks → <repo-root>
      const __filename = fileURLToPath(import.meta.url);
      const __dir = dirname(__filename);
      const workspaceRoot = resolve(__dir, '..', '..', '..', '..');
      const mcpServerPath = resolve(workspaceRoot, 'packages/mcp-server/src/index.ts');
      this.mcpServerCommand = {
        command: 'pnpm',
        args: ['tsx', mcpServerPath],
      };
    }
  }

  /**
   * Lazily spawn the MCP server subprocess on first call. Translates
   * CGBENCH_FALKORDB_HOST/PORT → FALKORDB_HOST/PORT so the MCP server
   * connects to the correct FalkorDB instance when cgbench env vars are set.
   * CODEGRAPH_DATA_DIR is set to the adapter's dataDir.
   */
  private async getClient(): Promise<Client> {
    if (this.client) return this.client;

    // FalkorDB-Docker-only constraint: refuse falkordblite.
    // Silent fallback to FalkorDBLite masks misconfiguration and produces
    // benchmark numbers that don't represent how the system is actually used.
    const driver = process.env['CODEGRAPH_DRIVER'];
    if (driver === 'falkordblite') {
      throw new Error(
        'CODEGRAPH_DRIVER=falkordblite is not supported for cgbench. ' +
        'Start FalkorDB Docker (docker compose --profile bench up -d cgbench-falkordb) ' +
        'and unset CODEGRAPH_DRIVER or set it to "falkordb".',
      );
    }

    // Translate cgbench env vars to the names the codegraph MCP server expects
    const cgbenchHost = process.env['CGBENCH_FALKORDB_HOST'];
    const cgbenchPort = process.env['CGBENCH_FALKORDB_PORT'];
    const translatedEnv: Record<string, string> = {};
    if (cgbenchHost) {
      translatedEnv['FALKORDB_HOST'] = cgbenchHost;
      // When CGBENCH_FALKORDB_HOST is set, force the falkordb (Docker) driver
      translatedEnv['CODEGRAPH_DRIVER'] = process.env['CODEGRAPH_DRIVER'] ?? 'falkordb';
    }
    if (cgbenchPort) {
      translatedEnv['FALKORDB_PORT'] = cgbenchPort;
    }

    // Unique graph name per run prevents cross-run pollution. Without this,
    // every cgbench run writes to the default 'codegraph' graph in
    // cgbench-falkordb, accumulating nodes from prior corpora that never get
    // re-embedded. Result: vector search returns 0 because the labels it
    // queries against have stale/missing embeddings. dataDir is mkdtempSync-
    // generated and unique per run, so basename(dataDir) is collision-safe.
    translatedEnv['FALKORDB_GRAPH'] = process.env['FALKORDB_GRAPH'] ?? basename(this.dataDir);

    // Forward LLM provider from user env. Local Ollama default only when no
    // provider is configured. Forcing LLM_MODEL on top of LLM_PROVIDER=cerebras
    // would produce 404 model_not_found because gemma4:26b is an Ollama model
    // name, not a Cerebras one.
    const userLlmProvider = process.env['LLM_PROVIDER'];
    const llmEnv: Record<string, string> = userLlmProvider
      ? {
          LLM_PROVIDER: userLlmProvider,
          ...(process.env['LLM_MODEL'] ? { LLM_MODEL: process.env['LLM_MODEL'] } : {}),
          ...(process.env['LLM_ENDPOINT'] ? { LLM_ENDPOINT: process.env['LLM_ENDPOINT'] } : {}),
          ...(process.env['LLM_API_KEY'] ? { LLM_API_KEY: process.env['LLM_API_KEY'] } : {}),
        }
      : {
          LLM_PROVIDER: 'ollama',
          OLLAMA_BASE_URL: process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434/v1',
          LLM_MODEL: process.env['OLLAMA_MODEL'] ?? 'gemma4:26b',
        };

    this.client = await spawnMCPClient({
      command: this.mcpServerCommand.command,
      args: this.mcpServerCommand.args,
      env: {
        ...(process.env as Record<string, string>),
        ...translatedEnv,
        CODEGRAPH_DATA_DIR: this.dataDir,
        ...(process.env['CODEGRAPH_EMBEDDING_PROVIDER']
          ? { CODEGRAPH_EMBEDDING_PROVIDER: process.env['CODEGRAPH_EMBEDDING_PROVIDER'] }
          : {}),
        CODEGRAPH_RERANK_PROVIDER: process.env['CODEGRAPH_RERANK_PROVIDER'] ?? 'none',
        CODEGRAPH_RAW_TOOLS: 'true',
        ...llmEnv,
        ...(process.env['OPENROUTER_API_KEY'] ? { OPENROUTER_API_KEY: process.env['OPENROUTER_API_KEY'] } : {}),
        ...(process.env['CEREBRAS_API_KEY'] ? { CEREBRAS_API_KEY: process.env['CEREBRAS_API_KEY'] } : {}),
      } as Record<string, string>,
    });
    return this.client;
  }

  /**
   * Configure the active projects on the spawned MCP server. Idempotent.
   * Always called from `ingest()`. Also called by `attach()` when running
   * with --skip-ingest so the persisted ~/.codegraph config from a prior
   * session doesn't auto-scope queries to a stale active project.
   */
  private async configureProjects(corpus: BenchmarkCorpus): Promise<string[]> {
    const client = await this.getClient();
    const codeRootPaths = corpus.codeRoots.map((r) => resolve(r.path));
    if (codeRootPaths.length > 0) {
      await callMCPTool(client, 'codebase', {
        action: 'configure',
        projectAction: 'set',
        projects: codeRootPaths,
      });
    }
    return codeRootPaths;
  }

  /**
   * Configure projects without ingesting. Use when reusing a populated graph
   * across iterations — saves the multi-minute reindex+embedding cycle but
   * still updates the MCP server's active-project config so search.find
   * auto-scopes correctly.
   */
  async attach(corpus: BenchmarkCorpus): Promise<void> {
    const codeRootPaths = await this.configureProjects(corpus);
    console.error(
      `[codegraph adapter] attached (skip-ingest) — projects=${codeRootPaths.length}`,
    );
  }

  async ingest(corpus: BenchmarkCorpus): Promise<IngestStats> {
    const start = Date.now();
    const client = await this.getClient();
    const log = (msg: string) =>
      console.error(`[codegraph adapter] [+${((Date.now() - start) / 1000).toFixed(1)}s] ${msg}`);

    log(`ingest start — corpus codeRoots=${corpus.codeRoots.length} documentRoot=${corpus.documentRoot ?? 'none'}`);
    const codeRootPaths = await this.configureProjects(corpus);
    if (codeRootPaths.length > 0) {
      log(`configure projects (absolute): ${codeRootPaths.join(', ')}`);
    }

    // 2) Trigger full reindex — use extended timeout (5 min) because embedding
    //    1700+ entities exceeds the MCP SDK's default 60s request timeout.
    log(`reindex full — calling codebase.reindex (5min timeout)`);
    const reindexResult = (await callMCPTool<{
      filesProcessed?: number;
      symbolsUpdated?: number;
      embeddingsDeferred?: boolean;
      embeddedCount?: number;
      duration?: number;
    }>(
      client,
      'codebase',
      { action: 'reindex', mode: 'full' },
      5 * 60 * 1000,
    )) ?? {};
    log(
      `reindex returned — files=${reindexResult.filesProcessed ?? '?'} ` +
      `symbols=${reindexResult.symbolsUpdated ?? '?'} ` +
      `deferred=${reindexResult.embeddingsDeferred ?? '?'} ` +
      `embeddedSoFar=${reindexResult.embeddedCount ?? '?'} ` +
      `duration=${reindexResult.duration ?? '?'}ms`,
    );

    // 3) No polling needed — codebase.reindex now blocks on embeddings by default
    //    (see Change 2 in 2026-05-10 spec). reindexResult.embeddedCount reflects
    //    the final count post-embedding.
    log(`embeddings done — embeddedCount=${reindexResult.embeddedCount ?? '?'}`);

    // 4) Knowledge & document corpus ingest via raw 'add' tool (requires
    //    CODEGRAPH_RAW_TOOLS=true). The 'knowledge' persona only exposes
    //    store/recall — use the raw tool directly. Both knowledgeRoot and
    //    documentRoot funnel through the same MCP tool: knowledgeRoot is
    //    used by Tasks D/E (temporal recall + linked code+knowledge) and
    //    documentRoot is used by Task F (document retrieval). Same path-
    //    resolution gotcha as code roots: resolve to absolute.
    let knowledgeFileCount = 0;
    const docRoots: Array<{ root: string; label: string }> = [];
    if (corpus.knowledgeRoot) docRoots.push({ root: corpus.knowledgeRoot, label: 'knowledge' });
    if (corpus.documentRoot) docRoots.push({ root: corpus.documentRoot, label: 'document' });

    for (const { root, label } of docRoots) {
      const rootAbs = resolve(root);
      const entries = await readdir(rootAbs, { withFileTypes: true });
      log(`${label} ingest start — root=${rootAbs} files=${entries.length}`);
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (entry.name.startsWith('.')) continue;
        // Skip README — it's metadata for the corpus, not benchmark content.
        if (entry.name.toLowerCase() === 'readme.md') continue;
        const filePath = join(rootAbs, entry.name);
        const slug = basename(entry.name, extname(entry.name));
        try {
          await callMCPTool(
            client,
            'add',
            { input: filePath, source: `cgbench:${slug}` },
            60_000,
          );
          knowledgeFileCount++;
        } catch (err) {
          console.warn(
            `[codegraph adapter] add failed for ${filePath}: ${
              err instanceof Error ? err.message : String(err)
            }. Skipping.`,
          );
        }
      }
      log(`${label} ingest done — running total ${knowledgeFileCount} files added`);
    }

    const durationMs = Date.now() - start;
    const diskBytesAfter = await measureDiskBytes(this.dataDir);
    const totalTokens = Math.floor(diskBytesAfter / 4);
    const totalDocs = codeRootPaths.length + knowledgeFileCount;
    log(`ingest complete — totalDocs=${totalDocs} durationMs=${durationMs} diskBytes=${diskBytesAfter}`);
    return { totalDocs, totalTokens, durationMs, diskBytesAfter };
  }

  async query(question: string, opts: QueryOpts = {}): Promise<RankedResult[]> {
    const client = await this.getClient();
    const limit = opts.topK ?? 10;
    const task = opts.task;
    const t0 = Date.now();
    const qPreview = question.length > 60 ? question.slice(0, 57) + '...' : question;
    const logQ = (msg: string) =>
      console.error(`[codegraph adapter] [task=${task ?? '?'}] (${Date.now() - t0}ms) ${msg}`);
    logQ(`query start — "${qPreview}"`);

    if (task === 'A') {
      const result = (await callMCPTool<{ results?: Array<MCPCodeResult> }>(
        client,
        'search',
        { action: 'find', query: question, limit },
      )) ?? {};
      const out = (result.results ?? []).map((r, i) => ({
        id: this.codeId(r.filePath, r.name),
        score: r.score ?? 1 / (i + 1),
        kind: 'code' as const,
      }));
      logQ(`A → search.find returned ${result.results?.length ?? 0} results, top=${out[0]?.id ?? '<none>'}`);
      return out;
    }

    if (task === 'D') {
      // Bitemporal recall — semantic question search through knowledge entities.
      // The persona's `recall` action does an entity-text exact match (returns
      // {entity, relationships}), which doesn't match natural-language queries.
      // Use the raw `query_knowledge` tool with semanticQuery for vector search,
      // which returns {entities: [{ id, text, sampleIds, ... }]}.
      const args: Record<string, unknown> = { semanticQuery: question, limit };
      if (opts.validAt) args['at'] = opts.validAt;
      const result = (await callMCPTool<{
        entities?: Array<{ id: string; text: string; sampleIds?: string[]; relevance?: number }>;
      }>(
        client,
        'query_knowledge',
        args,
      )) ?? {};
      const out = (result.entities ?? []).map((e, i) => ({
        id: this.knowledgeId({
          ...(e.sampleIds ? { sampleIds: e.sampleIds } : {}),
          text: e.text,
        }),
        score: e.relevance ?? 1 / (i + 1),
        kind: 'knowledge' as const,
      }));
      logQ(`D → query_knowledge(semantic) returned ${result.entities?.length ?? 0} results, top=${out[0]?.id ?? '<none>'} validAt=${opts.validAt ?? 'none'}`);
      return out;
    }

    if (task === 'E') {
      // unifiedSearch result shape:
      //   code:      { source: 'code', name, type, filePath, properties: {...} }
      //   knowledge: { source: 'knowledge', name: <text>, type, properties: { sampleIds, ... } }
      // Note: sampleIds for knowledge live under .properties, not top-level
      // (unlike query_knowledge which surfaces them at top-level).
      type UnifiedRow = {
        source: 'code' | 'knowledge';
        name?: string;
        filePath?: string;
        score?: number;
        properties?: { sampleIds?: string[] };
      };
      const result = (await callMCPTool<{ results?: Array<UnifiedRow> }>(
        client,
        'search',
        { action: 'find', query: question, searchScope: 'all', limit },
      )) ?? {};
      const out = (result.results ?? []).map((r, i) => {
        const isKnowledge = r.source === 'knowledge';
        const id = isKnowledge
          ? this.knowledgeId({
              ...(r.properties?.sampleIds ? { sampleIds: r.properties.sampleIds } : {}),
              ...(r.name ? { text: r.name } : {}),
            })
          : this.codeId(r.filePath, r.name);
        return {
          id,
          score: r.score ?? 1 / (i + 1),
          kind: isKnowledge ? ('knowledge' as const) : ('code' as const),
        };
      });
      logQ(`E → search.find(all) returned ${result.results?.length ?? 0} results, top=${out[0]?.id ?? '<none>'}`);
      return out;
    }

    if (task === 'F') {
      // Task F is non-temporal document retrieval. Same shape problem as D:
      // the persona's `recall` does entity-text exact match, not NL search.
      // Route through query_knowledge with semanticQuery.
      const result = (await callMCPTool<{
        entities?: Array<{ id: string; text: string; sampleIds?: string[]; relevance?: number }>;
      }>(
        client,
        'query_knowledge',
        { semanticQuery: question, limit },
      )) ?? {};
      const out = (result.entities ?? []).map((e, i) => ({
        id: this.knowledgeId({
          ...(e.sampleIds ? { sampleIds: e.sampleIds } : {}),
          text: e.text,
        }),
        score: e.relevance ?? 1 / (i + 1),
        kind: 'knowledge' as const,
      }));
      logQ(`F → query_knowledge(semantic) returned ${result.entities?.length ?? 0} results, top=${out[0]?.id ?? '<none>'}`);
      return out;
    }

    if (task === 'B' || task === 'C') {
      // Vector retrieval only. CodeGraph does not claim NL→Cypher capability;
      // structural traversal questions get partial recall via vector similarity
      // and may score honestly low. See spec 2026-05-10-cgbench-adapter-purity.
      const result = (await callMCPTool<{ results?: Array<MCPCodeResult> }>(
        client,
        'search',
        { action: 'find', query: question, limit },
      )) ?? {};
      const out = (result.results ?? []).map((r, i) => ({
        id: this.codeId(r.filePath, r.name),
        score: r.score ?? 1 / (i + 1),
        kind: 'code' as const,
      }));
      logQ(`${task} → search.find returned ${result.results?.length ?? 0} results, top=${out[0]?.id ?? '<none>'}`);
      return out;
    }

    // Default fallback (no task metadata) — text retrieval semantics
    const result = (await callMCPTool<{ results?: Array<MCPCodeResult> }>(
      client,
      'search',
      { action: 'find', query: question, limit },
    )) ?? {};
    const out = (result.results ?? []).map((r, i) => ({
      id: this.codeId(r.filePath, r.name),
      score: r.score ?? 1 / (i + 1),
      kind: 'code' as const,
    }));
    logQ(`(default) → search.find returned ${result.results?.length ?? 0} results, top=${out[0]?.id ?? '<none>'}`);
    return out;
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
