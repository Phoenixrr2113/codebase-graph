/**
 * FalkorDB Driver — client-server graph database (requires Docker)
 * Extracted from client.ts to implement the DatabaseDriver interface.
 */

import { FalkorDB, type Graph, type FalkorDBOptions } from 'falkordb';
import type { QueryOptions as FalkorQueryOptions } from 'falkordb/dist/src/commands';
import type { DatabaseDriver, DriverConfig, CypherDialect } from '../driver';
import type { QueryParams } from '../client';

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
    if (!this.graph) throw new Error('FalkorDBDriver: not connected');
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
    if (!this.graph) throw new Error('FalkorDBDriver: not connected');

    // Helper: run a query ignoring "Index already exists" errors
    const safeIndex = async (cypher: string): Promise<void> => {
      try {
        await this.graph!.query(cypher);
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
          // Entity might not have 'name' — it uses 'text'. Try 'text' for Entity.
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
