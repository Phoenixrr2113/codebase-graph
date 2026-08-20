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

import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
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

/**
 * Bytes the embedded package appends to the data directory when it generates a
 * socket name: a path separator plus `fdb-` + 16 hex characters + `.sock`.
 */
const socketFilenameBytes = 1 + 'fdb-'.length + 16 + '.sock'.length;

/**
 * sun_path is a fixed size buffer that must also hold a terminating NUL, so a
 * pathname occupying the full documented capacity cannot be bound.
 */
const socketTerminatorBytes = 1;

/** Maximum Unix domain socket path length, from UNIX_PATH_MAX in sys/un.h. */
export function unixSocketPathLimit(platform: NodeJS.Platform = process.platform): number {
  return platform === 'darwin' ? 104 : 108;
}

/**
 * Pick the embedded database directory.
 *
 * falkordblite always derives its Unix socket from the data directory and does
 * not let a caller override the socket path, so a deep checkout produces a
 * socket path over the platform limit and every connection fails. When the
 * configured directory cannot fit a socket name, fall back to a short,
 * deterministic directory under the user's home so the same project always maps
 * to the same database.
 */
export function resolveEmbeddedDataPath(
  rawPath: string,
  options: {
    platform?: NodeJS.Platform;
    home?: string;
  } = {},
): { dataPath: string; relocatedFrom?: string } {
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const configured = resolve(rawPath);

  // Windows uses named pipes, so the Unix path limit does not apply.
  if (platform === 'win32') return { dataPath: configured };

  const budget = unixSocketPathLimit(platform) - socketFilenameBytes - socketTerminatorBytes;
  if (Buffer.byteLength(configured) <= budget) return { dataPath: configured };

  const digest = createHash('sha256').update(configured).digest('hex').slice(0, 12);
  return {
    dataPath: join(home, '.codegraph', 'graphs', digest),
    relocatedFrom: configured,
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
// Shutdown ownership
//
// connect() strips the embedded wrapper's own SIGINT/SIGTERM handlers, because
// they stop Redis before our client has disconnected. Removing them without a
// replacement is worse: with no listener on those signals Node takes the default
// action and terminates at once, and a process killed by a signal never runs its
// 'exit' handlers. The spawned redis-server is then reparented to init and lives
// on. Ten such orphans were observed from a single day of local runs, every one
// of them still holding the same data directory, which also puts their stale
// snapshots in competition with the live server's.
//
// So we take shutdown back deliberately: track open drivers, and on a signal
// close them in the right order (client first, then server) before re-raising.
// ============================================================================

const openDrivers = new Set<FalkorDBLiteDriver>();
let shutdownHandlers: Map<NodeJS.Signals, NodeJS.SignalsListener> | null = null;

function installShutdownHandlers(): void {
  if (shutdownHandlers) return;
  const handlers = new Map<NodeJS.Signals, NodeJS.SignalsListener>();
  for (const signal of shutdownSignals) {
    const handler = (): void => {
      void (async (): Promise<void> => {
        await closeOpenDrivers();
        // Our listener is gone by now, so this re-raise reaches Node's default
        // handler and terminates with the conventional signal status.
        process.kill(process.pid, signal);
      })();
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  shutdownHandlers = handlers;
}

function removeShutdownHandlers(): void {
  if (!shutdownHandlers) return;
  for (const [signal, handler] of shutdownHandlers) {
    process.removeListener(signal, handler);
  }
  shutdownHandlers = null;
}

async function closeOpenDrivers(): Promise<void> {
  const drivers = Array.from(openDrivers);
  removeShutdownHandlers();
  await Promise.allSettled(drivers.map((driver) => driver.close()));
}

/** Test seam: reports whether a shutdown handler is currently installed. */
export function hasEmbeddedShutdownHandlers(): boolean {
  return shutdownHandlers !== null;
}

/**
 * Startup budget for the embedded server.
 *
 * The wrapper defaults to 10s, which is enough for an empty database and not
 * enough for a real one: a 52MB snapshot took 18.7s to load here, and the
 * failure surfaced as a connection error suggesting the package was not
 * installed. Redis has to read the whole snapshot before it answers, so the
 * budget has to follow the file. Measured cost was roughly 360ms per MB; the
 * allowance below is about double that, over a floor that covers a cold start.
 */
const STARTUP_TIMEOUT_FLOOR_MS = 30_000;
const STARTUP_TIMEOUT_PER_MB_MS = 400;
const STARTUP_TIMEOUT_CEILING_MS = 300_000;

export function resolveStartupTimeout(
  dataPath: string,
  environment: NodeJS.ProcessEnv = process.env,
  sizeOf: (path: string) => number | undefined = (path) => {
    try {
      return statSync(path).size;
    } catch {
      return undefined;
    }
  },
): number {
  const override = environment['CODEGRAPH_DB_STARTUP_TIMEOUT_MS'];
  if (override !== undefined) {
    const parsed = Number.parseInt(override, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }

  const snapshotBytes = sizeOf(join(dataPath, 'dump.rdb')) ?? 0;
  const megabytes = snapshotBytes / (1024 * 1024);
  const budget = STARTUP_TIMEOUT_FLOOR_MS + Math.ceil(megabytes * STARTUP_TIMEOUT_PER_MB_MS);
  return Math.min(budget, STARTUP_TIMEOUT_CEILING_MS);
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
  /** Ensures the relocation notice is printed at most once per process. */
  static warnedAboutRelocation = false;

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
    const { dataPath, relocatedFrom } = resolveEmbeddedDataPath(rawPath);
    if (relocatedFrom !== undefined && !FalkorDBLiteDriver.warnedAboutRelocation) {
      FalkorDBLiteDriver.warnedAboutRelocation = true;
      console.warn(
        `[codegraph] Embedded database moved to ${dataPath} because "${relocatedFrom}" is too ` +
          'long for a Unix socket on this platform. Set CODEGRAPH_DB_PATH to choose another location.',
      );
    }

    // The driver owns shutdown through close(). Keep the embedded wrapper from
    // installing competing signal handlers that can stop Redis before its
    // client disconnects.
    const binaryPaths = resolveEmbeddedBinaryPaths();
    const signalListenersBeforeOpen = captureSignalListeners();
    try {
      this.db = await FalkorDBLite.open({
        path: dataPath,
        timeout: resolveStartupTimeout(dataPath),
        ...(binaryPaths ?? {}),
      });
    } finally {
      removeAddedSignalListeners(signalListenersBeforeOpen);
    }

    // We just took the wrapper's shutdown handlers away, so we owe the process
    // a replacement before anything can interrupt it.
    openDrivers.add(this);
    installShutdownHandlers();

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
    openDrivers.delete(this);
    if (openDrivers.size === 0) removeShutdownHandlers();
    if (this.db) {
      const db = this.db;
      // Clear first so a concurrent signal-driven close cannot stop the server twice.
      this.db = null;
      this.graph = null;
      await db.close();
    }
  }

  /** Expose the underlying FalkorDB Graph for backward compatibility */
  getGraph(): Graph | null {
    return this.graph;
  }
}
