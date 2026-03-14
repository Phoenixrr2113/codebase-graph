/**
 * FalkorDB Driver — client-server graph database (requires Docker)
 * Extracted from client.ts to implement the DatabaseDriver interface.
 */

import { FalkorDB, type Graph, type FalkorDBOptions } from 'falkordb';
import type { DatabaseDriver, DriverConfig, CypherDialect } from '../driver';
import type { QueryParams } from '../client';
import { executeQuery, executeRoQuery, ensureSchemaImpl } from './falkordb-shared';

// ============================================================================
// FalkorDB Dialect
// ============================================================================

/** FalkorDB internal node fields to exclude when falling back to raw object */
const FALKOR_INTERNAL_KEYS = new Set(['id', 'labels', 'properties']);

export const falkorDialect: CypherDialect = {
  driverType: 'falkordb',

  labelsExpr(alias: string): string {
    return `labels(${alias})`;
  },

  firstLabelExpr(alias: string): string {
    return `labels(${alias})[0]`;
  },

  typeExpr(alias: string): string {
    return `type(${alias})`;
  },

  labelCheckExpr(alias: string, label: string): string {
    return `${alias}:${label}`;
  },

  labelCaseExpr(alias: string, label: string): string {
    return `${alias}:${label}`;
  },

  supportsOnCreateOnMatch: true,

  normalizeNode(raw: unknown): { labels: string[]; properties: Record<string, unknown> } {
    const node = raw as Record<string, unknown>;
    const labels = (node['labels'] as string[]) ?? [];
    if (node['properties'] && typeof node['properties'] === 'object') {
      return { labels, properties: node['properties'] as Record<string, unknown> };
    }
    // Fallback: strip internal fields to avoid leaking them as properties
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (!FALKOR_INTERNAL_KEYS.has(key)) {
        properties[key] = value;
      }
    }
    return { labels, properties };
  },

  normalizeEdge(raw: unknown): { type: string; properties: Record<string, unknown> } {
    const edge = raw as Record<string, unknown>;
    const type = (edge['type'] as string) ?? (edge['relationshipType'] as string) ?? '';
    if (edge['properties'] && typeof edge['properties'] === 'object') {
      return { type, properties: edge['properties'] as Record<string, unknown> };
    }
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(edge)) {
      if (key !== 'type' && key !== 'relationshipType' && key !== 'id' && key !== 'src' && key !== 'dest') {
        properties[key] = value;
      }
    }
    return { type, properties };
  },
};

// ============================================================================
// FalkorDB Driver
// ============================================================================

export class FalkorDBDriver implements DatabaseDriver {
  private db: FalkorDB | null = null;
  private graph: Graph | null = null;
  readonly dialect: CypherDialect = falkorDialect;

  async connect(config: DriverConfig): Promise<void> {
    const url = config.url ?? process.env['FALKORDB_URL'];

    let host: string;
    let port: number;

    if (url) {
      const urlParts = url.split(':');
      if (urlParts.length >= 2) {
        host = urlParts.slice(0, -1).join(':');
        port = parseInt(urlParts[urlParts.length - 1] ?? '6379', 10);
      } else {
        host = url;
        port = 6379;
      }
    } else {
      host = config.host ?? process.env['FALKORDB_HOST'] ?? 'localhost';
      port = config.port ?? parseInt(process.env['FALKORDB_PORT'] ?? '6379', 10);
    }

    const connectionOptions: FalkorDBOptions = {
      socket: { host, port },
    };

    const username = config.username ?? process.env['FALKORDB_USERNAME'];
    const password = config.password ?? process.env['FALKORDB_PASSWORD'];

    if (username) connectionOptions.username = username;
    if (password) connectionOptions.password = password;

    this.db = await FalkorDB.connect(connectionOptions);
    const graphName = config.graphName ?? process.env['FALKORDB_GRAPH'] ?? 'codegraph';
    this.graph = this.db.selectGraph(graphName);
  }

  async query<T>(cypher: string, params?: QueryParams, timeout?: number): Promise<{ data: T[]; metadata: string[] }> {
    if (!this.graph) throw new Error('FalkorDBDriver: not connected');
    return executeQuery<T>(this.graph, cypher, params, timeout);
  }

  async roQuery<T>(cypher: string, params?: QueryParams, timeout?: number): Promise<{ data: T[]; metadata: string[] }> {
    if (!this.graph) throw new Error('FalkorDBDriver: not connected');
    return executeRoQuery<T>(this.graph, cypher, params, timeout);
  }

  async ensureSchema(): Promise<void> {
    if (!this.graph) throw new Error('FalkorDBDriver: not connected');
    return ensureSchemaImpl(this.graph);
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
