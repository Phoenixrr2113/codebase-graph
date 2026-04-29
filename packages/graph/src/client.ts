/**
 * @codegraph/graph - Graph Client
 * Connection management for CodeGraph — driver-agnostic
 */

import type { Graph } from 'falkordb';
import { trace, toErrorMessage } from '@codegraph/logger';
import type { DatabaseDriver, DriverConfig, CypherDialect } from './driver';
import { FalkorDBDriver } from './drivers/falkordb';
import { FalkorDBLiteDriver } from './drivers/falkordblite';

/**
 * FalkorDB connection configuration (backward-compatible alias)
 */
export interface FalkorConfig {
  /** Full connection URL - takes priority if set (env: FALKORDB_URL) */
  url?: string;
  /** FalkorDB host (default: localhost, env: FALKORDB_HOST) */
  host?: string;
  /** FalkorDB port (default: 6379, env: FALKORDB_PORT) */
  port?: number;
  /** Graph name (default: codegraph, env: FALKORDB_GRAPH) */
  graphName?: string;
  /** Connection username (optional, env: FALKORDB_USERNAME) */
  username?: string;
  /** Connection password (optional, env: FALKORDB_PASSWORD) */
  password?: string;
}

/**
 * Unified graph config — FalkorDB primary, FalkorDBLite embedded
 */
export interface GraphConfig {
  driver?: 'falkordb' | 'falkordblite';
  // FalkorDB-specific (remote)
  url?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  // FalkorDBLite — local data path
  databasePath?: string;
  readOnly?: boolean;
  // Shared
  graphName?: string;
}

/**
 * Query parameters type for graph operations
 */
export type QueryParams = Record<string, string | number | boolean | null | Array<unknown>>;

/**
 * Query options for graph operations
 */
export interface QueryOptions {
  params: QueryParams;
  timeout?: number;
}

/**
 * Query result from graph database
 */
export interface QueryResult<T> {
  data: T[];
  metadata: string[];
}

/**
 * Graph client error types
 */
export class GraphClientError extends Error {
  constructor(
    message: string,
    public readonly code: 'CONNECTION_FAILED' | 'QUERY_FAILED' | 'INDEX_FAILED' | 'INDEX_DIM_CONFLICT' | 'UNKNOWN'
  ) {
    super(message);
    this.name = 'GraphClientError';
  }
}

/**
 * GraphClient interface for typed graph operations
 */
export interface GraphClient {
  /** The underlying FalkorDB Graph instance (null for non-FalkorDB drivers) */
  readonly graph: Graph | null;
  /** Graph name */
  readonly graphName: string;
  /** Cypher dialect for this driver */
  readonly dialect: CypherDialect;

  /**
   * Execute a Cypher query with optional parameters
   */
  query<T>(cypher: string, options?: QueryOptions): Promise<QueryResult<T>>;

  /**
   * Execute a read-only Cypher query (uses replica if available)
   */
  roQuery<T>(cypher: string, options?: QueryOptions): Promise<QueryResult<T>>;

  /**
   * Ensure all required indexes/schema exist.
   * @param opts.embeddingDim - Optional embedding dimension override. Threads through
   *   to ensureSchemaImpl. See driver.ts for details.
   */
  ensureIndexes(opts?: { embeddingDim?: number }): Promise<void>;

  /**
   * Close the client connection
   */
  close(): Promise<void>;
}

/**
 * Driver-based GraphClient implementation
 */
class GraphClientImpl implements GraphClient {
  readonly graphName: string;
  private schemaCreated = false;
  /** The embeddingDim used when the schema was first created, if any. */
  private firstEmbeddingDim: number | undefined = undefined;

  constructor(
    private readonly driver: DatabaseDriver,
    graphName: string,
  ) {
    this.graphName = graphName;
  }

  /** Backward-compatible graph accessor — returns FalkorDB Graph or null */
  get graph(): Graph | null {
    if (this.driver instanceof FalkorDBDriver) {
      return this.driver.getGraph();
    }
    if (this.driver instanceof FalkorDBLiteDriver) {
      return this.driver.getGraph();
    }
    return null;
  }

  get dialect(): CypherDialect {
    return this.driver.dialect;
  }

  @trace()
  async query<T>(cypher: string, options?: QueryOptions): Promise<QueryResult<T>> {
    try {
      return await this.driver.query<T>(cypher, options?.params, options?.timeout);
    } catch (error) {
      throw new GraphClientError(
        `Query failed: ${toErrorMessage(error)}`,
        'QUERY_FAILED'
      );
    }
  }

  @trace()
  async roQuery<T>(cypher: string, options?: QueryOptions): Promise<QueryResult<T>> {
    try {
      return await this.driver.roQuery<T>(cypher, options?.params, options?.timeout);
    } catch (error) {
      throw new GraphClientError(
        `Read-only query failed: ${toErrorMessage(error)}`,
        'QUERY_FAILED'
      );
    }
  }

  @trace()
  async ensureIndexes(opts?: { embeddingDim?: number }): Promise<void> {
    // Schema is created exactly once per client lifetime. Repeat calls with
    // different `opts` are no-ops by design — re-applying schema with a
    // different embeddingDim would require dropping vector indexes first.
    if (this.schemaCreated) {
      // Guard: if the caller passes a different embeddingDim than was used at
      // creation time, throw rather than silently no-op. Silently accepting a
      // conflicting dim would leave the vector index at the wrong dimension.
      if (
        opts?.embeddingDim !== undefined &&
        this.firstEmbeddingDim !== undefined &&
        opts.embeddingDim !== this.firstEmbeddingDim
      ) {
        throw new GraphClientError(
          `ensureIndexes called with embeddingDim=${opts.embeddingDim} but schema was created with embeddingDim=${this.firstEmbeddingDim}. ` +
          `Close and recreate the client to change dimension.`,
          'INDEX_DIM_CONFLICT',
        );
      }
      return;
    }
    try {
      await this.driver.ensureSchema(opts);
      this.schemaCreated = true;
      this.firstEmbeddingDim = opts?.embeddingDim;
    } catch (error) {
      const errorMessage = toErrorMessage(error);
      // FalkorDB says "already indexed"
      if (!errorMessage.includes('Index already exists') && !errorMessage.includes('already indexed')) {
        throw new GraphClientError(`Index creation failed: ${errorMessage}`, 'INDEX_FAILED');
      }
      this.schemaCreated = true;
      this.firstEmbeddingDim = opts?.embeddingDim;
    }
  }

  @trace()
  async close(): Promise<void> {
    await this.driver.close();
  }
}

/**
 * Create a new graph client connection.
 *
 * Defaults to FalkorDB using FALKORDB_* env vars.
 * Supports FalkorConfig for simple use or GraphConfig for driver selection.
 *
 * @example
 * ```typescript
 * // FalkorDB remote (default)
 * const client = await createClient();
 *
 * // FalkorDB explicit host/port
 * const client = await createClient({ host: 'localhost', port: 6379 });
 *
 * // FalkorDBLite embedded (no Docker needed)
 * const client = await createClient({ driver: 'falkordblite' });
 * const client = await createClient({ driver: 'falkordblite', databasePath: '.codegraph/falkordb' });
 *
 * ```
 */
/**
 * Load config from .codegraph/config.json if it exists.
 * Falls back to env vars and defaults.
 */
async function loadConfigFile(): Promise<Partial<GraphConfig>> {
  try {
    const { readFile } = await import('node:fs/promises');
    const { resolve, isAbsolute } = await import('node:path');

    // Search for .codegraph/config.json in cwd and up to 5 parent dirs
    let dir = process.cwd();
    for (let i = 0; i < 6; i++) {
      const configPath = resolve(dir, '.codegraph', 'config.json');
      try {
        const raw = await readFile(configPath, 'utf-8');
        const config = JSON.parse(raw) as Partial<GraphConfig>;

        // Resolve relative databasePath against the dir that contains .codegraph/
        if (config.databasePath && !isAbsolute(config.databasePath)) {
          config.databasePath = resolve(dir, config.databasePath);
        }

        return config;
      } catch {
        // not found, try parent
        const parent = resolve(dir, '..');
        if (parent === dir) break; // reached root
        dir = parent;
      }
    }
  } catch {
    // fs not available or other error — return empty
  }
  return {};
}

/**
 * Detect the best default driver. Prefers FalkorDBLite (embedded, no Docker)
 * when the package is installed; falls back to FalkorDB (remote) otherwise.
 */
async function detectDefaultDriver(): Promise<'falkordb' | 'falkordblite'> {
  // If remote connection is configured, use the remote driver
  if (process.env['FALKORDB_URL'] || process.env['FALKORDB_HOST']) {
    return 'falkordb';
  }
  try {
    await import('falkordblite');
    return 'falkordblite';
  } catch {
    return 'falkordb';
  }
}

export async function createClient(config?: FalkorConfig | GraphConfig): Promise<GraphClient> {
  // Layer config: explicit arg > config file > env vars > default (FalkorDB)
  const fileConfig = await loadConfigFile();

  const driverType: 'falkordb' | 'falkordblite' = (config as GraphConfig)?.driver
    ?? process.env['CODEGRAPH_DRIVER'] as 'falkordb' | 'falkordblite' | undefined
    ?? fileConfig.driver
    ?? await detectDefaultDriver();

  const graphName = config?.graphName
    ?? process.env['FALKORDB_GRAPH']
    ?? fileConfig.graphName
    ?? 'codegraph';

  const driverConfig: DriverConfig = {
    driver: driverType,
    graphName,
    // FalkorDB fields
    url: config?.url ?? fileConfig.url,
    host: (config as FalkorConfig)?.host ?? fileConfig.host,
    port: (config as FalkorConfig)?.port ?? fileConfig.port,
    username: (config as FalkorConfig)?.username ?? fileConfig.username,
    password: (config as FalkorConfig)?.password ?? fileConfig.password,
    // Embedded driver data path
    databasePath: (config as GraphConfig)?.databasePath
      ?? process.env['CODEGRAPH_DB_PATH']
      ?? fileConfig.databasePath,
    readOnly: (config as GraphConfig)?.readOnly ?? fileConfig.readOnly,
  };

  let driver: DatabaseDriver;

  if (driverType === 'falkordblite') {
    // Embedded FalkorDB — no Docker needed
    driver = new FalkorDBLiteDriver();
  } else {
    // Remote FalkorDB (default)
    driver = new FalkorDBDriver();
  }

  try {
    await driver.connect(driverConfig);
    return new GraphClientImpl(driver, graphName);
  } catch (error) {
    const msg = toErrorMessage(error);
    let hint = '';
    if (driverType === 'falkordb') {
      hint = '\nHint: Is FalkorDB running? Try: docker compose up -d falkordb';
    } else if (driverType === 'falkordblite') {
      hint = '\nHint: Is falkordblite installed? Try: pnpm add falkordblite';
    }
    throw new GraphClientError(
      `Failed to connect (${driverType}): ${msg}${hint}`,
      'CONNECTION_FAILED'
    );
  }
}
