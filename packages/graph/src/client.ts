/**
 * @codegraph/graph - FalkorDB Client
 * Connection management and index creation for CodeGraph
 */

import { FalkorDB, type Graph, type FalkorDBOptions } from 'falkordb';
import type { QueryOptions as FalkorQueryOptions } from 'falkordb/dist/src/commands/index.js';
import { trace } from '@codegraph/logger';

/**
 * FalkorDB connection configuration
 */
export interface FalkorConfig {
  /** FalkorDB host (default: localhost, env: FALKORDB_HOST) */
  host?: string;
  /** FalkorDB port (default: 6379, env: FALKORDB_PORT) */
  port?: number;
  /** Graph name (default: codegraph, env: FALKORDB_GRAPH) */
  graphName?: string;
  /** Connection username (optional) */
  username?: string;
  /** Connection password (optional) */
  password?: string;
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
 * Query result from FalkorDB
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
 * GraphClient interface for typed FalkorDB operations
 */
export interface GraphClient {
  /** The underlying FalkorDB Graph instance */
  readonly graph: Graph;
  /** Graph name */
  readonly graphName: string;
  
  /**
   * Execute a Cypher query with optional parameters
   */
  query<T>(cypher: string, options?: QueryOptions): Promise<QueryResult<T>>;
  
  /**
   * Execute a read-only Cypher query (uses replica if available)
   */
  roQuery<T>(cypher: string, options?: QueryOptions): Promise<QueryResult<T>>;
  
  /**
   * Ensure all required indexes exist
   */
  ensureIndexes(): Promise<void>;
  
  /**
   * Close the client connection
   */
  close(): Promise<void>;
}

/**
 * Internal GraphClient implementation
 */
class GraphClientImpl implements GraphClient {
  readonly graph: Graph;
  readonly graphName: string;
  private indexesCreated = false;

  constructor(
    private readonly db: FalkorDB,
    readonly config: Required<Pick<FalkorConfig, 'graphName'>>
  ) {
    this.graphName = config.graphName;
    this.graph = db.selectGraph(config.graphName);
  }

  @trace()
  async query<T>(cypher: string, options?: QueryOptions): Promise<QueryResult<T>> {
    try {
      const queryOptions = options?.params 
        ? { params: options.params, TIMEOUT: options.timeout }
        : options?.timeout ? { TIMEOUT: options.timeout } : undefined;
      const result = await this.graph.query<T>(cypher, queryOptions as unknown as FalkorQueryOptions);
      return {
        data: result.data ?? [],
        metadata: result.metadata ?? [],
      };
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
      const queryOptions = options?.params 
        ? { params: options.params, TIMEOUT: options.timeout }
        : options?.timeout ? { TIMEOUT: options.timeout } : undefined;
      const result = await this.graph.roQuery<T>(cypher, queryOptions as unknown as FalkorQueryOptions);
      return {
        data: result.data ?? [],
        metadata: result.metadata ?? [],
      };
    } catch (error) {
      throw new GraphClientError(
        `Read-only query failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'QUERY_FAILED'
      );
    }
  }

  @trace()
  async ensureIndexes(): Promise<void> {
    if (this.indexesCreated) {
      return;
    }

    try {
      // Per spec Section 6.1: Create indexes for performance
      // File.path - exact/range index for file lookups
      await this.graph.createNodeRangeIndex('File', 'path');
      
      // Function.name - fulltext index for search
      await this.graph.createNodeFulltextIndex('Function', 'name');
      
      // Class.name - fulltext index for search
      await this.graph.createNodeFulltextIndex('Class', 'name');
      
      // Component.name - fulltext index for search
      await this.graph.createNodeFulltextIndex('Component', 'name');
      
      this.indexesCreated = true;
    } catch (error) {
      // Indexes may already exist - FalkorDB returns error for duplicate indexes
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (!errorMessage.includes('Index already exists')) {
        throw new GraphClientError(`Index creation failed: ${errorMessage}`, 'INDEX_FAILED');
      }
      this.indexesCreated = true;
    }
  }

  @trace()
  async close(): Promise<void> {
    await this.db.close();
  }
}

/**
 * Create a new FalkorDB client connection
 * 
 * @param config - Connection configuration (uses env vars as defaults)
 * @returns Connected GraphClient instance
 * 
 * @example
 * ```typescript
 * const client = await createClient({
 *   host: 'localhost',
 *   port: 6379,
 *   graphName: 'codegraph'
 * });
 * 
 * await client.ensureIndexes();
 * const result = await client.query('MATCH (f:File) RETURN f.path');
 * await client.close();
 * ```
 */
export async function createClient(config?: FalkorConfig): Promise<GraphClient> {
  const host = config?.host ?? process.env['FALKORDB_HOST'] ?? 'localhost';
  const port = config?.port ?? parseInt(process.env['FALKORDB_PORT'] ?? '6379', 10);
  const graphName = config?.graphName ?? process.env['FALKORDB_GRAPH'] ?? 'codegraph';
  const username = config?.username ?? process.env['FALKORDB_USERNAME'];
  const password = config?.password ?? process.env['FALKORDB_PASSWORD'];

  const connectionOptions: FalkorDBOptions = {
    socket: {
      host,
      port,
    },
  };

  if (username) {
    connectionOptions.username = username;
  }
  if (password) {
    connectionOptions.password = password;
  }

  try {
    const db = await FalkorDB.connect(connectionOptions);
    return new GraphClientImpl(db, { graphName });
  } catch (error) {
    throw new GraphClientError(
      `Failed to connect to FalkorDB at ${host}:${port}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      'CONNECTION_FAILED'
    );
  }
}
