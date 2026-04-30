/**
 * Index health checks for the search benchmark.
 * See docs/superpowers/specs/2026-04-30-search-benchmark-regression-detection-design.md
 */

import { randomBytes } from 'node:crypto';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface CheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  /** Present when status is 'fail' — contains the concrete shell command to resolve the issue. */
  fix?: string;
}

export interface HealthCheckOpts {
  /** Path to a specific baseline JSON for Check 6. null skips Check 6. */
  compareAgainst?: string | null;
  /** When false, skip checks that require an existing index (used pre-reindex). */
  requireIndex?: boolean;
}

export interface HealthCheckResult {
  checks: CheckResult[];
  hasFailures: boolean;
  hasWarnings: boolean;
}

export async function checkIndexHealth(_opts: HealthCheckOpts): Promise<HealthCheckResult> {
  return {
    checks: [],
    hasFailures: false,
    hasWarnings: false,
  };
}

export interface FalkorConnInfo {
  host: string;
  port: number;
}

export async function checkFalkorDBReachable(conn: FalkorConnInfo): Promise<CheckResult> {
  const name = 'falkordb-reachable';
  // Lazy-import the graph package (matches how scripts/benchmark-search.ts does it).
  let createClient: typeof import('../packages/graph/dist/index.js').createClient;
  try {
    ({ createClient } = await import('../packages/graph/dist/index.js'));
  } catch (err) {
    return {
      name,
      status: 'fail',
      message: `Could not load @codegraph/graph: ${err instanceof Error ? err.message : String(err)}`,
      fix: 'Run `pnpm turbo build` first.',
    };
  }

  const tempGraph = `_healthcheck_${randomBytes(4).toString('hex')}`;
  let client: Awaited<ReturnType<typeof createClient>> | null = null;
  try {
    client = await createClient({
      driver: 'falkordb',
      host: conn.host,
      port: conn.port,
      graphName: tempGraph,
    });
    // GRAPH.QUERY only succeeds if the FalkorDB module is loaded. Plain Redis
    // returns "ERR unknown command", which createClient may swallow into a
    // generic error — so we run a real query to verify.
    await client.query('RETURN 1 AS ok', { params: {} });
    return {
      name,
      status: 'pass',
      message: `FalkorDB reachable on ${conn.host}:${conn.port}, GRAPH module loaded`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name,
      status: 'fail',
      message: `FalkorDB not reachable on ${conn.host}:${conn.port}: ${msg}`,
      fix:
        `Either:\n` +
        `  (a) Start one: docker run -d --name codegraph-falkordb --platform linux/arm64 -p ${conn.port}:6379 falkordb/falkordb:latest\n` +
        `  (b) Update FALKORDB_PORT in .env to match an existing container.`,
    };
  } finally {
    if (client) {
      try { await client.graph?.delete(); } catch { /* graph may not exist */ }
      try { await client.close(); } catch { /* best-effort */ }
    }
  }
}
