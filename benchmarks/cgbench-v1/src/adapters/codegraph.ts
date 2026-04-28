import { mkdirSync, existsSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { measureDiskBytes } from '../metrics/resources.js';
import type { BenchmarkAdapter, IngestStats, QueryOpts } from '../adapter.js';
import type { BenchmarkCorpus, RankedResult } from '../types.js';
import { indexProject, enrichedSearchV2 } from '@codegraph/core';
import { createClient, createKnowledgeOperations } from '@codegraph/graph';
import type { GraphClient, QueryOptions, KnowledgeOperations } from '@codegraph/graph';

export type DocumentFormat = 'md' | 'pdf' | 'docx' | 'html' | 'csv';

export interface CodeGraphAdapterOptions {
  dataDir: string;
  /**
   * Document format to ingest from corpus.documentRoot.
   * Defaults to 'md'.
   *
   * Text formats (md, html, csv): file content is read and stored directly as entity text.
   * Binary formats (pdf, docx): NOT supported in v0.1.
   *   DEFERRED: pdf/docx support requires documentIngestion.add() loader path (pandoc/PDF
   *   loaders). Plan 5/6 territory. Requesting these formats throws a clear error.
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
  private readonly documentFormat: DocumentFormat;
  private readonly embeddingProvider: 'local' | 'voyage' | 'openrouter' | 'none';
  private readonly rerankerProvider: 'jina' | 'voyage' | 'none';
  // false = disabled (indexProject convention); object = provider config (enrichedSearchV2 convention)
  private readonly embeddingConfig: { provider: 'local' | 'voyage' | 'openrouter' } | false;
  private client: GraphClient | null = null;
  private knowledgeOps: KnowledgeOperations | null = null;

  constructor(opts: CodeGraphAdapterOptions) {
    this.dataDir = opts.dataDir;
    this.documentFormat = opts.documentFormat ?? 'md';

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

    // Propagate the resolved provider into the process environment.
    // ensureSchemaImpl (called by ensureIndexes on every client open) reads
    // CODEGRAPH_EMBEDDING_PROVIDER to decide which vector index dimension to
    // create. Without this, reopening the client (after ingest close) would
    // skip vector index creation, making searchByVector return 0 results.
    process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = resolvedProvider;

    mkdirSync(this.dataDir, { recursive: true });
  }

  private async getClient(): Promise<GraphClient> {
    if (!this.client) {
      this.client = await createClient({
        driver: 'falkordblite',
        databasePath: join(this.dataDir, 'falkordb'),
      });
      // Wire knowledge ops to this adapter's own client (not the global singleton).
      await this.client.ensureIndexes();
      this.knowledgeOps = createKnowledgeOperations(this.client);
    }
    return this.client;
  }

  private async getKnowledgeOps(): Promise<KnowledgeOperations> {
    await this.getClient(); // ensures this.knowledgeOps is initialized
    if (!this.knowledgeOps) {
      throw new Error('CodeGraphAdapter: knowledgeOps not initialized after getClient()');
    }
    return this.knowledgeOps;
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

    // Ingest knowledge corpus if provided.
    // Each .md file is stored as a Document Entity directly — no LLM required.
    // The full file content is the entity text; the file path is stored in properties
    // so the result ID can be reconstructed as <basename>#<basename>.
    if (corpus.knowledgeRoot) {
      const ops = await this.getKnowledgeOps();
      const knowledgeDocs = readdirSync(corpus.knowledgeRoot)
        .filter((f) => f.endsWith('.md'))
        .sort();

      for (const fileName of knowledgeDocs) {
        const filePath = join(corpus.knowledgeRoot, fileName);
        const content = readFileSync(filePath, 'utf-8');
        const base = basename(fileName, '.md');

        await ops.createEntity({
          text: content,
          type: 'Document',
          confidence: 1.0,
          sampleId: `cgbench-knowledge/${base}`,
          properties: { path: filePath },
        });

        totalDocs += 1;
      }
    }

    // Ingest document corpus if provided.
    // Text formats (md, html, csv) are read and stored as Entity nodes with
    // metadata.format tagged for per-format scoring in Plan 4 Task F.
    // Binary formats (pdf, docx) are deferred — see CodeGraphAdapterOptions docstring.
    if (corpus.documentRoot) {
      const fmt = this.documentFormat;

      if (fmt === 'pdf' || fmt === 'docx') {
        throw new Error(
          `DEFERRED: documentFormat '${fmt}' requires documentIngestion.add() loader path ` +
            `(pandoc/PDF loaders). Not supported in v0.1. Use md, html, or csv instead.`,
        );
      }

      const ops = await this.getKnowledgeOps();
      const formatDir = join(corpus.documentRoot, fmt);
      // Fall back to documentRoot directly if no sub-directory exists for the format.
      // This supports passing documents/source/ (md files at root) without a sub-folder.
      const scanDir = existsSync(formatDir) ? formatDir : corpus.documentRoot;

      const docFiles = readdirSync(scanDir)
        .filter((f) => f.endsWith(`.${fmt}`))
        .sort();

      for (const fileName of docFiles) {
        const filePath = join(scanDir, fileName);
        const content = readFileSync(filePath, 'utf-8');
        const base = basename(fileName, `.${fmt}`);

        await ops.createEntity({
          text: content,
          type: 'Document',
          confidence: 1.0,
          sampleId: `cgbench-document/${fmt}/${base}`,
          properties: { path: filePath, format: fmt },
        });

        totalDocs += 1;
      }
    }

    // Close to flush dump.rdb before disk measurement; query() reopens lazily.
    await client.close();
    this.client = null;
    this.knowledgeOps = null;

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
   * We extract the file stem (e.g. "knowledge-001" or "fact-001") and return
   * `<stem>#<stem>` to match the gold ID format used in task-d/task-e/task-f questions.
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
          const stem = dotIdx > 0 ? base.slice(0, dotIdx) : base;
          return `${stem}#${stem}`;
        }
      } catch {
        // fall through
      }
    }
    // Fallback: use first 60 chars of text as a degenerate ID.
    const slug = hit.text.slice(0, 60).replace(/\s+/g, '-').replace(/[^a-z0-9-]/gi, '');
    return `knowledge#${slug}`;
  }

  async destroy(): Promise<void> {
    if (this.client) {
      await this.client.close().catch(() => {
        // FalkorDBLite emits SocketClosedUnexpectedlyError on clean shutdown — that's noise.
      });
      this.client = null;
      this.knowledgeOps = null;
    }
    try {
      rmSync(this.dataDir, { recursive: true, force: true });
    } catch {
      // best-effort — caller may have already cleaned up
    }
  }
}
