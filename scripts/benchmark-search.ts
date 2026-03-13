#!/usr/bin/env npx tsx
/**
 * Benchmark: Search Relevance & Latency
 *
 * Indexes the codegraph codebase (if not already), then runs a suite of
 * queries across search strategies, measuring latency, recall, and precision.
 *
 * Requires FalkorDB running locally and an LLM API key in .env.
 *
 * Usage:
 *   pnpm build && npx tsx scripts/benchmark-search.ts [label] [--reindex] [--no-llm] [--fast-only]
 *
 * Flags:
 *   --reindex    Re-index the codebase before running
 *   --no-llm     Skip LLM-dependent strategies (HYBRID only)
 *   --fast-only  Use the fast model for ALL strategies, including
 *                GRAPH_ANSWER and CONTEXT_WALK that normally use the complex model.
 *                Useful for measuring latency reduction vs quality tradeoff.
 */

const { getGraphClient, closeGraphClient, indexProject, createDefaultSearchRegistry } =
  await import('../packages/core/dist/index.js');
const { createOperations } = await import('../packages/graph/dist/index.js');
const { getLLMModel, getLLMComplexModel, isLLMAvailable, warmupLLM, getLLMConfigResolved } =
  await import('../packages/plugin-nlp/dist/index.js');
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
// Types for reference (actual values come from dynamic imports)
type SearchType = 'VECTOR' | 'HYBRID' | 'GRAPH_ANSWER' | 'NL_TO_CYPHER' | 'SMART_SEARCH' | 'CONTEXT_WALK';
interface SearchContext { client: any; llm?: any; complexLlm?: any; embeddings?: any; }
interface SearchResponse { results: Array<{ name: string; nodeType: string; score: number; sources: string[] }>; total: number; meta: { searchType: string; durationMs: number; [key: string]: unknown }; answer?: string; routedTo?: SearchType; error?: string; }

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Load .env
const envPath = resolve(ROOT, '.env');
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

// Parse args
const args = process.argv.slice(2);
const reindex = args.includes('--reindex');
const noLlm = args.includes('--no-llm');
const fastOnly = args.includes('--fast-only');
const label = args.filter(a => !a.startsWith('--'))[0] ?? 'unlabeled';

// ============================================================================
// Golden test suite — queries with expected results
// ============================================================================

interface TestCase {
  /** Query to execute */
  query: string;
  /** Strategy to test */
  strategy: SearchType;
  /** Expected result names (partial match via includes) */
  expectedNames: string[];
  /** Description for reporting */
  description: string;
}

const TEST_CASES: TestCase[] = [
  // --- HYBRID: Symbol lookup ---
  {
    query: 'hybridSearch',
    strategy: 'HYBRID',
    expectedNames: ['hybridSearch'],
    description: 'Direct function name lookup',
  },
  {
    query: 'indexProject',
    strategy: 'HYBRID',
    expectedNames: ['indexProject'],
    description: 'Core indexer function lookup',
  },
  {
    query: 'SearchRegistry',
    strategy: 'HYBRID',
    expectedNames: ['SearchRegistry'],
    description: 'Class name lookup',
  },
  {
    query: 'embedding',
    strategy: 'HYBRID',
    expectedNames: ['generateEmbedding', 'embedding'],
    description: 'Keyword search for embedding-related symbols',
  },

  // --- NL_TO_CYPHER: Structural queries ---
  {
    query: 'Show me all functions that call hybridSearch',
    strategy: 'NL_TO_CYPHER',
    expectedNames: ['search', 'hybridSearch'],
    description: 'Graph traversal — callers of hybridSearch',
  },
  {
    query: 'Find all classes in the search module',
    strategy: 'NL_TO_CYPHER',
    expectedNames: ['SearchRegistry', 'Strategy'],
    description: 'Graph query — classes in search',
  },
  {
    query: 'Find files that contain functions calling hybridSearch',
    strategy: 'NL_TO_CYPHER',
    expectedNames: ['graphAnswer', 'contextWalk', 'hybrid'],
    description: 'Files with callers of hybridSearch',
  },

  // --- SMART_SEARCH: Auto-routing ---
  {
    query: 'parseCode',
    strategy: 'SMART_SEARCH',
    expectedNames: ['parseCode'],
    description: 'Simple symbol → should route to HYBRID',
  },
  {
    query: 'List all functions that call indexProject',
    strategy: 'SMART_SEARCH',
    expectedNames: ['syncConfigToGraph'],
    description: 'Structural query → should route to NL_TO_CYPHER',
  },

  // --- GRAPH_ANSWER: Question answering ---
  {
    query: 'What does the hybridSearch function do?',
    strategy: 'GRAPH_ANSWER',
    expectedNames: ['hybridSearch'],
    description: 'Question about a specific function',
  },

  // --- CONTEXT_WALK: Multi-hop exploration ---
  {
    query: 'How does a search query flow from the registry to the graph database?',
    strategy: 'CONTEXT_WALK',
    expectedNames: ['SearchRegistry', 'search', 'client'],
    description: 'Multi-hop flow analysis',
  },
];

// ============================================================================
// Metrics calculation
// ============================================================================

interface QueryResult {
  testCase: TestCase;
  latencyMs: number;
  resultNames: string[];
  recall: number;      // fraction of expected items found
  precision: number;   // fraction of returned items that were expected
  totalResults: number;
  routedTo?: SearchType;
  hasAnswer?: boolean;
  error?: string;
}

function calculateRecall(expected: string[], actual: string[]): number {
  if (expected.length === 0) return 1.0;
  const actualLower = actual.map(n => n.toLowerCase());
  let found = 0;
  for (const exp of expected) {
    const expLower = exp.toLowerCase();
    if (actualLower.some(a => a.includes(expLower) || expLower.includes(a))) {
      found++;
    }
  }
  return found / expected.length;
}

function calculatePrecision(expected: string[], actual: string[]): number {
  if (actual.length === 0) return 0;
  const expectedLower = expected.map(n => n.toLowerCase());
  let relevant = 0;
  for (const act of actual) {
    const actLower = act.toLowerCase();
    if (expectedLower.some(e => actLower.includes(e) || e.includes(actLower))) {
      relevant++;
    }
  }
  return relevant / actual.length;
}

// ============================================================================
// Main benchmark
// ============================================================================

async function main() {
  console.log(`\n=== Search Relevance Benchmark: ${label} ===`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`LLM: ${noLlm ? 'disabled' : fastOnly ? 'fast-only (Cerebras for all)' : 'enabled (two-tier)'}`);
  console.log(`Reindex: ${reindex}\n`);

  // Step 1: Connect and optionally reindex
  const client = await getGraphClient();
  const ops = createOperations(client);

  if (reindex) {
    console.log('Re-indexing codebase...');
    const indexStart = Date.now();
    const result = await indexProject(ROOT, {
      client,
      deepAnalysis: true,
      embeddings: false,
      force: false,
    });
    console.log(`Indexed ${result.stats.files} files, ${result.stats.entities} entities in ${Date.now() - indexStart}ms\n`);
  }

  // Verify index has data
  const countResult = await client.roQuery<{ cnt: number }>('MATCH (n) RETURN count(n) AS cnt');
  const nodeCount = countResult.data[0]?.cnt ?? 0;
  if (nodeCount === 0) {
    console.error('ERROR: Graph is empty. Run with --reindex or index first.');
    await closeGraphClient();
    process.exit(1);
  }
  console.log(`Graph has ${nodeCount} nodes\n`);

  // Step 2: Set up search context
  const registry = createDefaultSearchRegistry();
  const context: SearchContext = { client };

  if (!noLlm && isLLMAvailable()) {
    console.log('Warming up LLM...');
    await warmupLLM();
    context.llm = await getLLMModel();

    if (fastOnly) {
      // --fast-only: Use the fast model (Cerebras) for EVERYTHING, including
      // strategies that normally use the complex model (GRAPH_ANSWER, CONTEXT_WALK).
      // This lets us measure latency reduction vs quality tradeoff.
      context.complexLlm = context.llm;
      console.log('LLM ready (fast-only mode: Cerebras for all strategies)\n');
    } else {
      const complexModel = await getLLMComplexModel();
      if (complexModel) context.complexLlm = complexModel;
      const cfg = getLLMConfigResolved();
      const tierInfo = cfg.complexProvider
        ? `two-tier: ${cfg.provider}/${cfg.model} + ${cfg.complexProvider}/${cfg.complexModel}`
        : `single-tier: ${cfg.provider}/${cfg.model}`;
      console.log(`LLM ready (${tierInfo})\n`);
    }
  } else if (!noLlm) {
    console.log('WARNING: No LLM available — LLM-dependent strategies will be skipped\n');
  }

  // Note: Embeddings omitted from benchmark — text + graph search suffices
  // for relevance testing. Add embeddings config here if vector search
  // benchmarking is needed.

  // Step 3: Run test cases
  const results: QueryResult[] = [];
  const skippedStrategies = new Set<SearchType>();

  // Filter test cases based on available capabilities
  const runnableCases = TEST_CASES.filter(tc => {
    const strategy = registry.get(tc.strategy);
    if (!strategy) {
      skippedStrategies.add(tc.strategy);
      return false;
    }
    if (strategy.requiresLLM && !context.llm) {
      skippedStrategies.add(tc.strategy);
      return false;
    }
    return true;
  });

  console.log(`Running ${runnableCases.length} test cases (${TEST_CASES.length - runnableCases.length} skipped)...\n`);
  console.log('─'.repeat(90));
  console.log(
    `${'Strategy'.padEnd(15)} ${'Query'.padEnd(40)} ${'Latency'.padStart(8)} ${'Recall'.padStart(8)} ${'Prec'.padStart(8)} ${'Hits'.padStart(5)}`
  );
  console.log('─'.repeat(90));

  for (const tc of runnableCases) {
    const start = Date.now();
    let response: SearchResponse;
    let error: string | undefined;

    try {
      response = await registry.search(
        { query: tc.query, type: tc.strategy, limit: 20 },
        context,
      );
    } catch (err) {
      const latency = Date.now() - start;
      error = err instanceof Error ? err.message : String(err);
      results.push({
        testCase: tc,
        latencyMs: latency,
        resultNames: [],
        recall: 0,
        precision: 0,
        totalResults: 0,
        error,
      });
      console.log(
        `${tc.strategy.padEnd(15)} ${tc.description.slice(0, 40).padEnd(40)} ${(latency + 'ms').padStart(8)} ${'ERR'.padStart(8)} ${'ERR'.padStart(8)} ${'0'.padStart(5)}`
      );
      continue;
    }

    const latency = Date.now() - start;
    const resultNames = response.results.map(r => r.name);
    const recall = calculateRecall(tc.expectedNames, resultNames);
    const precision = calculatePrecision(tc.expectedNames, resultNames);

    const qr: QueryResult = {
      testCase: tc,
      latencyMs: latency,
      resultNames,
      recall,
      precision,
      totalResults: response.total,
      routedTo: response.routedTo,
      hasAnswer: !!response.answer,
      error: response.error,
    };
    results.push(qr);

    const recallStr = (recall * 100).toFixed(0) + '%';
    const precStr = (precision * 100).toFixed(0) + '%';
    const stratLabel = qr.routedTo ? `${tc.strategy}→${qr.routedTo}` : tc.strategy;

    console.log(
      `${stratLabel.padEnd(15)} ${tc.description.slice(0, 40).padEnd(40)} ${(latency + 'ms').padStart(8)} ${recallStr.padStart(8)} ${precStr.padStart(8)} ${String(response.total).padStart(5)}`
    );
  }

  console.log('─'.repeat(90));

  // Step 4: Aggregate metrics
  const byStrategy = new Map<string, QueryResult[]>();
  for (const r of results) {
    const key = r.testCase.strategy;
    if (!byStrategy.has(key)) byStrategy.set(key, []);
    byStrategy.get(key)!.push(r);
  }

  console.log('\n=== Summary by Strategy ===\n');
  console.log(`${'Strategy'.padEnd(15)} ${'Queries'.padStart(8)} ${'Avg Lat'.padStart(10)} ${'P50 Lat'.padStart(10)} ${'P95 Lat'.padStart(10)} ${'Avg Recall'.padStart(11)} ${'Avg Prec'.padStart(11)}`);
  console.log('─'.repeat(80));

  let totalLatency = 0;
  let totalRecall = 0;
  let totalPrecision = 0;
  let totalQueries = 0;

  for (const [strategy, qrs] of byStrategy) {
    const latencies = qrs.map(r => r.latencyMs).sort((a, b) => a - b);
    const avgLat = latencies.reduce((s, v) => s + v, 0) / latencies.length;
    const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? latencies[latencies.length - 1] ?? 0;
    const avgRecall = qrs.reduce((s, r) => s + r.recall, 0) / qrs.length;
    const avgPrec = qrs.reduce((s, r) => s + r.precision, 0) / qrs.length;

    totalLatency += latencies.reduce((s, v) => s + v, 0);
    totalRecall += qrs.reduce((s, r) => s + r.recall, 0);
    totalPrecision += qrs.reduce((s, r) => s + r.precision, 0);
    totalQueries += qrs.length;

    console.log(
      `${strategy.padEnd(15)} ${String(qrs.length).padStart(8)} ${(avgLat.toFixed(0) + 'ms').padStart(10)} ${(p50 + 'ms').padStart(10)} ${(p95 + 'ms').padStart(10)} ${((avgRecall * 100).toFixed(1) + '%').padStart(11)} ${((avgPrec * 100).toFixed(1) + '%').padStart(11)}`
    );
  }

  console.log('─'.repeat(80));

  const overallAvgLat = totalQueries > 0 ? totalLatency / totalQueries : 0;
  const overallRecall = totalQueries > 0 ? totalRecall / totalQueries : 0;
  const overallPrec = totalQueries > 0 ? totalPrecision / totalQueries : 0;

  console.log(
    `${'OVERALL'.padEnd(15)} ${String(totalQueries).padStart(8)} ${(overallAvgLat.toFixed(0) + 'ms').padStart(10)} ${''.padStart(10)} ${''.padStart(10)} ${((overallRecall * 100).toFixed(1) + '%').padStart(11)} ${((overallPrec * 100).toFixed(1) + '%').padStart(11)}`
  );

  if (skippedStrategies.size > 0) {
    console.log(`\nSkipped strategies (no LLM): ${[...skippedStrategies].join(', ')}`);
  }

  // Machine-readable summary
  const allLatencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
  const p50All = allLatencies[Math.floor(allLatencies.length * 0.5)] ?? 0;
  const p95All = allLatencies[Math.floor(allLatencies.length * 0.95)] ?? allLatencies[allLatencies.length - 1] ?? 0;

  console.log(`\n[BENCHMARK] ${label} | queries=${totalQueries} | avg_latency_ms=${overallAvgLat.toFixed(0)} | p50_ms=${p50All} | p95_ms=${p95All} | avg_recall=${(overallRecall * 100).toFixed(1)}% | avg_precision=${(overallPrec * 100).toFixed(1)}% | skipped=${TEST_CASES.length - runnableCases.length}`);

  await closeGraphClient();
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
