import { mkdirSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

    // Resolve the embedding provider once and derive its required vector dim.
    // The user's .env may carry a stale CODEGRAPH_EMBEDDING_DIM (e.g. 1024 from
    // a prior Voyage configuration). If we let that leak through to the MCP
    // server while we're forcing CODEGRAPH_EMBEDDING_PROVIDER=local, the vector
    // index gets created at the wrong dim and every search returns 0 results.
    const embeddingProvider = process.env['CODEGRAPH_EMBEDDING_PROVIDER'] ?? 'local';
    const PROVIDER_DIM: Record<string, string> = {
      voyage: '1024',
      openrouter: '1536',
      local: '768',
    };
    const embeddingDim = PROVIDER_DIM[embeddingProvider];

    // LLM env: forward the user's setup if they have one (cerebras, openrouter,
    // glm, etc.). Only fall back to local Ollama defaults when no provider is
    // configured. Forcing LLM_MODEL=gemma4:26b on top of LLM_PROVIDER=cerebras
    // produces 404 model_not_found from Cerebras because gemma4:26b is an
    // Ollama model name, not a Cerebras one.
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

    // Strip env vars that would conflict with what we're forcing — we don't
    // want process.env entries leaking through ...spread to override our
    // intentional settings below.
    const { CODEGRAPH_EMBEDDING_DIM: _stale, ...sanitizedProcessEnv } =
      process.env as Record<string, string | undefined>;
    void _stale;

    this.client = await spawnMCPClient({
      command: this.mcpServerCommand.command,
      args: this.mcpServerCommand.args,
      env: {
        ...sanitizedProcessEnv,
        ...translatedEnv,
        CODEGRAPH_DATA_DIR: this.dataDir,
        CODEGRAPH_EMBEDDING_PROVIDER: embeddingProvider,
        ...(embeddingDim ? { CODEGRAPH_EMBEDDING_DIM: embeddingDim } : {}),
        CODEGRAPH_RERANK_PROVIDER: process.env['CODEGRAPH_RERANK_PROVIDER'] ?? 'none',
        // Enable raw tools so the 'add' document ingestion tool is available
        // (the 'knowledge' persona only exposes store/recall).
        CODEGRAPH_RAW_TOOLS: 'true',
        ...llmEnv,
        // Always forward provider keys regardless of which provider is active —
        // the MCP server may need any of them at runtime (e.g. embedding +
        // separate LLM extraction provider).
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

    // 3) Wait for deferred embeddings to actually finish.
    //    The reindex tool returns the moment structural indexing is done;
    //    embedAllParsedEntities() runs as a fire-and-forget promise after that.
    //    Querying the graph before embeddings exist returns empty results for
    //    Function/Class/Interface/Type/Component nodes (the labels embed-pass.ts
    //    populates).
    //
    //    embed-pass.ts deliberately skips trivial functions, type-aliases without
    //    docstrings, etc. — those nodes keep n.embedding=NULL forever. So
    //    polling for "pending = 0" hangs indefinitely. Use plateau detection:
    //    when pending stops decreasing for PLATEAU_POLLS consecutive polls, the
    //    embedder has stopped doing work — we're done.
    const EMBED_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
    const POLL_INTERVAL_MS = 2000;
    const PLATEAU_POLLS = 6; // 6 × 2s = 12s of no change
    const pollStart = Date.now();
    let embeddingsComplete = false;
    let lastPending = -1;
    let initialPending = -1;
    let stableCount = 0;
    while (Date.now() - pollStart < EMBED_TIMEOUT_MS) {
      const result = (await callMCPTool<{ data?: Array<{ pending: number }> }>(
        client,
        'query',
        {
          cypher:
            'MATCH (n) WHERE n.embedding IS NULL ' +
            'AND (n:Function OR n:Class OR n:Interface OR n:Type OR n:Component) ' +
            'RETURN count(n) AS pending',
        },
      )) ?? {};
      const pending = result.data?.[0]?.pending ?? -1;
      if (initialPending === -1) initialPending = pending;
      if (pending === 0) {
        log(`embeddings complete — 0 unembedded after ${((Date.now() - pollStart) / 1000).toFixed(1)}s`);
        embeddingsComplete = true;
        break;
      }
      if (pending === lastPending) {
        stableCount++;
        if (stableCount >= PLATEAU_POLLS) {
          // Plateau reached — embedder has stopped writing. The remaining
          // pending nodes are the deliberately-skipped trivial entities.
          const elapsed = ((Date.now() - pollStart) / 1000).toFixed(1);
          const decreased = initialPending - pending;
          log(
            `embeddings plateau — ${pending} unembedded (skipped trivial), ` +
            `${decreased} processed in ${elapsed}s`,
          );
          embeddingsComplete = true;
          break;
        }
      } else {
        log(`waiting for embeddings: pending=${pending}`);
        lastPending = pending;
        stableCount = 0;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    if (!embeddingsComplete) {
      throw new Error(
        `CodeGraph embeddings did not complete within 10 minutes (last pending=${lastPending})`,
      );
    }

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
      logQ(`${task} → generating Cypher via LLM`);
      const gen = await generateCypher({ question, taskHint: task });

      if (gen.cypher === null) {
        // LLM failed twice; return empty ranking (will score as 0)
        logQ(`${task} → LLM failed to generate valid Cypher; scoring as 0`);
        return [];
      }
      logQ(`${task} → executing Cypher (len=${gen.cypher.length}, hasReturn=${/\bRETURN\b/i.test(gen.cypher)}): ${gen.cypher.replace(/\s+/g, ' ').slice(0, 200)}${gen.cypher.length > 200 ? '...' : ''}`);

      const result = (await callMCPTool<{ success?: boolean; data?: Array<Record<string, unknown>> }>(
        client,
        'query',
        { cypher: gen.cypher },  // limit removed — query tool doesn't accept it; rely on .slice() below
      )) ?? {};

      const rowCount = result.data?.length ?? 0;
      const out = (result.data ?? []).slice(0, limit).map((row, i) => {
        // Cypher results come in three shapes depending on what the LLM generated:
        //   1. FalkorDB native node: RETURN caller → row = { caller: { id, labels, properties: { name, filePath, ... } } }
        //   2. Already-normalized node: row = { caller: { name, filePath, ... } } (some drivers flatten)
        //   3. Scalar columns: RETURN c.name, c.filePath → row = { 'c.name': '...', 'c.filePath': '...' }
        // Try node-shape first (insertion-order stable; first node column wins).
        let filePath: string | undefined;
        let name: string | undefined;
        for (const v of Object.values(row)) {
          if (!v || typeof v !== 'object') continue;
          // Shape 1: FalkorDB native — name/filePath under .properties
          const props = (v as { properties?: { name?: string; filePath?: string } }).properties;
          if (props && (typeof props.name === 'string' || typeof props.filePath === 'string')) {
            name = typeof props.name === 'string' ? props.name : undefined;
            filePath = typeof props.filePath === 'string' ? props.filePath : undefined;
            break;
          }
          // Shape 2: flattened node
          if ('name' in v && 'filePath' in v) {
            const node = v as { filePath?: string; name?: string };
            filePath = node.filePath;
            name = node.name;
            break;
          }
        }
        if (!name && !filePath) {
          // Shape 3: scalar columns — pick keys ending in `.name` and `.filePath`/`.path`
          for (const [k, v] of Object.entries(row)) {
            if (typeof v !== 'string') continue;
            if (!name && /(^|\.)name$/i.test(k)) name = v;
            else if (!filePath && /(^|\.)(filePath|path)$/i.test(k)) filePath = v;
          }
          if (!name && typeof (row as Record<string, unknown>)['name'] === 'string') {
            name = (row as Record<string, string>)['name'];
          }
          if (!filePath && typeof (row as Record<string, unknown>)['filePath'] === 'string') {
            filePath = (row as Record<string, string>)['filePath'];
          }
        }
        return {
          id: this.codeId(filePath, name),
          score: 1 / (i + 1),
          kind: 'code' as const,
        };
      });
      const unknownCount = out.filter((r) => r.id === 'unknown#unknown').length;
      logQ(`${task} → query returned ${rowCount} rows, ${unknownCount}/${out.length} mapped to unknown#unknown, top=${out[0]?.id ?? '<none>'}`);
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
