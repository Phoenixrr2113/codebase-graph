/**
 * Index health checks for the search benchmark.
 * See docs/superpowers/specs/2026-04-30-search-benchmark-regression-detection-design.md
 */

import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { GraphClient } from '../packages/graph/dist/index.js';

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

export type EmbeddingProvider = 'voyage' | 'openrouter' | 'local' | 'none';

const PROVIDER_DIMS: Record<Exclude<EmbeddingProvider, 'none'>, number> = {
  voyage: 1024,
  openrouter: 1536,
  local: 768,
};

export async function checkEmbeddingDim(
  client: GraphClient,
  provider: EmbeddingProvider,
): Promise<CheckResult> {
  const name = 'embedding-dim';
  // provider === 'none' means embeddings are intentionally disabled; no dim to check.
  // Pass (not warn) avoids alerting on configurations that intentionally run without embeddings.
  if (provider === 'none') {
    return { name, status: 'pass', message: 'No embedding provider configured (skipped)' };
  }
  const expectedDim = PROVIDER_DIMS[provider];
  // FalkorDB stores embeddings as Vectorf32 which cannot be passed to size() in Cypher.
  // Returning the full node causes the driver to deserialize Vectorf32 into a plain JS array.
  const result = await client.query<{ n: { properties: Record<string, unknown> } }>(
    'MATCH (n) WHERE n.embedding IS NOT NULL RETURN n LIMIT 1',
    { params: {} },
  );
  if (result.data.length === 0) {
    return {
      name,
      status: 'fail',
      message: 'Index has no embeddings — possibly empty or pre-embedding state',
      fix: 'Run a fresh index: rm -rf .codegraph && npx tsx scripts/clear-and-reindex.mts',
    };
  }
  const embedding = result.data[0]!.n.properties?.embedding;
  const actualDim = Array.isArray(embedding) ? embedding.length : undefined;
  if (actualDim === undefined) {
    return {
      name,
      status: 'fail',
      message: 'Could not determine embedding dimension from index',
      fix: 'Inspect the index with: pnpm tsx scripts/check-index-health.ts',
    };
  }
  if (actualDim !== expectedDim) {
    return {
      name,
      status: 'fail',
      message: `Index has ${actualDim}-dim embeddings; configured provider ${provider} produces ${expectedDim}-dim`,
      fix:
        `Reindex from scratch:\n` +
        `  rm -rf .codegraph\n` +
        `  npx tsx scripts/clear-and-reindex.mts`,
    };
  }
  return { name, status: 'pass', message: `Embedding dim ${actualDim} matches provider ${provider}` };
}

export async function checkScriptsExclusion(client: GraphClient): Promise<CheckResult> {
  const name = 'scripts-excluded';
  const result = await client.query<{ leaked: number }>(
    `MATCH (n) WHERE n.filePath STARTS WITH 'scripts/' RETURN count(n) AS leaked`,
    { params: {} },
  );
  const leaked = result.data[0]?.leaked ?? 0;
  if (leaked === 0) {
    return { name, status: 'pass', message: 'scripts/ correctly excluded from index' };
  }
  return {
    name,
    status: 'fail',
    message: `scripts/ leaked into the index (${leaked} nodes). Pollutes benchmark MRR by ~0.05.`,
    fix:
      `Reindex with scripts/ excluded (see docs/regression-analysis-2026-03-19.md "Operational requirement"):\n` +
      `  rm -rf .codegraph\n` +
      `  npx tsx scripts/clear-and-reindex.mts`,
  };
}

export function checkRerankerExplicit(env: Record<string, string | undefined>): CheckResult {
  const name = 'reranker-explicit';
  const provider = env['CODEGRAPH_RERANK_PROVIDER'];
  if (!provider || provider === 'none') {
    return {
      name,
      status: 'warn',
      message: 'CODEGRAPH_RERANK_PROVIDER not set; reranker defaults to none. Headline 0.969 baseline used Jina. Numbers from this run will understate true production quality.',
    };
  }
  return {
    name,
    status: 'pass',
    message: `Reranker provider explicitly set to "${provider}"`,
  };
}

export async function checkEmbeddingCoverage(
  client: GraphClient,
  labels: string[],
): Promise<CheckResult> {
  const name = 'embedding-coverage';
  const issues: string[] = [];
  for (const label of labels) {
    const result = await client.query<{ total: number; without: number }>(
      `MATCH (n:${label})
       WITH count(n) AS total, count(CASE WHEN n.embedding IS NULL THEN 1 END) AS without
       RETURN total, without`,
      { params: {} },
    );
    const row = result.data[0];
    if (!row || row.total === 0) continue;
    const missingPct = row.without / row.total;
    if (missingPct > 0.1) {
      issues.push(`${label}: ${row.without}/${row.total} nodes missing embeddings`);
    }
  }
  if (issues.length === 0) {
    return { name, status: 'pass', message: 'All checked labels have full embedding coverage' };
  }
  return {
    name,
    status: 'warn',
    message: `Partial embedding coverage: ${issues.join('; ')}. Possible causes: partial reindex, plugin that didn't flush, or label intentionally not embedded.`,
  };
}

export interface RunMeta {
  embeddingProvider: 'voyage' | 'openrouter' | 'local' | 'none';
  embeddingModel: string;
  embeddingDim: number;
  rerankerProvider: 'jina' | 'voyage' | 'none';
  rerankerModel: string | null;
  llmProvider: 'cerebras' | 'openrouter' | 'glm' | 'ollama';
  llmModel: string;
  gitSha: string;
  gitDirty: boolean;
  corpusNodeCount: number;
}

export interface BaselineFile {
  path: string;
  meta: RunMeta;
  body: unknown;
}

function metaMatches(a: RunMeta, b: RunMeta): boolean {
  return a.embeddingProvider === b.embeddingProvider
    && a.embeddingModel === b.embeddingModel
    && a.rerankerProvider === b.rerankerProvider
    && a.llmProvider === b.llmProvider
    && a.llmModel === b.llmModel;
}

export function findComparisonBaseline(
  dir: string,
  currentMeta: RunMeta,
): BaselineFile | null {
  const entries = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return { name: f, mtime: statSync(join(dir, f)).mtimeMs };
      } catch {
        return { name: f, mtime: 0 };  // sort to back; will be skipped at read step
      }
    })
    .sort((a, b) => b.mtime - a.mtime);

  for (const e of entries) {
    const path = join(dir, e.name);
    let body: { meta?: RunMeta };
    try {
      body = JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      continue;  // corrupt JSON, skip
    }
    if (!body.meta || typeof body.meta !== 'object' || Array.isArray(body.meta)) {
      continue;  // missing or malformed meta — treat as not comparable
    }
    if (metaMatches(body.meta, currentMeta)) {
      return { path, meta: body.meta, body };
    }
  }
  return null;
}
