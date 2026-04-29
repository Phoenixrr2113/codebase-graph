import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { measureDiskBytes } from '../metrics/resources.js';
import type { BenchmarkAdapter, IngestStats, QueryOpts } from '../adapter.js';
import type { BenchmarkCorpus, RankedResult } from '../types.js';
import { indexProject, add, warmupSearch, clearEmbeddedLabelCache, unifiedSearch } from '@codegraph/core';
import type { UnifiedSearchResult } from '@codegraph/core';
import { createClient } from '@codegraph/graph';
import type { GraphClient } from '@codegraph/graph';

export type DocumentFormat = 'md' | 'pdf' | 'docx' | 'html' | 'csv';

export interface CodeGraphAdapterOptions {
  dataDir: string;
  /**
   * Document format to ingest from corpus.documentRoot.
   *
   * @deprecated documentFormat is no longer used; documentIngestion.add() handles
   * all formats (md, html, csv, pdf, docx, URLs) natively via auto-detection.
   * This option is accepted but ignored.
   */
  documentFormat?: DocumentFormat;
  /**
   * Embedding provider for vector search.
   *
   * 'local'      — nomic-ai/nomic-embed-text-v1.5 via @huggingface/transformers (~10ms/embedding,
   *                768-dim, no API key required, first run downloads ~140MB model)
   * 'voyage'     — voyage-code-3 (1024-dim, requires VOYAGE_API_KEY)
   * 'openrouter' — text-embedding-3-small (1536-dim, requires OPENROUTER_API_KEY)
   * 'none'       — disable vector search; fall back to lexical Cypher matching
   *
   * Defaults to the CODEGRAPH_EMBEDDING_PROVIDER env var, or 'local' if not set.
   * Use 'none' for offline/CI environments where no provider is available or desired.
   */
  embeddingProvider?: 'local' | 'voyage' | 'openrouter' | 'none';
  /**
   * Reranker provider for cross-encoder reranking of vector results.
   *
   * 'jina'  — jina-reranker-v2-base-multilingual (requires JINA_API_KEY)
   * 'voyage' — rerank-2 (requires VOYAGE_API_KEY)
   * 'none'  — disable reranking; use raw vector similarity scores
   *
   * Defaults to 'none' when no API key is set (graceful degradation).
   */
  rerankerProvider?: 'jina' | 'voyage' | 'none';
}

/**
 * CodeGraph native adapter for the benchmark harness.
 *
 * Lifecycle:
 *   - constructor: prepares dataDir, no client yet
 *   - ingest():    opens client, indexes corpus (code + knowledge), closes client to flush dump.rdb
 *   - query():     lazily reopens client
 *   - destroy():   closes client if open
 *
 * After ingest() returns, this.client is null. Any subsequent query() must call
 * getClient() to reopen — FalkorDBLite only flushes its RDB snapshot on close,
 * so the close-and-reopen pattern is what makes diskBytesAfter measurable.
 *
 * Git sync is disabled because fixture corpora live inside the cgbench worktree;
 * indexing would otherwise pull the parent repo's commit history into the graph.
 *
 * Knowledge ingest:
 *   Each file in corpus.documentRoot is ingested via documentIngestion.add(),
 *   which auto-detects format, chunks, extracts entities/relationships, and
 *   stores with source provenance (`cgbench:<stem>`).
 *
 * Query:
 *   unifiedSearch() runs code (enrichedSearchV2) and knowledge (vector entity
 *   search) in parallel and fuses via RRF. opts.scope maps to searchScope.
 */
export class CodeGraphAdapter implements BenchmarkAdapter {
  readonly name = 'codegraph';
  readonly mode = 'native' as const;
  private readonly dataDir: string;
  private readonly embeddingProvider: 'local' | 'voyage' | 'openrouter' | 'none';
  private readonly rerankerProvider: 'jina' | 'voyage' | 'none';
  // false = disabled; object = provider config passed to unifiedSearch / indexProject
  private readonly embeddingConfig: { provider: 'local' | 'voyage' | 'openrouter' } | false;
  private graphId!: string;
  private client: GraphClient | null = null;
  private warmedUp = false;

  constructor(opts: CodeGraphAdapterOptions) {
    this.dataDir = opts.dataDir;

    // Resolve embedding provider: explicit option > env var > 'local'
    const envProvider = process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
    const resolvedProvider = opts.embeddingProvider ??
      (envProvider === 'voyage' || envProvider === 'openrouter' || envProvider === 'local' || envProvider === 'none'
        ? (envProvider as 'local' | 'voyage' | 'openrouter' | 'none')
        : 'local');
    this.embeddingProvider = resolvedProvider;

    // Resolve reranker provider: explicit option > env var > 'none'
    const envReranker = process.env['CODEGRAPH_RERANK_PROVIDER'];
    this.rerankerProvider = opts.rerankerProvider ??
      (envReranker === 'jina' || envReranker === 'voyage' ? (envReranker as 'jina' | 'voyage') : 'none');

    // Build the EmbeddingConfig for indexProject and unifiedSearch
    this.embeddingConfig = resolvedProvider === 'none'
      ? false
      : { provider: resolvedProvider };

    // graphId: stable identifier for cache scoping (Tasks 5+6 use this)
    const useDocker = process.env['CGBENCH_FALKORDB_HOST'] !== undefined;
    if (useDocker) {
      const host = process.env['CGBENCH_FALKORDB_HOST']!;
      const port = process.env['CGBENCH_FALKORDB_PORT'] ?? '6379';
      const safeName = `cgbench-${this.dataDir.split('/').pop()!.replace(/[^a-z0-9-]/gi, '')}`;
      this.dockerGraphName = safeName;
      this.graphId = `${host}:${port}:${safeName}`;
    } else {
      this.graphId = join(this.dataDir, 'falkordb');
    }
    // NO process.env mutation — embedding dim now passed via ensureIndexes opts

    mkdirSync(this.dataDir, { recursive: true });
  }

  /** Stable graph name for FalkorDB Docker mode — set in constructor, reused on reopen. */
  private dockerGraphName?: string;

  private async getClient(): Promise<GraphClient> {
    if (!this.client) {
      // Allow swapping to FalkorDB Docker via env vars for diagnosing
      // FalkorDBLite-specific issues (e.g., concurrent vector-query hangs).
      if (this.dockerGraphName !== undefined) {
        this.client = await createClient({
          driver: 'falkordb',
          host: process.env['CGBENCH_FALKORDB_HOST']!,
          port: parseInt(process.env['CGBENCH_FALKORDB_PORT'] ?? '6379', 10),
          graphName: this.dockerGraphName,
        });
      } else {
        this.client = await createClient({
          driver: 'falkordblite',
          databasePath: join(this.dataDir, 'falkordb'),
        });
      }
      const embeddingDim = this.embeddingProvider === 'voyage' ? 1024
        : this.embeddingProvider === 'openrouter' ? 1536
        : 768; // 'local' or 'none' (default)
      await this.client.ensureIndexes({ embeddingDim });
      if (!this.warmedUp) {
        await warmupSearch();
        this.warmedUp = true;
      }
    }
    return this.client;
  }

  async ingest(corpus: BenchmarkCorpus): Promise<IngestStats> {
    const start = Date.now();
    let totalDocs = 0;

    const client = await this.getClient();

    // Ingest code roots.
    for (const root of corpus.codeRoots) {
      const result = await indexProject(root.path, {
        client,
        embeddings: this.embeddingConfig,
        force: true,
        gitSync: false,
      });
      if (!result.success) {
        throw new Error(
          `indexProject failed for ${root.path}: ${result.errorMessages.join('; ')}`,
        );
      }
      totalDocs += result.stats.files;
    }

    // Ingest document corpus if provided.
    // documentIngestion.add() auto-detects format, chunks, extracts entities/relationships,
    // and stores with provenance — supports md, html, csv, pdf, docx, URLs, and raw text.
    if (corpus.documentRoot) {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const docsDir = corpus.documentRoot;

      const entries = await fs.readdir(docsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (entry.name.startsWith('.')) continue;
        const filePath = path.join(docsDir, entry.name);
        await add(filePath, {
          client,
          source: `cgbench:${path.basename(entry.name, path.extname(entry.name))}`,
        });
        totalDocs += 1;
      }
    }

    // Close to flush dump.rdb before disk measurement; query() reopens lazily.
    // Clear the embedded-label cache for this graph so query() rediscovers labels after reopen.
    clearEmbeddedLabelCache(this.graphId);
    await client.close();
    this.client = null;

    const durationMs = Date.now() - start;
    const diskBytesAfter = existsSync(this.dataDir)
      ? await measureDiskBytes(this.dataDir)
      : 0;
    // Rough byte-based proxy until indexProject surfaces a real token count.
    const totalTokens = Math.floor(diskBytesAfter / 4);

    return { durationMs, totalDocs, totalTokens, diskBytesAfter };
  }

  async query(question: string, opts: QueryOpts = {}): Promise<RankedResult[]> {
    const client = await this.getClient();

    const limit = opts.topK ?? 10;
    const skipReranker = this.rerankerProvider === 'none';
    const embeddings = this.embeddingConfig === false ? undefined : this.embeddingConfig;

    const result = await unifiedSearch(question, client, {
      searchScope: opts.scope ?? 'all',
      limit,
      skipReranker,
      ...(embeddings !== undefined ? { embeddings } : {}),
    });

    return result.results.map((r) => ({
      id: this.unifiedResultToId(r),
      score: r.score,
      kind: r.source,
    }));
  }

  /**
   * Convert a UnifiedSearchResult to the gold-shaped ID expected by the benchmark.
   * - Code: `<basename>#<symbol>`
   * - Knowledge: slug derived from the entity name (text content).
   */
  private unifiedResultToId(r: UnifiedSearchResult): string {
    if (r.source === 'code') {
      const basename = (r.filePath ?? 'unknown').split('/').pop() ?? 'unknown';
      return `${basename}#${r.name}`;
    }
    // Knowledge — derive a slug from the entity name (entity text).
    // sampleIds / source labels are not returned by searchEntitiesByVector,
    // so we fall back to generating a slug from the entity text content.
    const slug = r.name.slice(0, 60).replace(/\s+/g, '-').replace(/[^a-z0-9-]/gi, '');
    return `knowledge-${slug}`;
  }

  async destroy(): Promise<void> {
    // For FalkorDB Docker mode, drop the graph before closing so the server
    // doesn't accumulate data across benchmark runs.
    if (this.client && this.dockerGraphName !== undefined) {
      try {
        await this.client.query(`MATCH (n) DETACH DELETE n`, { params: {} });
      } catch {
        // best-effort cleanup
      }
    }
    if (this.client) {
      await this.client.close().catch(() => {
        // FalkorDBLite emits SocketClosedUnexpectedlyError on clean shutdown — that's noise.
      });
      this.client = null;
    }
    try {
      rmSync(this.dataDir, { recursive: true, force: true });
    } catch {
      // best-effort — caller may have already cleaned up
    }
  }
}
