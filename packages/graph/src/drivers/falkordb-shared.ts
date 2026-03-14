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
export async function ensureSchemaImpl(graph: Graph): Promise<void> {
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

  // --- Range indexes (lookup by exact value) ---
  try {
    await graph.createNodeRangeIndex('File', 'path');
  } catch (error) {
    const msg = error instanceof Error ? error.message : '';
    if (!msg.includes('Index already exists') && !msg.includes('Attribute already indexed')) throw error;
  }

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
  const fulltextTargets = ['Function', 'Class', 'Component', 'Interface', 'Type', 'Entity'];
  for (const label of fulltextTargets) {
    try {
      await graph.createNodeFulltextIndex(label, 'name');
    } catch (error) {
      const msg = error instanceof Error ? error.message : '';
      if (!msg.includes('Index already exists') && !msg.includes('Attribute already indexed')) {
        // Entity might not have 'name' — it uses 'text'. Try 'text' for Entity.
        if (label === 'Entity') {
          try {
            await graph.createNodeFulltextIndex(label, 'text');
          } catch { /* ignore */ }
        }
      }
    }
  }

  // --- Vector indexes (HNSW for embedding similarity search) ---
  // Dimension defaults to 768 (nomic-embed-text-v1.5 local model).
  // Set CODEGRAPH_EMBEDDING_DIM for other models (e.g. 1536 for cloud).
  const embDim = parseInt(process.env['CODEGRAPH_EMBEDDING_DIM'] ?? '768', 10);
  const vectorTargets = [
    'File', 'Function', 'Class', 'Interface', 'Variable', 'Type', 'Component', 'Entity',
  ];
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
