/**
 * @codegraph/graph - Database Driver Abstraction
 * Supports FalkorDB (remote) and FalkorDBLite (embedded)
 */

import type { QueryParams } from './client';

/**
 * Driver configuration — extensible for any graph database driver.
 * Known drivers: 'falkordb', 'falkordblite'
 * Future: 'neo4j', 'memgraph', 'lancedb'
 */
export interface DriverConfig {
  driver: 'falkordb' | 'falkordblite' | 'neo4j' | 'memgraph' | (string & {});
  // Connection (remote drivers)
  url?: string | undefined;
  host?: string | undefined;
  port?: number | undefined;
  username?: string | undefined;
  password?: string | undefined;
  // Local data path (embedded drivers)
  databasePath?: string | undefined;
  readOnly?: boolean | undefined;
  // Shared
  graphName?: string | undefined;
  /** Additional driver-specific options */
  options?: Record<string, unknown> | undefined;
}

/**
 * Low-level database driver interface.
 * Implementations handle connection, query execution, schema setup, and result normalization.
 */
export interface DatabaseDriver {
  /** Connect to the database */
  connect(config: DriverConfig): Promise<void>;

  /** Execute a read-write Cypher query */
  query<T>(cypher: string, params?: QueryParams, timeout?: number): Promise<{ data: T[]; metadata: string[] }>;

  /** Execute a read-only Cypher query (uses replica if available) */
  roQuery<T>(cypher: string, params?: QueryParams, timeout?: number): Promise<{ data: T[]; metadata: string[] }>;

  /** Ensure the database schema exists (indexes, constraints) */
  ensureSchema(opts?: { embeddingDim?: number }): Promise<void>;

  /** Close the database connection */
  close(): Promise<void>;

  /** Cypher dialect adapter for this driver */
  readonly dialect: CypherDialect;
}

/**
 * Cypher dialect adapter for graph database drivers.
 * Operations and queries use this to emit compatible Cypher.
 */
export interface CypherDialect {
  /** Which driver this dialect belongs to */
  readonly driverType: string;

  /** Expression to get node labels: `labels(n)` */
  labelsExpr(alias: string): string;

  /** Expression to get first label: `labels(n)[0]` */
  firstLabelExpr(alias: string): string;

  /** Expression to get edge type: `type(r)` */
  typeExpr(alias: string): string;

  /** Expression to check a node's label in a WHERE clause: `n:File` */
  labelCheckExpr(alias: string, label: string): string;

  /** Expression for CASE WHEN label check: `CASE WHEN n:File THEN ...` */
  labelCaseExpr(alias: string, label: string): string;

  /** Whether MERGE ... ON CREATE SET / ON MATCH SET is supported */
  supportsOnCreateOnMatch: boolean;

  /** Normalize a raw node from query results into { labels, properties } */
  normalizeNode(raw: unknown): { labels: string[]; properties: Record<string, unknown> };

  /** Normalize a raw edge from query results into { type, properties } */
  normalizeEdge(raw: unknown): { type: string; properties: Record<string, unknown> };
}
