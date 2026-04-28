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

import { resolve } from 'node:path';
import type { Graph } from 'falkordb';
import type { DatabaseDriver, DriverConfig, CypherDialect } from '../driver';
import type { QueryParams } from '../client';
import { falkorDialect } from './falkordb';
import { executeQuery, executeRoQuery, ensureSchemaImpl } from './falkordb-shared';

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

    // Determine the data path for persistence (resolve relative paths against cwd)
    const rawPath = config.databasePath
      ?? process.env['CODEGRAPH_DB_PATH']
      ?? '.codegraph/falkordb';
    const dataPath = resolve(rawPath);

    // Open embedded FalkorDB instance
    this.db = await FalkorDBLite.open({ path: dataPath });

    // Select the graph (same API as remote FalkorDB)
    const graphName = config.graphName ?? process.env['FALKORDB_GRAPH'] ?? 'codegraph';
    this.graph = this.db.selectGraph(graphName);
  }

  async query<T>(cypher: string, params?: QueryParams, timeout?: number): Promise<{ data: T[]; metadata: string[] }> {
    if (!this.graph) throw new Error('FalkorDBLiteDriver: not connected');
    return executeQuery<T>(this.graph, cypher, params, timeout);
  }

  async roQuery<T>(cypher: string, params?: QueryParams, timeout?: number): Promise<{ data: T[]; metadata: string[] }> {
    if (!this.graph) throw new Error('FalkorDBLiteDriver: not connected');
    return executeRoQuery<T>(this.graph, cypher, params, timeout);
  }

  async ensureSchema(opts?: { embeddingDim?: number }): Promise<void> {
    if (!this.graph) throw new Error('FalkorDBLiteDriver: not connected');
    return ensureSchemaImpl(this.graph, opts);
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
