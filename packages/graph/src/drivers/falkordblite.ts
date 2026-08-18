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

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import type { Graph } from 'falkordb';
import type { DatabaseDriver, DriverConfig, CypherDialect } from '../driver';
import type { QueryParams } from '../client';
import { falkorDialect } from './falkordb';
import { executeQuery, executeRoQuery, ensureSchemaImpl } from './falkordb-shared';

type FalkorDBLiteModule = typeof import('falkordblite');
type FalkorDBLiteInstance = Awaited<ReturnType<FalkorDBLiteModule['FalkorDB']['open']>>;

const shutdownSignals = ['SIGINT', 'SIGTERM'] as const;
const embeddedPlatformPackages: Readonly<Record<string, string>> = {
  'darwin-arm64': '@falkordblite/darwin-arm64',
  'linux-x64': '@falkordblite/linux-x64',
};
const runtimeRequire = createRequire(import.meta.url);

export function resolveEmbeddedBinaryPaths(
  platform: NodeJS.Platform = process.platform,
  architecture: string = process.arch,
  resolvePackage: (specifier: string) => string = (specifier) => runtimeRequire.resolve(specifier),
): { redisServerPath: string; modulePath: string } | undefined {
  const packageName = embeddedPlatformPackages[`${platform}-${architecture}`];
  if (!packageName) return undefined;

  const packageDirectory = dirname(resolvePackage(`${packageName}/package.json`));
  return {
    redisServerPath: resolve(packageDirectory, 'bin', 'redis-server'),
    modulePath: resolve(packageDirectory, 'bin', 'falkordb.so'),
  };
}

function captureSignalListeners(): Map<NodeJS.Signals, Set<NodeJS.SignalsListener>> {
  return new Map(shutdownSignals.map((signal) => [signal, new Set(process.listeners(signal))]));
}

function removeAddedSignalListeners(
  listenersBeforeOpen: Map<NodeJS.Signals, Set<NodeJS.SignalsListener>>,
): void {
  for (const signal of shutdownSignals) {
    const previousListeners = listenersBeforeOpen.get(signal) ?? new Set();
    for (const listener of process.listeners(signal)) {
      if (!previousListeners.has(listener)) {
        process.removeListener(signal, listener);
      }
    }
  }
}

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
  private db: FalkorDBLiteInstance | null = null;
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

    // The driver owns shutdown through close(). Keep the embedded wrapper from
    // installing competing signal handlers that can stop Redis before its
    // client disconnects.
    const binaryPaths = resolveEmbeddedBinaryPaths();
    const signalListenersBeforeOpen = captureSignalListeners();
    try {
      this.db = await FalkorDBLite.open({ path: dataPath, ...(binaryPaths ?? {}) });
    } finally {
      removeAddedSignalListeners(signalListenersBeforeOpen);
    }

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
