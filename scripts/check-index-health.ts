/**
 * Index health checks for the search benchmark.
 * See docs/superpowers/specs/2026-04-30-search-benchmark-regression-detection-design.md
 */

import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

const DEFAULT_LABELS = ['File', 'Function', 'Class', 'Interface', 'Variable', 'Type', 'Component'];
const __SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR_DEFAULT = join(__SCRIPT_DIR, 'benchmark-results');

/** Resolve embedding provider from env using a priority chain:
 *  1. CODEGRAPH_EMBEDDING_PROVIDER explicit setting
 *  2. Inferred from API key presence (Voyage > OpenRouter)
 *  3. Fallback to 'local' (no API key needed). Returning 'none' would suppress the dim check entirely;
 *     'local' surfaces a real signal if the index was built with a different provider. */
function getEmbeddingProviderFromEnv(env: Record<string, string | undefined>): EmbeddingProvider {
  const explicit = env['CODEGRAPH_EMBEDDING_PROVIDER'];
  if (explicit === 'voyage' || explicit === 'openrouter' || explicit === 'local' || explicit === 'none') return explicit;
  if (env['VOYAGE_API_KEY']) return 'voyage';
  if (env['OPENROUTER_API_KEY']) return 'openrouter';
  return 'local';
}

/** Build a partial RunMeta from env vars only. Used by standalone CLI; benchmark passes a fully populated one.
 *  Normalization mirrors `packages/plugin-nlp/src/llm.ts` so values match what the benchmark records. */
function buildCurrentMetaFromEnv(env: Record<string, string | undefined>): RunMeta {
  const embeddingProvider = getEmbeddingProviderFromEnv(env);

  const rerankerEnv = env['CODEGRAPH_RERANK_PROVIDER']?.toLowerCase();
  const rerankerProvider: 'jina' | 'voyage' | 'none' =
    rerankerEnv === 'jina' || rerankerEnv === 'voyage' ? rerankerEnv : 'none';

  const llmEnv = env['LLM_PROVIDER']?.toLowerCase();
  const llmProvider: 'cerebras' | 'openrouter' | 'glm' | 'ollama' =
    llmEnv === 'openrouter' || llmEnv === 'glm' || llmEnv === 'ollama' ? llmEnv : 'cerebras';

  return {
    embeddingProvider,
    embeddingModel: env['CODEGRAPH_EMBEDDING_MODEL'] ?? '',
    embeddingDim: 0,  // not known without probing the index
    rerankerProvider,
    rerankerModel: env['CODEGRAPH_RERANK_MODEL'] ?? null,
    llmProvider,
    llmModel: env['LLM_MODEL'] ?? '',
    gitSha: '',
    gitDirty: false,
    corpusNodeCount: 0,
  };
}

export async function checkIndexHealth(opts: HealthCheckOpts): Promise<HealthCheckResult> {
  const env = process.env as Record<string, string | undefined>;
  const checks: CheckResult[] = [];

  // Stage 2: FalkorDB reachable (always first)
  const conn = {
    host: env['FALKORDB_HOST'] ?? 'localhost',
    port: Number(env['FALKORDB_PORT'] ?? '6379'),
  };
  const reach = await checkFalkorDBReachable(conn);
  checks.push(reach);

  // If FalkorDB is down, every other check would just produce noise. Bail.
  if (reach.status === 'fail') {
    return { checks, hasFailures: true, hasWarnings: false };
  }

  // Stage 3: Baseline config match (no DB required, but skipped if compareAgainst === null)
  if (opts.compareAgainst !== null) {
    const currentMeta = buildCurrentMetaFromEnv(env);
    const check6 = checkBaselineConfigMatches({
      currentMeta,
      baselineDir: BASELINE_DIR_DEFAULT,
      explicitBaselinePath: opts.compareAgainst ?? undefined,
    });
    checks.push(check6);
  }

  // Stage 5+ (post-reindex): index-state checks
  if (opts.requireIndex === true) {
    let client: Awaited<ReturnType<typeof import('../packages/graph/dist/index.js').createClient>> | null = null;
    try {
      const { createClient } = await import('../packages/graph/dist/index.js');
      client = await createClient({
        driver: 'falkordb',
        host: conn.host,
        port: conn.port,
      });
      const provider = getEmbeddingProviderFromEnv(env);
      checks.push(await checkEmbeddingDim(client, provider));
      checks.push(await checkEmbeddingCoverage(client, DEFAULT_LABELS));
      checks.push(await checkScriptsExclusion(client));
    } catch (err) {
      checks.push({
        name: 'index-client',
        status: 'fail',
        message: `Could not open graph client for index checks: ${err instanceof Error ? err.message : String(err)}`,
        fix: 'Verify FalkorDB is healthy and the graph package is built: pnpm turbo build',
      });
    } finally {
      if (client) {
        try { await client.close(); } catch { /* best-effort */ }
      }
    }
    checks.push(checkRerankerExplicit(env));
  }

  return {
    checks,
    hasFailures: checks.some((c) => c.status === 'fail'),
    hasWarnings: checks.some((c) => c.status === 'warn'),
  };
}

async function main(): Promise<void> {
  // Load .env first so env-driven checks see configured values
  const envPath = resolve(__SCRIPT_DIR, '..', '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }

  const args = process.argv.slice(2);
  const compareAgainstFlag = args.find((a) => a.startsWith('--compare-against='));
  const noCompare = args.includes('--no-compare');
  const compareAgainst: string | null | undefined = noCompare
    ? null
    : compareAgainstFlag?.slice('--compare-against='.length) ?? undefined;

  const result = await checkIndexHealth({
    requireIndex: !args.includes('--pre-reindex'),
    compareAgainst,
  });

  for (const c of result.checks) {
    const sigil = c.status === 'pass' ? '✓' : c.status === 'warn' ? '⚠' : '✗';
    console.log(`${sigil} ${c.name}: ${c.message}`);
    if (c.fix) {
      console.log(`  Fix:`);
      for (const line of c.fix.split('\n')) console.log(`    ${line}`);
    }
  }

  process.exit(result.hasFailures ? 1 : 0);
}

// Run main() only when invoked as the entry script (matches the pattern in benchmarks/cgbench-v1/src/cli.ts).
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error('check-index-health crashed:', err);
    process.exit(2);
  });
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

export const PROVIDER_DIMS: Record<Exclude<EmbeddingProvider, 'none'>, number> = {
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
  const VALID_LABEL = /^[A-Za-z][A-Za-z0-9_]*$/;
  const invalid = labels.filter((l) => !VALID_LABEL.test(l));
  if (invalid.length > 0) {
    return {
      name,
      status: 'fail',
      message: `Invalid label name(s): ${invalid.join(', ')}. Labels must be alphanumeric Cypher identifiers.`,
    };
  }
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

function isValidMeta(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function metaMatches(a: RunMeta, b: RunMeta): boolean {
  return a.embeddingProvider === b.embeddingProvider
    && a.embeddingModel === b.embeddingModel
    && a.rerankerProvider === b.rerankerProvider
    && a.llmProvider === b.llmProvider
    && a.llmModel === b.llmModel;
}

export interface BaselineConfigMatchOpts {
  currentMeta: RunMeta;
  baselineDir: string;
  /** When provided, compare against THIS file specifically (ignore auto-find). */
  explicitBaselinePath: string | undefined;
}

export function checkBaselineConfigMatches(opts: BaselineConfigMatchOpts): CheckResult {
  const name = 'baseline-config-matches';

  let baseline: BaselineFile | null;
  if (opts.explicitBaselinePath !== undefined) {
    try {
      const raw = readFileSync(opts.explicitBaselinePath, 'utf-8');
      const body = JSON.parse(raw) as { meta?: unknown; label?: string };
      if (!isValidMeta(body.meta)) {
        return {
          name,
          status: 'fail',
          message: `Explicit baseline ${opts.explicitBaselinePath} has no meta field — pre-spec file, not comparable.`,
          fix: `Pass --no-compare to skip the diff, or pick a newer baseline.`,
        };
      }
      baseline = { path: opts.explicitBaselinePath, meta: body.meta as RunMeta, body };
    } catch (err) {
      return {
        name,
        status: 'fail',
        message: `Could not load explicit baseline ${opts.explicitBaselinePath}: ${err instanceof Error ? err.message : String(err)}`,
        fix: 'Delete or regenerate the corrupt baseline file, then re-run the benchmark.',
      };
    }
  } else {
    baseline = findComparisonBaseline(opts.baselineDir, opts.currentMeta);
  }

  if (baseline === null) {
    return { name, status: 'pass', message: 'No comparable baseline found — this run becomes the new reference' };
  }

  if (metaMatches(baseline.meta, opts.currentMeta)) {
    return { name, status: 'pass', message: `Baseline config matches current run (${baseline.path})` };
  }

  const b = baseline.meta;
  const c = opts.currentMeta;
  return {
    name,
    status: 'fail',
    message:
      `Cannot compare apples-to-apples:\n` +
      `  baseline ${baseline.path}: ${b.embeddingProvider}/${b.embeddingModel} + ${b.rerankerProvider} + ${b.llmProvider}/${b.llmModel}\n` +
      `  this run:                  ${c.embeddingProvider}/${c.embeddingModel} + ${c.rerankerProvider} + ${c.llmProvider}/${c.llmModel}`,
    fix:
      `Either:\n` +
      `  (a) Pass --compare-against=<matching-baseline.json> to compare against a different file\n` +
      `  (b) Pass --no-compare to skip the diff entirely; this run becomes the new reference for future comparisons.`,
  };
}

export function findComparisonBaseline(
  dir: string,
  currentMeta: RunMeta,
  excludePath?: string,
): BaselineFile | null {
  let rawEntries: string[];
  try {
    rawEntries = readdirSync(dir);
  } catch {
    return null;  // directory doesn't exist yet — no baselines to compare against
  }
  const entries = rawEntries
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
    if (excludePath !== undefined && path === excludePath) continue;  // caller's own run — not a comparable baseline
    let body: { meta?: RunMeta };
    try {
      body = JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      continue;  // corrupt JSON, skip
    }
    if (!isValidMeta(body.meta)) continue;  // missing or malformed meta — treat as not comparable
    if (metaMatches(body.meta, currentMeta)) {
      return { path, meta: body.meta, body };
    }
  }
  return null;
}

export interface BenchmarkRow {
  query: string;
  category: string;
  mrr: number;
  ndcg5: number;
  ndcg10: number;
  success1: boolean;
  success5: boolean;
  recall10: number;
  latencyMs: number;
}

export interface DiffOptions {
  /** Per-category MRR drop that triggers the regression flag. */
  threshold: number;
}

export interface CategoryDiff {
  category: string;
  baselineMrr: number;
  currentMrr: number;
  delta: number;
  regressed: boolean;
}

export interface PerQueryDiff {
  query: string;
  baselineMrr: number;
  currentMrr: number;
  delta: number;
}

export interface DiffResult {
  overallMrrDelta: number;
  overallNdcg5Delta: number;
  overallS1Delta: number;
  overallS5Delta: number;
  latencyP50Delta: number;
  perCategory: CategoryDiff[];
  /** Queries that dropped >10% MRR relative to baseline. Sorted worst-first. */
  perQueryRegressions: PerQueryDiff[];
  hasRegression: boolean;
}

function avg(rows: BenchmarkRow[], pick: (r: BenchmarkRow) => number): number {
  if (rows.length === 0) return 0;
  return rows.reduce((s, r) => s + pick(r), 0) / rows.length;
}

function fmt(v: number, places = 3): string {
  return v.toFixed(places);
}

function fmtDelta(v: number, places = 3): string {
  const sign = v >= 0 ? '+' : '';
  return `${sign}${v.toFixed(places)}`;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export function computeDiff(
  baseline: { results: BenchmarkRow[] },
  current: { results: BenchmarkRow[] },
  opts: DiffOptions,
): DiffResult {
  const overallMrrDelta = avg(current.results, (r) => r.mrr) - avg(baseline.results, (r) => r.mrr);
  const overallNdcg5Delta = avg(current.results, (r) => r.ndcg5) - avg(baseline.results, (r) => r.ndcg5);
  const overallS1Delta = avg(current.results, (r) => (r.success1 ? 1 : 0)) - avg(baseline.results, (r) => (r.success1 ? 1 : 0));
  const overallS5Delta = avg(current.results, (r) => (r.success5 ? 1 : 0)) - avg(baseline.results, (r) => (r.success5 ? 1 : 0));
  const latencyP50Delta = median(current.results.map((r) => r.latencyMs)) - median(baseline.results.map((r) => r.latencyMs));

  const categories = new Set([...baseline.results.map((r) => r.category), ...current.results.map((r) => r.category)]);
  const perCategory: CategoryDiff[] = [];
  for (const cat of categories) {
    const b = baseline.results.filter((r) => r.category === cat);
    const c = current.results.filter((r) => r.category === cat);
    const bMrr = avg(b, (r) => r.mrr);
    const cMrr = avg(c, (r) => r.mrr);
    const delta = cMrr - bMrr;
    perCategory.push({
      category: cat,
      baselineMrr: bMrr,
      currentMrr: cMrr,
      delta,
      regressed: delta < -opts.threshold,
    });
  }
  perCategory.sort((a, b) => a.category.localeCompare(b.category));

  const baselineByQuery = new Map(baseline.results.map((r) => [r.query, r]));
  const perQueryRegressions: PerQueryDiff[] = [];
  for (const cur of current.results) {
    const base = baselineByQuery.get(cur.query);
    if (!base) continue;
    const delta = cur.mrr - base.mrr;
    if (delta < -0.1) {
      perQueryRegressions.push({ query: cur.query, baselineMrr: base.mrr, currentMrr: cur.mrr, delta });
    }
  }
  perQueryRegressions.sort((a, b) => a.delta - b.delta);  // worst first

  const hasRegression = perCategory.some((c) => c.regressed);

  return {
    overallMrrDelta,
    overallNdcg5Delta,
    overallS1Delta,
    overallS5Delta,
    latencyP50Delta,
    perCategory,
    perQueryRegressions,
    hasRegression,
  };
}

export interface PrintDiffOpts {
  baseline: { label: string; timestamp: string; meta: RunMeta; results: BenchmarkRow[] };
  current: { label: string; meta: RunMeta; results: BenchmarkRow[] };
  diff: DiffResult;
  /** Regression threshold used in the diff. Defaults to 0.05 if not provided. */
  threshold?: number;
}

export function printDiffTable(opts: PrintDiffOpts): string[] {
  const { baseline, current, diff } = opts;
  const lines: string[] = [];

  lines.push(`═══ Regression diff vs ${baseline.label} (${baseline.timestamp}) ═══`);
  lines.push(
    `Config: ${current.meta.embeddingProvider}(${current.meta.embeddingDim}) + ${current.meta.rerankerProvider} + ${current.meta.llmProvider}/${current.meta.llmModel} — matched ✓`,
  );
  lines.push(`Git: ${baseline.meta.gitSha.slice(0, 8)} → ${current.meta.gitSha.slice(0, 8)}`);
  lines.push('');

  const baseAvg = (pick: (r: BenchmarkRow) => number): number =>
    baseline.results.length > 0 ? baseline.results.reduce((s, r) => s + pick(r), 0) / baseline.results.length : 0;
  const curAvg = (pick: (r: BenchmarkRow) => number): number =>
    current.results.length > 0 ? current.results.reduce((s, r) => s + pick(r), 0) / current.results.length : 0;

  const threshold = opts.threshold ?? 0.05;
  const flagOverall = (delta: number): string => (delta < -threshold ? '  ⚠ REGRESSION' : '');

  lines.push(`                         baseline    current     Δ`);
  lines.push(`Overall MRR              ${fmt(baseAvg((r) => r.mrr))}       ${fmt(curAvg((r) => r.mrr))}      ${fmtDelta(diff.overallMrrDelta)}${flagOverall(diff.overallMrrDelta)}`);
  lines.push(`Overall NDCG@5           ${fmt(baseAvg((r) => r.ndcg5))}       ${fmt(curAvg((r) => r.ndcg5))}      ${fmtDelta(diff.overallNdcg5Delta)}${flagOverall(diff.overallNdcg5Delta)}`);
  lines.push(`Overall S@1              ${fmt(baseAvg((r) => (r.success1 ? 1 : 0)))}       ${fmt(curAvg((r) => (r.success1 ? 1 : 0)))}      ${fmtDelta(diff.overallS1Delta)}${flagOverall(diff.overallS1Delta)}`);
  lines.push(`Overall S@5              ${fmt(baseAvg((r) => (r.success5 ? 1 : 0)))}       ${fmt(curAvg((r) => (r.success5 ? 1 : 0)))}      ${fmtDelta(diff.overallS5Delta)}${flagOverall(diff.overallS5Delta)}`);
  const baseLatency = Math.round(median(baseline.results.map((r) => r.latencyMs)));
  const curLatency = Math.round(median(current.results.map((r) => r.latencyMs)));
  const latencyDelta = diff.latencyP50Delta >= 0 ? `+${Math.round(diff.latencyP50Delta)}` : `${Math.round(diff.latencyP50Delta)}`;
  lines.push(`Latency p50              ${baseLatency}ms       ${curLatency}ms      ${latencyDelta}ms`);

  if (diff.perCategory.length > 0) {
    lines.push('');
    lines.push('Per-category:');
    for (const c of diff.perCategory) {
      const flag = c.regressed ? '  ⚠ REGRESSION' : '';
      lines.push(`  ${c.category.padEnd(22)} ${fmt(c.baselineMrr, 2)}→${fmt(c.currentMrr, 2)}   ${fmtDelta(c.delta)}${flag}`);
    }
  }

  if (diff.perQueryRegressions.length > 0) {
    lines.push('');
    lines.push('Per-query regressions (>10% MRR drop):');
    for (const q of diff.perQueryRegressions) {
      lines.push(`  ${q.query.padEnd(40)} ${fmt(q.baselineMrr, 2)}→${fmt(q.currentMrr, 2)}   ⚠`);
    }
  }

  lines.push('');
  if (diff.hasRegression) {
    lines.push(`Exit: 1 (per-category MRR drop > threshold)`);
  } else {
    lines.push(`Exit: 0 (no regression detected)`);
  }

  return lines;
}
