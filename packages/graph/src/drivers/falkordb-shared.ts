/**
 * Shared FalkorDB driver utilities — used by both FalkorDBDriver (Docker)
 * and FalkorDBLiteDriver (embedded). Both drivers use the same `Graph` type
 * from the `falkordb` npm package, so query execution and schema setup are
 * identical.
 */

import type { Graph } from 'falkordb';
import type { QueryOptions as FalkorQueryOptions } from 'falkordb/dist/src/commands';
import type { QueryParams } from '../client';

// ============================================================================
// Shared query execution
// ============================================================================

/**
 * Execute a read-write query on a FalkorDB Graph instance.
 */
export async function executeQuery<T>(
  graph: Graph,
  cypher: string,
  params?: QueryParams,
  timeout?: number,
): Promise<{ data: T[]; metadata: string[] }> {
  const queryOptions: Record<string, unknown> = {};
  if (params) queryOptions.params = params;
  if (timeout) queryOptions.TIMEOUT = timeout;
  const opts = Object.keys(queryOptions).length > 0 ? queryOptions : undefined;
  const result = await graph.query<T>(cypher, opts as unknown as FalkorQueryOptions);
  return {
    data: result.data ?? [],
    metadata: result.metadata ?? [],
  };
}

/**
 * Execute a read-only query on a FalkorDB Graph instance.
 */
export async function executeRoQuery<T>(
  graph: Graph,
  cypher: string,
  params?: QueryParams,
  timeout?: number,
): Promise<{ data: T[]; metadata: string[] }> {
  const queryOptions: Record<string, unknown> = {};
  if (params) queryOptions.params = params;
  if (timeout) queryOptions.TIMEOUT = timeout;
  const opts = Object.keys(queryOptions).length > 0 ? queryOptions : undefined;
  const result = await graph.roQuery<T>(cypher, opts as unknown as FalkorQueryOptions);
  return {
    data: result.data ?? [],
    metadata: result.metadata ?? [],
  };
}

// ============================================================================
// Shared schema setup
// ============================================================================

/**
 * Create all required indexes on a FalkorDB graph instance.
 * Works identically for both remote FalkorDB and embedded FalkorDBLite
 * since they share the same engine and Graph API.
 */
export async function ensureSchemaImpl(
  graph: Graph,
  opts?: { embeddingDim?: number },
): Promise<void> {
  // Helper: run a query ignoring "Index already exists" errors
  const safeIndex = async (cypher: string): Promise<void> => {
    try {
      await graph.query(cypher);
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      // Swallow duplicate index errors — they're expected on restart
      if (msg.includes('Index already exists') || msg.includes('Attribute already indexed')) return;
      // Log but don't throw for other index errors (label may not exist yet)
      // Vector indexes will be created lazily when data arrives
    }
  };

  // --- Pre-create all node labels (FalkorDB #1240 workaround) ---
  // FalkorDB has a race condition where concurrent writes that introduce new
  // labels can crash the engine (signal 11). Creating dummy nodes ensures all
  // labels exist before concurrent indexing starts. The dummy nodes are
  // immediately deleted.
  const allLabels = [
    'File', 'Function', 'Class', 'Interface', 'Variable', 'Type',
    'Component', 'Entity', 'Project', 'Commit', 'Metadata',
    'MarkdownDocument', 'Section', 'CodeBlock', 'Link',
  ];
  const createDummies = allLabels.map(l => `CREATE (:${l} {__dummy: true})`).join(' ');
  try {
    await graph.query(createDummies);
    // Delete the dummy nodes
    await graph.query(`MATCH (n {__dummy: true}) DELETE n`);
  } catch {
    // Non-fatal — labels may already exist
  }

  // --- Range indexes (lookup by exact value) ---
  await safeIndex(`CREATE INDEX FOR (f:File) ON (f.filePath)`);

  // --- Commit & Metadata range indexes (git history / state tracking) ---
  await safeIndex(`CREATE INDEX FOR (c:Commit) ON (c.hash)`);
  await safeIndex(`CREATE INDEX FOR (m:Metadata) ON (m.key)`);

  // --- Provenance range indexes (query by pipeline/task) ---
  const provenanceLabels = [
    'File', 'Function', 'Class', 'Interface', 'Variable', 'Type', 'Component', 'Entity',
  ];
  for (const label of provenanceLabels) {
    await safeIndex(`CREATE INDEX FOR (n:${label}) ON (n.sourcePipeline)`);
    await safeIndex(`CREATE INDEX FOR (n:${label}) ON (n.processedAt)`);
  }

  // --- Document entity range indexes (markdown support) ---
  await safeIndex(`CREATE INDEX FOR (d:MarkdownDocument) ON (d.path)`);
  await safeIndex(`CREATE INDEX FOR (s:Section) ON (s.filePath)`);
  await safeIndex(`CREATE INDEX FOR (cb:CodeBlock) ON (cb.filePath)`);
  await safeIndex(`CREATE INDEX FOR (l:Link) ON (l.filePath)`);

  // --- Fulltext indexes (text search) ---
  // Use CALL procedure syntax (FalkorDB's native fulltext API)
  const fulltextTargets = ['Function', 'Class', 'Component', 'Interface', 'Type'];
  for (const label of fulltextTargets) {
    await safeIndex(`CALL db.idx.fulltext.createNodeIndex('${label}', 'name')`);
  }
  // Entity uses both 'name' and 'text'
  await safeIndex(`CALL db.idx.fulltext.createNodeIndex('Entity', 'name', 'text')`);

  // --- Vector indexes (HNSW for embedding similarity search) ---
  // Dimension is auto-detected from API keys (VOYAGE_API_KEY, OPENROUTER_API_KEY)
  // or explicit CODEGRAPH_EMBEDDING_PROVIDER override.
  // If no provider is configured, vector indexes are skipped entirely.
  // If existing indexes have a different dimension (e.g. user switched from
  // local/768 to voyage/1024), drop and recreate them + clear stale embeddings.
  const embDim = resolveEmbeddingDimension(opts?.embeddingDim);
  const vectorTargets = [
    'File', 'Function', 'Class', 'Interface', 'Variable', 'Type', 'Component', 'Entity',
  ];

  if (embDim === 0) {
    // No embedding provider configured — skip vector indexes entirely.
    // Indexing will work (structural graph) but search won't use embeddings.
    return;
  }

  // Check for dimension mismatch on an existing index
  const mismatch = await detectDimensionMismatch(graph, vectorTargets[0]!, embDim);
  if (mismatch) {
    process.stderr.write(
      `\n[CodeGraph] Embedding dimension changed: ${mismatch.existing} → ${embDim}\n` +
      `  Rebuilding vector indexes and clearing stale embeddings.\n` +
      `  You MUST reindex your project(s) for search to work.\n\n`
    );

    // Drop all existing vector indexes
    for (const label of vectorTargets) {
      await safeQuery(graph, `DROP VECTOR INDEX FOR (n:${label}) ON (n.embedding)`);
    }
    await safeQuery(graph, `DROP VECTOR INDEX FOR ()-[r:RELATES_TO]-() ON (r.fact_embedding)`);

    // Clear stale embedding vectors (they're the wrong dimension)
    for (const label of vectorTargets) {
      await safeQuery(graph, `MATCH (n:${label}) WHERE n.embedding IS NOT NULL SET n.embedding = NULL`);
    }
    await safeQuery(graph, `MATCH ()-[r:RELATES_TO]-() WHERE r.fact_embedding IS NOT NULL SET r.fact_embedding = NULL`);
  }

  for (const label of vectorTargets) {
    await safeIndex(
      `CREATE VECTOR INDEX FOR (n:${label}) ON (n.embedding) OPTIONS {dimension: ${embDim}, similarityFunction: 'cosine'}`
    );
  }

  // Vector index on RELATES_TO edge (fact_embedding for knowledge graph)
  await safeIndex(
    `CREATE VECTOR INDEX FOR ()-[r:RELATES_TO]-() ON (r.fact_embedding) OPTIONS {dimension: ${embDim}, similarityFunction: 'cosine'}`
  );
}

// ============================================================================
// Embedding dimension resolution
// ============================================================================

/**
 * Resolve the embedding dimension from the configured provider.
 * Priority: caller override > CODEGRAPH_EMBEDDING_DIM env > provider-based detection.
 */
function resolveEmbeddingDimension(override?: number): number {
  // Caller-provided override always wins (highest priority)
  if (override !== undefined) return override;
  // Env var CODEGRAPH_EMBEDDING_DIM — explicit second priority
  const explicit = process.env['CODEGRAPH_EMBEDDING_DIM'];
  if (explicit) return parseInt(explicit, 10);

  // Explicit provider env
  const provider = process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
  switch (provider) {
    case 'voyage': return 1024;
    case 'openrouter': return 1536;
    case 'local': return 768;
    case 'none': return 0;
  }

  // Auto-detect from API keys
  if (process.env['VOYAGE_API_KEY']) return 1024;
  if (process.env['OPENROUTER_API_KEY']) return 1536;

  // No provider configured and no explicit dimension — fail loudly rather than
  // silently skipping vector index creation. A graph without vector indexes
  // accepts writes normally but produces cryptic "Invalid arguments" errors on
  // every vector search, with no indication that setup is incomplete.
  //
  // To intentionally skip vector indexes (structural-only graph), set:
  //   CODEGRAPH_EMBEDDING_PROVIDER=none
  // To use the built-in local model (nomic-embed-text-v1.5, 768-dim), set:
  //   CODEGRAPH_EMBEDDING_PROVIDER=local
  throw new Error(
    'Cannot determine embedding dimension. ' +
    'Set CODEGRAPH_EMBEDDING_PROVIDER (local | voyage | openrouter | none), ' +
    'CODEGRAPH_EMBEDDING_DIM, or pass the embeddingDim option to ensureIndexes(). ' +
    'To skip vector indexes entirely (structural graph only), set CODEGRAPH_EMBEDDING_PROVIDER=none.'
  );
}

/**
 * Check if existing vector indexes have a different dimension than what
 * the current provider requires. Returns the existing dimension if there's
 * a mismatch, null if dimensions match or no index exists yet.
 */
async function detectDimensionMismatch(
  graph: Graph,
  sampleLabel: string,
  expectedDim: number,
): Promise<{ existing: number } | null> {
  try {
    // Try to query the vector index with a probe vector of the expected dimension.
    // If the index exists with a different dimension, FalkorDB will error.
    const probeVec = new Array(expectedDim).fill(0);
    probeVec[0] = 1; // non-zero to avoid degenerate case
    await graph.roQuery(
      `CALL db.idx.vector.queryNodes('${sampleLabel}', 'embedding', 1, vecf32($vec)) YIELD node RETURN node LIMIT 0`,
      { params: { vec: probeVec } } as any,
    );
    // Success — dimensions match (or no index/data yet)
    return null;
  } catch (error) {
    const msg = error instanceof Error ? error.message : '';
    // FalkorDB errors on dimension mismatch: "Vector dimension mismatch" or similar
    if (msg.includes('dimension') || msg.includes('Dimension') || msg.includes('length')) {
      // Try to extract existing dimension from error or try common dimensions
      const existingDim = await probeExistingDimension(graph, sampleLabel);
      return existingDim ? { existing: existingDim } : { existing: -1 };
    }
    // Index doesn't exist yet — no mismatch
    return null;
  }
}

/**
 * Probe which dimension the existing vector index uses by trying common sizes.
 */
async function probeExistingDimension(graph: Graph, label: string): Promise<number | null> {
  for (const dim of [768, 1024, 1536, 2048]) {
    try {
      const probeVec = new Array(dim).fill(0);
      probeVec[0] = 1;
      await graph.roQuery(
        `CALL db.idx.vector.queryNodes('${label}', 'embedding', 1, vecf32($vec)) YIELD node RETURN node LIMIT 0`,
        { params: { vec: probeVec } } as any,
      );
      return dim; // This dimension worked
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Run a query, ignoring any errors (for DROP INDEX etc.)
 */
async function safeQuery(graph: Graph, cypher: string): Promise<void> {
  try {
    await graph.query(cypher);
  } catch {
    // Ignore — index may not exist
  }
}
