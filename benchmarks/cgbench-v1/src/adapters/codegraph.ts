import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { measureDiskBytes } from '../metrics/resources.js';
import type { BenchmarkAdapter, IngestStats, QueryOpts } from '../adapter.js';
import type { BenchmarkCorpus, RankedResult } from '../types.js';
import { indexProject, enrichedSearchV2, add, warmupSearch, clearEmbeddedLabelCache } from '@codegraph/core';
import { createClient } from '@codegraph/graph';
import type { GraphClient, QueryOptions } from '@codegraph/graph';

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
 *   Each .md file in corpus.knowledgeRoot is stored as a Document Entity using
 *   KnowledgeOperations.createEntity() directly — no LLM required. The full
 *   file content (frontmatter + body) is stored as entity text. The file path
 *   is stored in the entity's properties for provenance.
 *
 *   LLM extraction is NOT attempted (benchmarks run without API keys). The
 *   lexical query path is extended to match Entity nodes by text content so
 *   knowledge results surface alongside code results.
 */
export class CodeGraphAdapter implements BenchmarkAdapter {
  readonly name = 'codegraph';
  readonly mode = 'native' as const;
  private readonly dataDir: string;
  private readonly embeddingProvider: 'local' | 'voyage' | 'openrouter' | 'none';
  private readonly rerankerProvider: 'jina' | 'voyage' | 'none';
  // false = disabled (indexProject convention); object = provider config (enrichedSearchV2 convention)
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

    // Build the EmbeddingConfig for indexProject and enrichedSearchV2
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

  async query(question: string, opts?: QueryOpts): Promise<RankedResult[]> {
    const limit = opts?.topK ?? 20;

    if (this.embeddingProvider !== 'none') {
      return this.queryVector(question, limit);
    }

    return this.queryLexical(question, limit);
  }

  /**
   * Production query path: vector retrieval via enrichedSearchV2.
   *
   * Uses the adapter's own FalkorDBLite client (not the global singleton) so
   * each benchmark run is fully isolated. The reranker is controlled by
   * CODEGRAPH_RERANK_PROVIDER / JINA_API_KEY / VOYAGE_API_KEY; if no key is
   * present the reranker gracefully falls back to vector similarity scores.
   *
   * When rerankerProvider is explicitly 'none', CODEGRAPH_RERANK=false is set
   * in the environment so enrichedSearchV2 skips the reranker entirely.
   */
  private async queryVector(question: string, limit: number): Promise<RankedResult[]> {
    const client = await this.getClient();

    // Suppress reranker when caller explicitly opts out
    const skipReranker = this.rerankerProvider === 'none';

    const embeddings = this.embeddingConfig === false ? undefined : this.embeddingConfig;
    const result = await enrichedSearchV2(question, client, {
      limit,
      skipReranker,
      ...(embeddings !== undefined ? { embeddings } : {}),
    });

    if (result.hits.length === 0 && result.meta.notice) {
      // Embeddings not ready or not configured — fall through to full lexical path
      return this.queryLexical(question, limit);
    }

    const codeResults: RankedResult[] = result.hits.map((hit) => ({
      id: this.vectorResultId(hit),
      score: 0, // position-based ranking — enrichedSearchV2 orders hits by relevance
      kind: 'code' as const,
      raw: hit,
    }));

    // enrichedSearchV2 searches code nodes only (Function, Class, etc.).
    // Entity/Document nodes are stored as knowledge and must be queried separately.
    // Run a lexical-only entity query and merge results — score 0 so they sort
    // after the ranked code results when both have equal scores.
    const entityResults = await this.queryLexicalEntitiesOnly(question, limit);

    return [...codeResults, ...entityResults].slice(0, limit);
  }

  /**
   * Lexical entity-only query: matches Entity Document nodes by text content.
   * Used to augment the vector code search with knowledge/document results.
   */
  private async queryLexicalEntitiesOnly(question: string, limit: number): Promise<RankedResult[]> {
    const client = await this.getClient();

    const rawTerms = question
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3);

    const expanded: string[] = [];
    for (const t of rawTerms) {
      expanded.push(t);
      if (t.length > 4) expanded.push(t.slice(0, 4));
    }
    const uniqueTerms = [...new Set(expanded)];
    if (uniqueTerms.length === 0) return [];

    const entityMatchClause = (i: number): string => `toLower(e.text) CONTAINS $t${i}`;
    const entityScoreExpr = uniqueTerms
      .map((_, i) => `CASE WHEN ${entityMatchClause(i)} THEN 1 ELSE 0 END`)
      .join(' + ');

    const params: QueryOptions['params'] = { limit };
    for (let i = 0; i < uniqueTerms.length; i++) {
      params[`t${i}`] = uniqueTerms[i]!;
    }

    const entityCypher = `
      MATCH (e:Entity)
      WHERE e.type = 'Document'
        AND (${uniqueTerms.map((_, i) => entityMatchClause(i)).join(' OR ')})
      WITH e, (${entityScoreExpr}) AS matchScore
      WHERE matchScore > 0
      RETURN e.text AS text, e.properties AS properties, matchScore
      ORDER BY matchScore DESC
      LIMIT $limit
    `;

    const entityResult = await client.roQuery<{
      text: string;
      properties: string | null;
      matchScore: number;
    }>(entityCypher, { params }).catch(() => ({
      data: [] as Array<{ text: string; properties: string | null; matchScore: number }>,
    }));

    return entityResult.data.map((row) => ({
      id: this.knowledgeResultId(row),
      score: row.matchScore,
      kind: 'knowledge' as const,
      raw: row,
    }));
  }

  /**
   * Lexical fallback: name+filePath substring matching via direct Cypher.
   *
   * Used when embeddingProvider is 'none', or as an automatic fallback when
   * enrichedSearchV2 returns no hits (e.g., no embeddings in the graph yet).
   *
   * Strategy:
   *   1. Extract non-trivial words (≥3 chars) from the question.
   *   2. For each word, also include a 4-char stem (e.g. "retries" → "retr")
   *      so morphological variants match (e.g. "retry", "retryWithBackoff").
   *   3. Match code nodes whose name or filePath contains any term/stem.
   *   4. Match knowledge Entity nodes whose text contains any term/stem.
   *   5. Score by number of term/stem hits; merge and rank.
   */
  private async queryLexical(question: string, limit: number): Promise<RankedResult[]> {
    const client = await this.getClient();

    const rawTerms = question
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3);

    // Expand with 4-char stems for each term longer than 4 chars.
    const expanded: string[] = [];
    for (const t of rawTerms) {
      expanded.push(t);
      if (t.length > 4) {
        expanded.push(t.slice(0, 4));
      }
    }
    const uniqueTerms = [...new Set(expanded)];

    if (uniqueTerms.length === 0) {
      return [];
    }

    // Build a CASE-based score expression: +1 for each term/stem that appears in
    // the node name or filePath. Nodes with no match are excluded.
    const codeMatchClause = (i: number): string =>
      `(toLower(n.name) CONTAINS $t${i} OR toLower(n.filePath) CONTAINS $t${i})`;

    const codeScoreExpr = uniqueTerms
      .map((_, i) => `CASE WHEN ${codeMatchClause(i)} THEN 1 ELSE 0 END`)
      .join(' + ');

    // For Entity nodes: score by how many terms appear in the text field.
    const entityMatchClause = (i: number): string =>
      `toLower(e.text) CONTAINS $t${i}`;

    const entityScoreExpr = uniqueTerms
      .map((_, i) => `CASE WHEN ${entityMatchClause(i)} THEN 1 ELSE 0 END`)
      .join(' + ');

    const params: QueryOptions['params'] = { limit };
    for (let i = 0; i < uniqueTerms.length; i++) {
      params[`t${i}`] = uniqueTerms[i]!;
    }

    // Query 1: code nodes (Function, Class, etc.)
    const codeCypher = `
      MATCH (n)
      WHERE n.name IS NOT NULL
        AND (${uniqueTerms.map((_, i) => codeMatchClause(i)).join(' OR ')})
      WITH n, (${codeScoreExpr}) AS matchScore
      WHERE matchScore > 0
      RETURN n.name AS name, n.filePath AS filePath, labels(n)[0] AS nodeType, matchScore
      ORDER BY matchScore DESC
      LIMIT $limit
    `;

    // Query 2: knowledge Entity nodes
    const entityCypher = `
      MATCH (e:Entity)
      WHERE e.type = 'Document'
        AND (${uniqueTerms.map((_, i) => entityMatchClause(i)).join(' OR ')})
      WITH e, (${entityScoreExpr}) AS matchScore
      WHERE matchScore > 0
      RETURN e.text AS text, e.properties AS properties, matchScore
      ORDER BY matchScore DESC
      LIMIT $limit
    `;

    const [codeResult, entityResult] = await Promise.all([
      client.roQuery<{
        name: string;
        filePath: string | null;
        nodeType: string;
        matchScore: number;
      }>(codeCypher, { params }),
      client.roQuery<{
        text: string;
        properties: string | null;
        matchScore: number;
      }>(entityCypher, { params }).catch(() => ({ data: [] as Array<{ text: string; properties: string | null; matchScore: number }> })),
    ]);

    const codeResults: RankedResult[] = codeResult.data.map((row) => ({
      id: this.resultId(row),
      score: row.matchScore,
      kind: 'code' as const,
      raw: row,
    }));

    const knowledgeResults: RankedResult[] = entityResult.data.map((row) => ({
      id: this.knowledgeResultId(row),
      score: row.matchScore,
      kind: 'knowledge' as const,
      raw: row,
    }));

    // Merge and re-sort by score descending, then truncate to limit.
    return [...codeResults, ...knowledgeResults]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Build a result ID for a vector hit from enrichedSearchV2.
   * Format: <basename>#<symbolName> (same convention as the lexical path).
   */
  private vectorResultId(hit: { filePath?: string; name: string }): string {
    const file = hit.filePath ?? 'unknown';
    const base = file.includes('/') ? file.slice(file.lastIndexOf('/') + 1) : file;
    return `${base}#${hit.name}`;
  }

  private resultId(hit: { filePath?: string | null; name?: string | null }): string {
    const file = hit.filePath ?? 'unknown';
    const base = file.includes('/') ? file.slice(file.lastIndexOf('/') + 1) : file;
    const name = hit.name ?? 'unknown';
    return `${base}#${name}`;
  }

  /**
   * Build a result ID for a knowledge Entity row.
   *
   * The Entity's `properties` JSON field may contain:
   *   - `{ path: "/abs/path/to/knowledge-001.md" }` (knowledge corpus)
   *   - `{ path: "/abs/path/to/fact-001.md", format: "md" }` (document corpus)
   *
   * We extract the bare file stem (e.g. "knowledge-001" or "fact-001") to match
   * the gold ID format used in task-d/task-e/task-f questions, which use bare
   * stems with no file extension and no `#` separator.
   *
   * If properties can't be parsed or path is missing, fall back to using the
   * first 60 chars of the text.
   */
  private knowledgeResultId(hit: { text: string; properties: string | null }): string {
    if (hit.properties) {
      try {
        const props = JSON.parse(hit.properties) as Record<string, unknown>;
        const filePath = props['path'];
        if (typeof filePath === 'string') {
          const base = filePath.includes('/')
            ? filePath.slice(filePath.lastIndexOf('/') + 1)
            : filePath;
          // Strip any file extension (.md, .html, .csv, etc.)
          const dotIdx = base.lastIndexOf('.');
          return dotIdx > 0 ? base.slice(0, dotIdx) : base;
        }
      } catch {
        // fall through
      }
    }
    // Fallback: use first 60 chars of text as a degenerate ID.
    const slug = hit.text.slice(0, 60).replace(/\s+/g, '-').replace(/[^a-z0-9-]/gi, '');
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
