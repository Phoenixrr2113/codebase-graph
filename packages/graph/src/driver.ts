/**
 * @codegraph/graph - Database Driver Abstraction
 * Supports FalkorDB (remote), FalkorDBLite (embedded), and Kuzu (legacy)
 */

import type { QueryParams } from './client';

/**
 * Driver configuration — union of FalkorDB and Kuzu options
 */
export interface DriverConfig {
  driver: 'falkordb' | 'falkordblite' | 'kuzu';
  // FalkorDB-specific (remote)
  url?: string | undefined;
  host?: string | undefined;
  port?: number | undefined;
  username?: string | undefined;
  password?: string | undefined;
  // FalkorDBLite / Kuzu — local data path
  databasePath?: string | undefined;
  readOnly?: boolean | undefined;
  // Shared
  graphName?: string | undefined;
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

  /** Ensure the database schema exists (indexes for FalkorDB, tables for Kuzu) */
  ensureSchema(): Promise<void>;

  /** Close the database connection */
  close(): Promise<void>;

  /** Cypher dialect adapter for this driver */
  readonly dialect: CypherDialect;
}

/**
 * Cypher dialect differences between FalkorDB and Kuzu.
 * Operations and queries use this to emit compatible Cypher.
 */
export interface CypherDialect {
  /** Which driver this dialect belongs to */
  readonly driverType: 'falkordb' | 'falkordblite' | 'kuzu';

  /** Expression to get node labels: `labels(n)` (FalkorDB) vs `[label(n)]` (Kuzu) */
  labelsExpr(alias: string): string;

  /** Expression to get first label: `labels(n)[0]` (FalkorDB) vs `label(n)` (Kuzu) */
  firstLabelExpr(alias: string): string;

  /** Expression to get edge type: `type(r)` (FalkorDB) vs `label(r)` (Kuzu) */
  typeExpr(alias: string): string;

  /**
   * Expression to check a node's label in a WHERE clause.
   * FalkorDB: `n:File` — Kuzu: `label(n) = 'File'`
   */
  labelCheckExpr(alias: string, label: string): string;

  /**
   * Expression for CASE WHEN label check.
   * FalkorDB: `CASE WHEN n:File THEN ...` — Kuzu: `CASE WHEN label(n) = 'File' THEN ...`
   */
  labelCaseExpr(alias: string, label: string): string;

  /** Whether MERGE ... ON CREATE SET / ON MATCH SET is supported */
  supportsOnCreateOnMatch: boolean;

  /**
   * Normalize a raw node from query results into { labels, properties }.
   * FalkorDB returns `{ id, labels, properties: {...} }` (nested).
   * Kuzu returns `{ _label, _id, prop1, prop2, ... }` (flat).
   */
  normalizeNode(raw: unknown): { labels: string[]; properties: Record<string, unknown> };

  /**
   * Normalize a raw edge from query results into { type, properties }.
   * FalkorDB returns `{ type, properties: {...} }`.
   * Kuzu returns `{ _label, _src, _dst, prop1, prop2, ... }` (flat).
   */
  normalizeEdge(raw: unknown): { type: string; properties: Record<string, unknown> };
}
