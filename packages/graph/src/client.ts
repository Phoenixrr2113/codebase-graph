/**
 * @codegraph/graph - Graph Client
 * Connection management for CodeGraph — driver-agnostic
 */

import type { Graph } from 'falkordb';
import { trace } from '@codegraph/logger';
import type { DatabaseDriver, DriverConfig, CypherDialect } from './driver';
import { FalkorDBDriver } from './drivers/falkordb';

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
 * Unified graph config — supports both FalkorDB and Kuzu
 */
export interface GraphConfig {
  driver?: 'falkordb' | 'kuzu';
  // FalkorDB-specific
  url?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  // Kuzu-specific
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
    public readonly code: 'CONNECTION_FAILED' | 'QUERY_FAILED' | 'INDEX_FAILED' | 'UNKNOWN'
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
   * Ensure all required indexes/schema exist
   */
  ensureIndexes(): Promise<void>;

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
        `Query failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
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
        `Read-only query failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'QUERY_FAILED'
      );
    }
  }

  @trace()
  async ensureIndexes(): Promise<void> {
    if (this.schemaCreated) return;
    try {
      await this.driver.ensureSchema();
      this.schemaCreated = true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (!errorMessage.includes('Index already exists')) {
        throw new GraphClientError(`Index creation failed: ${errorMessage}`, 'INDEX_FAILED');
      }
      this.schemaCreated = true;
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
 * Supports both legacy FalkorConfig and new GraphConfig with driver selection.
 * No args → defaults to FalkorDB using existing FALKORDB_* env vars.
 * Set `driver: 'kuzu'` or env `CODEGRAPH_DRIVER=kuzu` for embedded Kuzu.
 *
 * @example
 * ```typescript
 * // FalkorDB (default, backward compatible)
 * const client = await createClient();
 *
 * // FalkorDB explicit
 * const client = await createClient({ host: 'localhost', port: 6379 });
 *
 * // Kuzu embedded
 * const client = await createClient({ driver: 'kuzu', databasePath: '.codegraph/kuzu' });
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
 * Auto-detect driver: if a Kuzu database exists at the default path, use Kuzu.
 * Otherwise fall back to FalkorDB.
 */
async function autoDetectDriver(): Promise<'falkordb' | 'kuzu'> {
  try {
    const { stat } = await import('node:fs/promises');
    const { resolve } = await import('node:path');

    // Search for .codegraph/kuzu in cwd and up to 5 parent dirs
    let dir = process.cwd();
    for (let i = 0; i < 6; i++) {
      const kuzuPath = resolve(dir, '.codegraph', 'kuzu');
      try {
        const info = await stat(kuzuPath);
        if (info.isFile() || info.isDirectory()) return 'kuzu';
      } catch {
        // not found, try parent
      }
      const parent = resolve(dir, '..');
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // doesn't exist
  }
  return 'falkordb';
}

export async function createClient(config?: FalkorConfig | GraphConfig): Promise<GraphClient> {
  // Layer config: explicit arg > config file > env vars > auto-detect
  const fileConfig = await loadConfigFile();

  const explicitDriver = (config as GraphConfig)?.driver
    ?? process.env['CODEGRAPH_DRIVER'] as 'falkordb' | 'kuzu' | undefined
    ?? fileConfig.driver;

  const driverType = explicitDriver ?? await autoDetectDriver();

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
    // Kuzu fields
    databasePath: (config as GraphConfig)?.databasePath
      ?? process.env['CODEGRAPH_DB_PATH']
      ?? fileConfig.databasePath,
    readOnly: (config as GraphConfig)?.readOnly ?? fileConfig.readOnly,
  };

  let driver: DatabaseDriver;

  if (driverType === 'kuzu') {
    // Lazy import to avoid requiring kuzu when using FalkorDB
    const { KuzuDriver } = await import('./drivers/kuzu');
    driver = new KuzuDriver();
  } else {
    driver = new FalkorDBDriver();
  }

  try {
    await driver.connect(driverConfig);
    return new GraphClientImpl(driver, graphName);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    const hint = driverType === 'falkordb'
      ? '\nHint: Is FalkorDB running? Or set CODEGRAPH_DRIVER=kuzu for embedded mode.'
      : driverType === 'kuzu' && !driverConfig.databasePath
        ? '\nHint: Set CODEGRAPH_DB_PATH or add databasePath to .codegraph/config.json'
        : '';
    throw new GraphClientError(
      `Failed to connect (${driverType}): ${msg}${hint}`,
      'CONNECTION_FAILED'
    );
  }
}
