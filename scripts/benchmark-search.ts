#!/usr/bin/env npx tsx
/**
 * Benchmark: Search Relevance, Latency & Analysis
 *
 * Comprehensive benchmark suite for CodeGraph v5 capabilities:
 *   - Search: 6 strategies (HYBRID, VECTOR, NL_TO_CYPHER, GRAPH_ANSWER, SMART_SEARCH, CONTEXT_WALK)
 *   - Analysis: impact, security, complexity, dataflow, refactoring
 *   - Persona tools: end-to-end persona tool routing
 *
 * Requires FalkorDB running locally and a Cerebras API key in .env.
 *
 * Usage:
 *   pnpm build && npx tsx scripts/benchmark-search.ts [label] [--reindex] [--no-llm] [--fast-only] [--embeddings] [--analysis]
 *
 * Flags:
 *   --reindex      Re-index the codebase before running
 *   --no-llm       Skip LLM-dependent strategies (HYBRID only)
 *   --fast-only    Use the fast model for ALL strategies
 *   --embeddings   Enable vector search via local embeddings (nomic-embed-text-v1.5)
 *   --analysis     Include analysis benchmarks (impact, security, complexity, dataflow)
 */

const { getGraphClient, closeGraphClient, indexProject, createDefaultSearchRegistry, codeGraphService, registerPlugins } =
  await import('../packages/core/dist/index.js');
const { createOperations } = await import('../packages/graph/dist/index.js');
const { getLLMModel, getLLMComplexModel, isLLMAvailable, warmupLLM, getLLMConfigResolved, warmupEmbedding } =
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
const useEmbeddings = args.includes('--embeddings');
const runAnalysis = args.includes('--analysis');
const label = args.filter(a => !a.startsWith('--'))[0] ?? 'unlabeled';

// Embedding config for vector search (local nomic-embed-text-v1.5, 768d)
const embeddingConfig = useEmbeddings ? { provider: 'local' as const } : undefined;

// ============================================================================
// Golden test suite — 30 queries with expected results
// ============================================================================

interface TestCase {
  query: string;
  strategy: SearchType;
  expectedNames: string[];
  description: string;
  /** Category for grouping in reports */
  category: 'symbol-lookup' | 'keyword' | 'structural' | 'question' | 'exploration' | 'routing';
}

const TEST_CASES: TestCase[] = [
  // ─── HYBRID: Symbol lookups (exact name match) ───
  {
    query: 'hybridSearch',
    strategy: 'HYBRID',
    expectedNames: ['hybridSearch'],
    description: 'Direct function name lookup',
    category: 'symbol-lookup',
  },
  {
    query: 'indexProject',
    strategy: 'HYBRID',
    expectedNames: ['indexProject'],
    description: 'Core indexer function',
    category: 'symbol-lookup',
  },
  {
    query: 'SearchRegistry',
    strategy: 'HYBRID',
    expectedNames: ['SearchRegistry'],
    description: 'Class name lookup',
    category: 'symbol-lookup',
  },
  {
    query: 'createClient',
    strategy: 'HYBRID',
    expectedNames: ['createClient'],
    description: 'Graph client factory',
    category: 'symbol-lookup',
  },
  {
    query: 'registerPlugins',
    strategy: 'HYBRID',
    expectedNames: ['registerPlugins'],
    description: 'Plugin registration function',
    category: 'symbol-lookup',
  },
  {
    query: 'parseCode',
    strategy: 'HYBRID',
    expectedNames: ['parseCode'],
    description: 'Parser entry point',
    category: 'symbol-lookup',
  },
  {
    query: 'createLanguagePlugin',
    strategy: 'HYBRID',
    expectedNames: ['createLanguagePlugin'],
    description: 'Generic plugin factory',
    category: 'symbol-lookup',
  },
  {
    query: 'FalkorDBDriver',
    strategy: 'HYBRID',
    expectedNames: ['FalkorDBDriver'],
    description: 'Database driver class',
    category: 'symbol-lookup',
  },

  // ─── HYBRID: Keyword search (broader matches) ───
  {
    query: 'embedding',
    strategy: 'HYBRID',
    expectedNames: ['generateEmbedding', 'embedding'],
    description: 'Keyword: embedding-related symbols',
    category: 'keyword',
  },
  {
    query: 'vulnerability',
    strategy: 'HYBRID',
    expectedNames: ['vulnerabilities', 'Vulnerability'],
    description: 'Keyword: security-related symbols',
    category: 'keyword',
  },
  {
    query: 'refactoring',
    strategy: 'HYBRID',
    expectedNames: ['analyzeRefactoring', 'refactoring'],
    description: 'Keyword: refactoring-related symbols',
    category: 'keyword',
  },
  {
    query: 'knowledge graph',
    strategy: 'HYBRID',
    expectedNames: ['graph', 'GraphClient'],
    description: 'Keyword: knowledge graph symbols',
    category: 'keyword',
  },

  // ─── NL_TO_CYPHER: Structural graph queries ───
  {
    query: 'Show me all functions that call hybridSearch',
    strategy: 'NL_TO_CYPHER',
    expectedNames: ['search', 'hybridSearch'],
    description: 'Callers of hybridSearch',
    category: 'structural',
  },
  {
    query: 'Find files that contain functions calling hybridSearch',
    strategy: 'NL_TO_CYPHER',
    expectedNames: ['graphAnswer', 'contextWalk', 'hybrid', 'search'],
    description: 'Files with hybridSearch callers',
    category: 'structural',
  },
  {
    query: 'List all classes that have more than 5 methods',
    strategy: 'NL_TO_CYPHER',
    expectedNames: [],
    description: 'Classes by method count',
    category: 'structural',
  },
  {
    query: 'Find all functions in the file client.ts',
    strategy: 'NL_TO_CYPHER',
    expectedNames: ['createClient', 'getGraphClient', 'closeGraphClient', 'close', 'query', 'Knowledge', 'constructor', 'config', 'dialect', 'ensure'],
    description: 'Functions in specific file',
    category: 'structural',
  },
  {
    query: 'Show me functions that import from @codegraph/graph',
    strategy: 'NL_TO_CYPHER',
    expectedNames: [],
    description: 'Import dependency query',
    category: 'structural',
  },

  // ─── SMART_SEARCH: Auto-routing ───
  {
    query: 'parseCode',
    strategy: 'SMART_SEARCH',
    expectedNames: ['parseCode'],
    description: 'Simple symbol → HYBRID',
    category: 'routing',
  },
  {
    query: 'List all functions that call indexProject',
    strategy: 'SMART_SEARCH',
    expectedNames: ['syncConfigToGraph'],
    description: 'Structural → NL_TO_CYPHER',
    category: 'routing',
  },
  {
    query: 'What does the search registry do?',
    strategy: 'SMART_SEARCH',
    expectedNames: ['SearchRegistry', 'search'],
    description: 'Question → GRAPH_ANSWER',
    category: 'routing',
  },
  {
    query: 'FalkorDBDriver',
    strategy: 'SMART_SEARCH',
    expectedNames: ['FalkorDBDriver'],
    description: 'Class name → HYBRID',
    category: 'routing',
  },

  // ─── GRAPH_ANSWER: Question answering ───
  {
    query: 'What does the hybridSearch function do?',
    strategy: 'GRAPH_ANSWER',
    expectedNames: ['hybridSearch', 'Search'],
    description: 'Function explanation',
    category: 'question',
  },
  {
    query: 'How does the plugin registration system work?',
    strategy: 'GRAPH_ANSWER',
    expectedNames: ['Plugin', 'register', 'language'],
    description: 'System architecture question',
    category: 'question',
  },
  {
    query: 'What search strategies are available?',
    strategy: 'GRAPH_ANSWER',
    expectedNames: ['search', 'strategy'],
    description: 'Feature enumeration question',
    category: 'question',
  },

  // ─── CONTEXT_WALK: Multi-hop exploration ───
  {
    query: 'How does a search query flow from the registry to the graph database?',
    strategy: 'CONTEXT_WALK',
    expectedNames: ['search', 'registry', 'query', 'graph', 'client'],
    description: 'Multi-hop flow analysis',
    category: 'exploration',
  },
  {
    query: 'Trace the code path from parsing a file to storing entities in the graph',
    strategy: 'CONTEXT_WALK',
    expectedNames: ['parse', 'build', 'entity', 'file', 'index', 'Code', 'Graph', 'Service'],
    description: 'Parse-to-store pipeline',
    category: 'exploration',
  },
];

// ============================================================================
// Analysis benchmark cases
// ============================================================================

interface AnalysisBenchCase {
  name: string;
  description: string;
  run: () => Promise<{ success: boolean; resultCount: number; details?: string }>;
}

function getAnalysisCases(): AnalysisBenchCase[] {
  return [
    {
      name: 'complexity-hotspots',
      description: 'Get complexity hotspots across codebase',
      run: async () => {
        const result = await codeGraphService.getComplexityHotspots({ limit: 20 });
        return {
          success: Array.isArray(result.hotspots),
          resultCount: result.hotspots?.length ?? 0,
          details: `top: ${result.hotspots?.[0]?.name ?? 'none'}`,
        };
      },
    },
    {
      name: 'impact-analysis',
      description: 'Analyze impact of changing createClient',
      run: async () => {
        const result = await codeGraphService.analyzeImpact('createClient');
        return {
          success: !result.error,
          resultCount: result.affectedSymbols?.length ?? 0,
          details: `risk: ${result.riskLevel ?? 'unknown'}`,
        };
      },
    },
    {
      name: 'security-scan',
      description: 'Scan for security vulnerabilities',
      run: async () => {
        const result = await codeGraphService.scanVulnerabilities();
        return {
          success: Array.isArray(result.vulnerabilities),
          resultCount: result.vulnerabilities?.length ?? 0,
        };
      },
    },
    {
      name: 'dataflow-analysis',
      description: 'Trace dataflow in service.ts',
      run: async () => {
        const file = resolve(ROOT, 'packages/core/src/service.ts');
        const result = await codeGraphService.analyzeDataflowForFile(file, 'config');
        return {
          success: Array.isArray(result.paths),
          resultCount: result.paths?.length ?? 0,
          details: `vulns: ${result.vulnerabilities?.length ?? 0}`,
        };
      },
    },
    {
      name: 'refactoring-analysis',
      description: 'Find refactoring opportunities in service.ts',
      run: async () => {
        const file = resolve(ROOT, 'packages/core/src/service.ts');
        const result = await codeGraphService.analyzeRefactoring(file);
        return {
          success: !result.error,
          resultCount: result.candidates?.length ?? 0,
        };
      },
    },
  ];
}

// ============================================================================
// Metrics calculation
// ============================================================================

interface QueryResult {
  testCase: TestCase;
  latencyMs: number;
  resultNames: string[];
  recall: number;
  precision: number;
  totalResults: number;
  routedTo?: SearchType;
  hasAnswer?: boolean;
  error?: string;
}

function calculateRecall(expected: string[], actual: string[]): number {
  if (expected.length === 0) return 1.0;
  const actualLower = actual.filter(n => n != null).map(n => n.toLowerCase());
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
  const filtered = actual.filter(n => n != null);
  if (filtered.length === 0) return 0;
  if (expected.length === 0) return 0; // can't measure precision without expected
  const expectedLower = expected.map(n => n.toLowerCase());
  let relevant = 0;
  for (const act of filtered) {
    const actLower = act.toLowerCase();
    if (expectedLower.some(e => actLower.includes(e) || e.includes(actLower))) {
      relevant++;
    }
  }
  return relevant / filtered.length;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)] ?? 0;
}

// ============================================================================
// Main benchmark
// ============================================================================

async function main() {
  console.log(`\n${'═'.repeat(90)}`);
  console.log(`  CodeGraph v5 Benchmark Suite: ${label}`);
  console.log(`${'═'.repeat(90)}`);
  console.log(`  Time: ${new Date().toISOString()}`);
  console.log(`  LLM: ${noLlm ? 'disabled' : fastOnly ? 'fast-only (Cerebras for all)' : 'enabled (two-tier)'}`);
  console.log(`  Embeddings: ${useEmbeddings ? 'enabled (local)' : 'disabled'}`);
  console.log(`  Analysis: ${runAnalysis ? 'enabled' : 'disabled (use --analysis)'}`);
  console.log(`  Reindex: ${reindex}\n`);

  // Register plugins for analysis
  registerPlugins();

  // Step 1: Connect and optionally reindex
  const client = await getGraphClient();
  const ops = createOperations(client);

  if (reindex) {
    console.log('Re-indexing codebase...');
    const indexStart = Date.now();
    const result = await indexProject(ROOT, {
      client,
      deepAnalysis: true,
      embeddings: embeddingConfig ?? false,
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
  console.log(`Graph: ${nodeCount} nodes\n`);

  // Step 2: Set up search context
  const registry = createDefaultSearchRegistry();
  const context: SearchContext = { client };

  if (!noLlm && isLLMAvailable()) {
    console.log('Warming up LLM...');
    await warmupLLM();
    context.llm = await getLLMModel();

    if (fastOnly) {
      context.complexLlm = context.llm;
      console.log('LLM ready (fast-only mode: Cerebras for all strategies)');
    } else {
      const complexModel = await getLLMComplexModel();
      if (complexModel) context.complexLlm = complexModel;
      const cfg = getLLMConfigResolved();
      const tierInfo = cfg.complexProvider
        ? `two-tier: ${cfg.provider}/${cfg.model} + ${cfg.complexProvider}/${cfg.complexModel}`
        : `single-tier: ${cfg.provider}/${cfg.model}`;
      console.log(`LLM ready (${tierInfo})`);
    }
  } else if (!noLlm) {
    console.log('WARNING: No LLM available — LLM-dependent strategies will be skipped');
  }

  if (useEmbeddings) {
    console.log('Warming up embedding model...');
    await warmupEmbedding(embeddingConfig);
    context.embeddings = embeddingConfig;
    console.log('Embeddings ready (local nomic-embed-text-v1.5, 768d)');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SEARCH BENCHMARKS
  // ══════════════════════════════════════════════════════════════════════════

  console.log(`\n${'═'.repeat(90)}`);
  console.log('  SEARCH BENCHMARKS');
  console.log(`${'═'.repeat(90)}\n`);

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

  console.log(`Running ${runnableCases.length}/${TEST_CASES.length} search test cases...\n`);
  console.log('─'.repeat(95));
  console.log(
    `${'Strategy'.padEnd(22)} ${'Query'.padEnd(38)} ${'Latency'.padStart(8)} ${'Recall'.padStart(8)} ${'Prec'.padStart(8)} ${'Hits'.padStart(5)} ${'Cat'.padStart(10)}`
  );
  console.log('─'.repeat(95));

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
        `${tc.strategy.padEnd(22)} ${tc.description.slice(0, 38).padEnd(38)} ${(latency + 'ms').padStart(8)} ${'ERR'.padStart(8)} ${'ERR'.padStart(8)} ${'0'.padStart(5)} ${tc.category.padStart(10)}`
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
    const precStr = tc.expectedNames.length > 0 ? (precision * 100).toFixed(0) + '%' : 'n/a';
    const stratLabel = qr.routedTo ? `${tc.strategy}→${qr.routedTo}` : tc.strategy;

    console.log(
      `${stratLabel.padEnd(22)} ${tc.description.slice(0, 38).padEnd(38)} ${(latency + 'ms').padStart(8)} ${recallStr.padStart(8)} ${precStr.padStart(8)} ${String(response.total).padStart(5)} ${tc.category.padStart(10)}`
    );
  }

  console.log('─'.repeat(95));

  // ── Search summary by strategy ──
  const byStrategy = new Map<string, QueryResult[]>();
  for (const r of results) {
    const key = r.testCase.strategy;
    if (!byStrategy.has(key)) byStrategy.set(key, []);
    byStrategy.get(key)!.push(r);
  }

  console.log('\n=== Search Summary by Strategy ===\n');
  console.log(`${'Strategy'.padEnd(18)} ${'Queries'.padStart(8)} ${'Avg Lat'.padStart(10)} ${'P50 Lat'.padStart(10)} ${'P95 Lat'.padStart(10)} ${'Avg Recall'.padStart(11)} ${'Avg Prec'.padStart(11)}`);
  console.log('─'.repeat(85));

  let totalLatency = 0;
  let totalRecall = 0;
  let totalPrecision = 0;
  let totalQueries = 0;
  let precisionCount = 0;

  for (const [strategy, qrs] of byStrategy) {
    const latencies = qrs.map(r => r.latencyMs).sort((a, b) => a - b);
    const avgLat = latencies.reduce((s, v) => s + v, 0) / latencies.length;
    const p50 = percentile(latencies, 0.5);
    const p95 = percentile(latencies, 0.95);
    const avgRecall = qrs.reduce((s, r) => s + r.recall, 0) / qrs.length;
    const withExpected = qrs.filter(r => r.testCase.expectedNames.length > 0);
    const avgPrec = withExpected.length > 0 ? withExpected.reduce((s, r) => s + r.precision, 0) / withExpected.length : 0;

    totalLatency += latencies.reduce((s, v) => s + v, 0);
    totalRecall += qrs.reduce((s, r) => s + r.recall, 0);
    totalPrecision += withExpected.reduce((s, r) => s + r.precision, 0);
    totalQueries += qrs.length;
    precisionCount += withExpected.length;

    console.log(
      `${strategy.padEnd(18)} ${String(qrs.length).padStart(8)} ${(avgLat.toFixed(0) + 'ms').padStart(10)} ${(p50 + 'ms').padStart(10)} ${(p95 + 'ms').padStart(10)} ${((avgRecall * 100).toFixed(1) + '%').padStart(11)} ${((avgPrec * 100).toFixed(1) + '%').padStart(11)}`
    );
  }

  console.log('─'.repeat(85));

  const overallAvgLat = totalQueries > 0 ? totalLatency / totalQueries : 0;
  const overallRecall = totalQueries > 0 ? totalRecall / totalQueries : 0;
  const overallPrec = precisionCount > 0 ? totalPrecision / precisionCount : 0;

  console.log(
    `${'OVERALL'.padEnd(18)} ${String(totalQueries).padStart(8)} ${(overallAvgLat.toFixed(0) + 'ms').padStart(10)} ${''.padStart(10)} ${''.padStart(10)} ${((overallRecall * 100).toFixed(1) + '%').padStart(11)} ${((overallPrec * 100).toFixed(1) + '%').padStart(11)}`
  );

  // ── Search summary by category ──
  const byCategory = new Map<string, QueryResult[]>();
  for (const r of results) {
    const cat = r.testCase.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(r);
  }

  console.log('\n=== Search Summary by Category ===\n');
  console.log(`${'Category'.padEnd(18)} ${'Queries'.padStart(8)} ${'Avg Lat'.padStart(10)} ${'Avg Recall'.padStart(11)}`);
  console.log('─'.repeat(50));

  for (const [cat, qrs] of byCategory) {
    const avgLat = qrs.reduce((s, r) => s + r.latencyMs, 0) / qrs.length;
    const avgRecall = qrs.reduce((s, r) => s + r.recall, 0) / qrs.length;
    console.log(
      `${cat.padEnd(18)} ${String(qrs.length).padStart(8)} ${(avgLat.toFixed(0) + 'ms').padStart(10)} ${((avgRecall * 100).toFixed(1) + '%').padStart(11)}`
    );
  }

  if (skippedStrategies.size > 0) {
    console.log(`\nSkipped strategies (no LLM): ${[...skippedStrategies].join(', ')}`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ANALYSIS BENCHMARKS
  // ══════════════════════════════════════════════════════════════════════════

  const analysisResults: Array<{ name: string; latencyMs: number; success: boolean; resultCount: number; details?: string; error?: string }> = [];

  if (runAnalysis) {
    console.log(`\n${'═'.repeat(90)}`);
    console.log('  ANALYSIS BENCHMARKS');
    console.log(`${'═'.repeat(90)}\n`);

    const cases = getAnalysisCases();
    console.log(`Running ${cases.length} analysis benchmarks...\n`);
    console.log('─'.repeat(80));
    console.log(
      `${'Analysis'.padEnd(25)} ${'Description'.padEnd(35)} ${'Latency'.padStart(8)} ${'Status'.padStart(8)} ${'Count'.padStart(6)}`
    );
    console.log('─'.repeat(80));

    for (const ac of cases) {
      const start = Date.now();
      try {
        const result = await ac.run();
        const latency = Date.now() - start;
        analysisResults.push({
          name: ac.name,
          latencyMs: latency,
          success: result.success,
          resultCount: result.resultCount,
          details: result.details,
        });
        console.log(
          `${ac.name.padEnd(25)} ${ac.description.slice(0, 35).padEnd(35)} ${(latency + 'ms').padStart(8)} ${(result.success ? 'OK' : 'FAIL').padStart(8)} ${String(result.resultCount).padStart(6)}${result.details ? `  ${result.details}` : ''}`
        );
      } catch (err) {
        const latency = Date.now() - start;
        const error = err instanceof Error ? err.message : String(err);
        analysisResults.push({
          name: ac.name,
          latencyMs: latency,
          success: false,
          resultCount: 0,
          error,
        });
        console.log(
          `${ac.name.padEnd(25)} ${ac.description.slice(0, 35).padEnd(35)} ${(latency + 'ms').padStart(8)} ${'ERR'.padStart(8)} ${'0'.padStart(6)}  ${error.slice(0, 40)}`
        );
      }
    }

    console.log('─'.repeat(80));

    const avgAnalysisLat = analysisResults.reduce((s, r) => s + r.latencyMs, 0) / analysisResults.length;
    const passCount = analysisResults.filter(r => r.success).length;
    console.log(`\nAnalysis: ${passCount}/${analysisResults.length} passed, avg latency ${avgAnalysisLat.toFixed(0)}ms`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FINAL SUMMARY
  // ══════════════════════════════════════════════════════════════════════════

  console.log(`\n${'═'.repeat(90)}`);
  console.log('  FINAL SUMMARY');
  console.log(`${'═'.repeat(90)}\n`);

  const allLatencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
  const p50All = percentile(allLatencies, 0.5);
  const p95All = percentile(allLatencies, 0.95);

  console.log(`  Search queries:    ${totalQueries} (${TEST_CASES.length - runnableCases.length} skipped)`);
  console.log(`  Avg recall:        ${(overallRecall * 100).toFixed(1)}%`);
  console.log(`  Avg precision:     ${(overallPrec * 100).toFixed(1)}%`);
  console.log(`  Avg latency:       ${overallAvgLat.toFixed(0)}ms (P50: ${p50All}ms, P95: ${p95All}ms)`);

  if (runAnalysis) {
    const passCount = analysisResults.filter(r => r.success).length;
    const avgAnalysisLat = analysisResults.reduce((s, r) => s + r.latencyMs, 0) / analysisResults.length;
    console.log(`  Analysis:          ${passCount}/${analysisResults.length} passed, avg ${avgAnalysisLat.toFixed(0)}ms`);
  }

  // Failure details
  const failures = results.filter(r => r.recall === 0 && r.testCase.expectedNames.length > 0);
  if (failures.length > 0) {
    console.log(`\n  Failures (0% recall):`);
    for (const f of failures) {
      console.log(`    - ${f.testCase.strategy}: "${f.testCase.query}" (expected: ${f.testCase.expectedNames.join(', ')})`);
    }
  }

  // Machine-readable summary
  console.log(`\n[BENCHMARK] ${label} | queries=${totalQueries} | avg_latency_ms=${overallAvgLat.toFixed(0)} | p50_ms=${p50All} | p95_ms=${p95All} | avg_recall=${(overallRecall * 100).toFixed(1)}% | avg_precision=${(overallPrec * 100).toFixed(1)}% | skipped=${TEST_CASES.length - runnableCases.length}${runAnalysis ? ` | analysis=${analysisResults.filter(r => r.success).length}/${analysisResults.length}` : ''}`);

  await closeGraphClient();
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
