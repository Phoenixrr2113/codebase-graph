/**
 * Kuzu Driver — embedded graph database (no Docker required)
 * Uses the `kuzu` npm package for an in-process graph database.
 */

import type { DatabaseDriver, DriverConfig, CypherDialect } from '../driver';
import type { QueryParams } from '../client';
import { ALL_DDL } from './kuzu-schema';

// ============================================================================
// Kuzu Dialect
// ============================================================================

/** Internal Kuzu node fields to strip when extracting properties */
const KUZU_INTERNAL_KEYS = new Set(['_label', '_id', '_src', '_dst']);

export const kuzuDialect: CypherDialect = {
  driverType: 'kuzu',

  labelsExpr(alias: string): string {
    // Kuzu's label() returns a single string; wrap in array for compatibility
    return `[label(${alias})]`;
  },

  firstLabelExpr(alias: string): string {
    return `label(${alias})`;
  },

  typeExpr(alias: string): string {
    return `label(${alias})`;
  },

  labelCheckExpr(alias: string, label: string): string {
    return `label(${alias}) = '${label}'`;
  },

  labelCaseExpr(alias: string, label: string): string {
    return `label(${alias}) = '${label}'`;
  },

  supportsOnCreateOnMatch: false,

  normalizeNode(raw: unknown): { labels: string[]; properties: Record<string, unknown> } {
    const node = raw as Record<string, unknown>;
    const label = node['_label'] as string | undefined;
    const labels = label ? [label] : [];
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (!KUZU_INTERNAL_KEYS.has(key)) {
        properties[key] = value;
      }
    }
    return { labels, properties };
  },

  normalizeEdge(raw: unknown): { type: string; properties: Record<string, unknown> } {
    const edge = raw as Record<string, unknown>;
    const type = (edge['_label'] as string) ?? '';
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(edge)) {
      if (!KUZU_INTERNAL_KEYS.has(key)) {
        properties[key] = value;
      }
    }
    return { type, properties };
  },
};

// ============================================================================
// Kuzu Driver
// ============================================================================

// Use dynamic import typing — kuzu module loaded at runtime
interface KuzuDatabase {
  close(): Promise<void>;
}

interface KuzuConnection {
  query(cypher: string): Promise<KuzuQueryResult>;
  prepare(cypher: string): Promise<KuzuPreparedStatement>;
  execute(stmt: KuzuPreparedStatement, params: Record<string, unknown>): Promise<KuzuQueryResult>;
  close(): Promise<void>;
}

interface KuzuQueryResult {
  getAll(): Promise<Record<string, unknown>[]>;
  close?(): void;
}

interface KuzuPreparedStatement {
  // opaque handle
}

interface KuzuModule {
  Database: new (path: string, bufferPoolSize?: number, readOnly?: boolean) => KuzuDatabase;
  Connection: new (db: KuzuDatabase) => KuzuConnection;
}

export class KuzuDriver implements DatabaseDriver {
  private kuzuModule: KuzuModule | null = null;
  private db: KuzuDatabase | null = null;
  private conn: KuzuConnection | null = null;
  readonly dialect: CypherDialect = kuzuDialect;

  async connect(config: DriverConfig): Promise<void> {
    const dbPath = config.databasePath ?? process.env['CODEGRAPH_DB_PATH'] ?? '.codegraph/kuzu';

    // Ensure the parent directory exists (Kuzu creates the DB dir itself)
    const { dirname } = await import('node:path');
    const { mkdir } = await import('node:fs/promises');
    await mkdir(dirname(dbPath), { recursive: true });

    // Dynamic import to avoid requiring kuzu when using FalkorDB
    const kuzu = await import('kuzu') as unknown as KuzuModule;
    // Handle both default export and direct export patterns
    this.kuzuModule = (kuzu as unknown as { default?: KuzuModule }).default ?? kuzu;

    this.db = new this.kuzuModule.Database(dbPath, 0, config.readOnly ?? false);
    this.conn = new this.kuzuModule.Connection(this.db);
  }

  async query<T>(cypher: string, params?: QueryParams, _timeout?: number): Promise<{ data: T[]; metadata: string[] }> {
    if (!this.conn) throw new Error('KuzuDriver: not connected');
    return this._execute<T>(cypher, params);
  }

  async roQuery<T>(cypher: string, params?: QueryParams, _timeout?: number): Promise<{ data: T[]; metadata: string[] }> {
    // Kuzu is embedded — no read replica distinction
    return this.query<T>(cypher, params);
  }

  async ensureSchema(): Promise<void> {
    if (!this.conn) throw new Error('KuzuDriver: not connected');
    for (const ddl of ALL_DDL) {
      try {
        await this.conn.query(ddl);
      } catch (error) {
        const msg = error instanceof Error ? error.message : '';
        // Skip "already exists" errors
        if (!msg.includes('already exists')) throw error;
      }
    }
  }

  async close(): Promise<void> {
    if (this.conn) {
      await this.conn.close();
      this.conn = null;
    }
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
    // Null the module ref so GC can collect native handles
    // before process exit (mitigates kuzudb/kuzu#5316 SIGSEGV)
    this.kuzuModule = null;
  }

  // ============================================================================
  // Internal
  // ============================================================================

  private async _execute<T>(
    cypher: string,
    params?: QueryParams,
  ): Promise<{ data: T[]; metadata: string[] }> {
    if (!this.conn) throw new Error('KuzuDriver: not connected');

    let result: KuzuQueryResult;

    if (params && Object.keys(params).length > 0) {
      const stmt = await this.conn.prepare(cypher);
      result = await this.conn.execute(stmt, params as Record<string, unknown>);
    } else {
      const queryResult = await this.conn.query(cypher);
      // conn.query can return an array for multi-statement queries
      if (Array.isArray(queryResult)) {
        result = queryResult[queryResult.length - 1] as KuzuQueryResult;
      } else {
        result = queryResult;
      }
    }

    const rows = await result.getAll();

    // Explicitly close the native QueryResult to prevent use-after-free
    // on process exit (known Kuzu issue: kuzudb/kuzu#5316)
    if (typeof result.close === 'function') {
      result.close();
    }

    return {
      data: rows as T[],
      metadata: [],
    };
  }
}
