/**
 * FalkorDBLite Driver — embedded graph database (no Docker needed)
 *
 * Thin wrapper that manages a local FalkorDB instance via the `falkordblite`
 * npm package. On connect it spawns an embedded Redis+FalkorDB subprocess;
 * on close it shuts it down cleanly.
 *
 * The Graph object returned by selectGraph() is the real `falkordb` Graph,
 * so all operations (query, roQuery, indexes, vectors) work identically
 * to the remote FalkorDBDriver.
 */

import type { Graph } from 'falkordb';
import type { QueryOptions as FalkorQueryOptions } from 'falkordb/dist/src/commands';
import type { DatabaseDriver, DriverConfig, CypherDialect } from '../driver';
import type { QueryParams } from '../client';
import { falkorDialect } from './falkordb';

// ============================================================================
// FalkorDBLite Driver
// ============================================================================

/**
 * FalkorDBLite-specific configuration options
 */
export interface FalkorDBLiteConfig {
  /** Data directory for persistence (default: .codegraph/falkordb) */
  path?: string;
  /** Redis memory limit (e.g. "256mb") */
  maxMemory?: string;
  /** Startup timeout in ms (default: 10000) */
  timeout?: number;
}

export class FalkorDBLiteDriver implements DatabaseDriver {
  // Use `any` for the FalkorDBLite db instance to avoid requiring the
  // falkordblite types at compile time (it's a lazy/optional dependency)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any = null;
  private graph: Graph | null = null;
  readonly dialect: CypherDialect = falkorDialect;

  async connect(config: DriverConfig): Promise<void> {
    // Lazy-import falkordblite so we don't require it at module load time
    const { FalkorDB: FalkorDBLite } = await import('falkordblite');

    // Determine the data path for persistence
    const dataPath = config.databasePath
      ?? process.env['CODEGRAPH_DB_PATH']
      ?? '.codegraph/falkordb';

    // Open embedded FalkorDB instance
    this.db = await FalkorDBLite.open({ path: dataPath });

    // Select the graph (same API as remote FalkorDB)
    const graphName = config.graphName ?? process.env['FALKORDB_GRAPH'] ?? 'codegraph';
    this.graph = this.db.selectGraph(graphName);
  }

  async query<T>(cypher: string, params?: QueryParams, timeout?: number): Promise<{ data: T[]; metadata: string[] }> {
    if (!this.graph) throw new Error('FalkorDBLiteDriver: not connected');
    const queryOptions: Record<string, unknown> = {};
    if (params) queryOptions.params = params;
    if (timeout) queryOptions.TIMEOUT = timeout;
    const opts = Object.keys(queryOptions).length > 0 ? queryOptions : undefined;
    const result = await this.graph.query<T>(cypher, opts as unknown as FalkorQueryOptions);
    return {
      data: result.data ?? [],
      metadata: result.metadata ?? [],
    };
  }

  async roQuery<T>(cypher: string, params?: QueryParams, timeout?: number): Promise<{ data: T[]; metadata: string[] }> {
    if (!this.graph) throw new Error('FalkorDBLiteDriver: not connected');
    const queryOptions: Record<string, unknown> = {};
    if (params) queryOptions.params = params;
    if (timeout) queryOptions.TIMEOUT = timeout;
    const opts = Object.keys(queryOptions).length > 0 ? queryOptions : undefined;
    const result = await this.graph.roQuery<T>(cypher, opts as unknown as FalkorQueryOptions);
    return {
      data: result.data ?? [],
      metadata: result.metadata ?? [],
    };
  }

  async ensureSchema(): Promise<void> {
    if (!this.graph) throw new Error('FalkorDBLiteDriver: not connected');

    // Identical schema setup to FalkorDBDriver — same engine, same indexes
    const safeIndex = async (cypher: string): Promise<void> => {
      try {
        await this.graph!.query(cypher);
      } catch (error) {
        const msg = error instanceof Error ? error.message : '';
        if (msg.includes('Index already exists') || msg.includes('Attribute already indexed')) return;
        // Log but don't throw for other index errors (label may not exist yet)
      }
    };

    // --- Range indexes (lookup by exact value) ---
    try {
      await this.graph.createNodeRangeIndex('File', 'path');
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
        await this.graph.createNodeFulltextIndex(label, 'name');
      } catch (error) {
        const msg = error instanceof Error ? error.message : '';
        if (!msg.includes('Index already exists') && !msg.includes('Attribute already indexed')) {
          if (label === 'Entity') {
            try {
              await this.graph!.createNodeFulltextIndex(label, 'text');
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

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
      this.graph = null;
    }
  }

  /** Expose the underlying FalkorDB Graph for backward compatibility */
  getGraph(): Graph | null {
    return this.graph;
  }
}
