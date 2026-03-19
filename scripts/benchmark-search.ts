#!/usr/bin/env npx tsx
/**
 * Benchmark: Search Relevance Stress Test
 *
 * Stress-tests HYBRID vs ENRICHED search with ranking-sensitive metrics
 * (MRR, NDCG@5, NDCG@10) on hard queries designed to discriminate between
 * basic search and enrichment-augmented search.
 *
 * Query categories (from code search literature — CodeSearchNet, CoIR, CoSQA+):
 *   1. Disambiguation: ambiguous terms with many matches, importance should break ties
 *   2. Importance-sensitive: "main", "primary", "most used" — need fan-in/centrality
 *   3. Recency-sensitive: "recent changes", "current implementation"
 *   4. Quality-sensitive: prefer documented, exported, tested code over internals
 *   5. Semantic gap: NL intent doesn't match symbol names
 *   6. Cross-cutting: concepts spanning multiple packages
 *   7. Needle-in-haystack: one correct result among many false positives
 *
 * Metrics (per CoIR/CodeSearchNet best practices):
 *   - MRR (Mean Reciprocal Rank): 1/rank of first relevant result
 *   - NDCG@K (Normalized Discounted Cumulative Gain): graded relevance, position-aware
 *   - Success@1, Success@5: was a relevant result in top 1/5?
 *   - Recall@10: what fraction of expected results in top 10?
 *
 * Usage:
 *   pnpm build && npx tsx scripts/benchmark-search.ts [label] [--reindex] [--no-llm] [--fast-only] [--no-embeddings] [--analysis]
 */

const { getGraphClient, closeGraphClient, indexProject, codeGraphService, enrichedSearchV2, hybridSearch, registerPlugins } =
  await import('../packages/core/dist/index.js');
const { createOperations } = await import('../packages/graph/dist/index.js');
const { getLLMModel, getLLMComplexModel, isLLMAvailable, warmupLLM, getLLMConfigResolved, warmupEmbedding } =
  await import('../packages/plugin-nlp/dist/index.js');
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
// Types for reference (actual values come from dynamic imports)
type SearchType = 'VECTOR' | 'HYBRID' | 'ENRICHED' | 'GRAPH_ANSWER' | 'NL_TO_CYPHER' | 'SMART_SEARCH' | 'CONTEXT_WALK';
interface SearchContext { client: any; llm?: any; complexLlm?: any; embeddings?: any; }
interface SearchResponse { results: Array<{ name: string; nodeType: string; score: number; sources: string[]; filePath?: string; properties?: Record<string, unknown> }>; total: number; meta: { searchType: string; durationMs: number; [key: string]: unknown }; answer?: string; routedTo?: SearchType; error?: string; }

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
const noEmbeddings = args.includes('--no-embeddings');
const useEmbeddings = !noEmbeddings; // ON by default — embeddings are core functionality
const runAnalysis = args.includes('--analysis');
const label = args.filter(a => !a.startsWith('--'))[0] ?? 'unlabeled';

// Embedding config for vector search — uses .env provider (voyage-code-3 1024d by default)
// Enabled by default since nodes have embeddings — testing without them
// doesn't reflect how the system actually runs.
const embeddingProvider = (process.env['CODEGRAPH_EMBEDDING_PROVIDER'] ?? 'voyage') as 'local' | 'openrouter' | 'voyage';
const embeddingConfig = useEmbeddings ? { provider: embeddingProvider } : undefined;

// ============================================================================
// Hard test suite — graded relevance, ranking-sensitive
// ============================================================================

/**
 * Test case with graded relevance.
 * expectedResults is ORDERED by decreasing relevance (ideal ranking).
 * Each entry has a relevance grade: 3=perfect, 2=good, 1=acceptable, 0=irrelevant.
 * This enables NDCG computation.
 */
interface HardTestCase {
  query: string;
  /** Run against both HYBRID and ENRICHED for head-to-head */
  strategies: SearchType[];
  /** Ordered list of expected results with graded relevance */
  expectedResults: Array<{
    /** Substring to match against result name (case-insensitive) */
    namePattern: string;
    /** Relevance grade: 3=perfect, 2=good, 1=acceptable */
    relevance: 3 | 2 | 1;
    /** Why this is relevant (for debugging) */
    reason: string;
  }>;
  description: string;
  category: 'disambiguation' | 'importance' | 'recency' | 'quality' | 'semantic-gap' | 'cross-cutting' | 'needle-in-haystack';
}

/**
 * Test cases for search benchmark — verified 2026-03-18.
 *
 * Two query modes that reflect real AI agent usage:
 *   1. EXACT: Agent knows what it wants ("parseCode", "getGraphClient")
 *   2. EXPLORE: Agent is investigating ("how does indexing work", "graph connection")
 *
 * Every expectedResult symbol has been verified to exist in the codebase.
 * No hallucinated symbols. No essay-length queries.
 */
const HARD_CASES: HardTestCase[] = [
  // ═══════════════════════════════════════════════════════════════════
  // EXACT: Agent knows the symbol name or close to it
  // ═══════════════════════════════════════════════════════════════════
  {
    query: 'hybridSearch',
    strategies: ['HYBRID', 'ENRICHED', 'ENRICHED_V2', 'GRAPH_ANSWER', 'NL_TO_CYPHER', 'SMART_SEARCH', 'CONTEXT_WALK'],
    expectedResults: [
      { namePattern: 'hybridSearch', relevance: 3, reason: 'Exact match' },
    ],
    description: 'Exact: known function name',
    category: 'disambiguation',
  },
  {
    query: 'parseCode',
    strategies: ['HYBRID', 'ENRICHED', 'ENRICHED_V2', 'GRAPH_ANSWER', 'NL_TO_CYPHER', 'SMART_SEARCH', 'CONTEXT_WALK'],
    expectedResults: [
      { namePattern: 'parseCode', relevance: 3, reason: 'Exact match' },
    ],
    description: 'Exact: known function name',
    category: 'disambiguation',
  },
  {
    query: 'getGraphClient',
    strategies: ['HYBRID', 'ENRICHED', 'ENRICHED_V2', 'GRAPH_ANSWER', 'NL_TO_CYPHER', 'SMART_SEARCH', 'CONTEXT_WALK'],
    expectedResults: [
      { namePattern: 'getGraphClient', relevance: 3, reason: 'Exact match' },
    ],
    description: 'Exact: known function name',
    category: 'disambiguation',
  },
  {
    query: 'createOperations',
    strategies: ['HYBRID', 'ENRICHED', 'ENRICHED_V2', 'GRAPH_ANSWER', 'NL_TO_CYPHER', 'SMART_SEARCH', 'CONTEXT_WALK'],
    expectedResults: [
      { namePattern: 'createOperations', relevance: 3, reason: 'Exact match' },
    ],
    description: 'Exact: known factory function',
    category: 'disambiguation',
  },
  {
    query: 'generateEmbedding',
    strategies: ['HYBRID', 'ENRICHED', 'ENRICHED_V2', 'GRAPH_ANSWER', 'NL_TO_CYPHER', 'SMART_SEARCH', 'CONTEXT_WALK'],
    expectedResults: [
      { namePattern: 'generateEmbedding', relevance: 3, reason: 'Exact match' },
    ],
    description: 'Exact: known embedding function',
    category: 'disambiguation',
  },
  {
    query: 'rrfFuse',
    strategies: ['HYBRID', 'ENRICHED', 'ENRICHED_V2', 'GRAPH_ANSWER', 'NL_TO_CYPHER', 'SMART_SEARCH', 'CONTEXT_WALK'],
    expectedResults: [
      { namePattern: 'rrfFuse', relevance: 3, reason: 'Exact match' },
    ],
    description: 'Exact: known fusion function',
    category: 'disambiguation',
  },
  {
    query: 'indexProject',
    strategies: ['HYBRID', 'ENRICHED', 'ENRICHED_V2', 'GRAPH_ANSWER', 'NL_TO_CYPHER', 'SMART_SEARCH', 'CONTEXT_WALK'],
    expectedResults: [
      { namePattern: 'indexProject', relevance: 3, reason: 'Exact match' },
    ],
    description: 'Exact: known indexer function',
    category: 'disambiguation',
  },

  // ═══════════════════════════════════════════════════════════════════
  // PARTIAL: Agent knows roughly what it's called
  // ═══════════════════════════════════════════════════════════════════
  {
    query: 'complexity calculation',
    strategies: ['HYBRID', 'ENRICHED', 'ENRICHED_V2', 'GRAPH_ANSWER', 'NL_TO_CYPHER', 'SMART_SEARCH', 'CONTEXT_WALK'],
    expectedResults: [
      { namePattern: 'calculateComplexity', relevance: 3, reason: 'Primary complexity function' },
      { namePattern: 'calculateCyclomatic', relevance: 2, reason: 'Specific metric' },
      { namePattern: 'calculateCognitive', relevance: 2, reason: 'Specific metric' },
    ],
    description: 'Partial: concept maps to multiple functions',
    category: 'disambiguation',
  },
  {
    query: 'search strategy',
    strategies: ['HYBRID', 'ENRICHED', 'ENRICHED_V2', 'GRAPH_ANSWER', 'NL_TO_CYPHER', 'SMART_SEARCH', 'CONTEXT_WALK'],
    expectedResults: [
      { namePattern: 'SearchStrategy', relevance: 3, reason: 'Interface definition' },
      { namePattern: 'HybridSearchStrategy', relevance: 2, reason: 'Strategy implementation' },
      { namePattern: 'EnrichedSearchStrategy', relevance: 2, reason: 'Strategy implementation' },
    ],
    description: 'Partial: concept with multiple implementations',
    category: 'disambiguation',
  },
  {
    query: 'graph operations',
    strategies: ['HYBRID', 'ENRICHED', 'ENRICHED_V2', 'GRAPH_ANSWER', 'NL_TO_CYPHER', 'SMART_SEARCH', 'CONTEXT_WALK'],
    expectedResults: [
      { namePattern: 'GraphOperations', relevance: 3, reason: 'Interface' },
      { namePattern: 'createOperations', relevance: 3, reason: 'Factory' },
      { namePattern: 'createKnowledgeOperations', relevance: 2, reason: 'Related factory' },
    ],
    description: 'Partial: broad concept',
    category: 'disambiguation',
  },
  {
    query: 'knowledge operations',
    strategies: ['HYBRID', 'ENRICHED', 'ENRICHED_V2', 'GRAPH_ANSWER', 'NL_TO_CYPHER', 'SMART_SEARCH', 'CONTEXT_WALK'],
    expectedResults: [
      { namePattern: 'createKnowledgeOperations', relevance: 3, reason: 'Factory' },
      { namePattern: 'KnowledgeOperations', relevance: 3, reason: 'Interface' },
    ],
    description: 'Partial: specific subsystem',
    category: 'disambiguation',
  },

  // ═══════════════════════════════════════════════════════════════════
  // EXPLORE: Agent is investigating how something works
  // ═══════════════════════════════════════════════════════════════════
  {
    query: 'how does indexing work',
    strategies: ['HYBRID', 'ENRICHED', 'ENRICHED_V2', 'GRAPH_ANSWER', 'NL_TO_CYPHER', 'SMART_SEARCH', 'CONTEXT_WALK'],
    expectedResults: [
      { namePattern: 'indexProject', relevance: 3, reason: 'Main indexing entry point' },
      { namePattern: 'indexSingleFile', relevance: 2, reason: 'Single file indexing' },
      { namePattern: 'isProjectIndexed', relevance: 1, reason: 'Status check' },
    ],
    description: 'Explore: understanding the indexing pipeline',
    category: 'quality',
  },
  {
    query: 'graph database connection',
    strategies: ['HYBRID', 'ENRICHED', 'ENRICHED_V2', 'GRAPH_ANSWER', 'NL_TO_CYPHER', 'SMART_SEARCH', 'CONTEXT_WALK'],
    expectedResults: [
      { namePattern: 'getGraphClient', relevance: 3, reason: 'Gets the client connection' },
      { namePattern: 'GraphClient', relevance: 3, reason: 'Connection interface' },
      { namePattern: 'createClient', relevance: 2, reason: 'Creates a client' },
      { namePattern: 'closeGraphClient', relevance: 1, reason: 'Closes connection' },
    ],
    description: 'Explore: database connectivity',
    category: 'semantic-gap',
  },
  {
    query: 'embedding generation',
    strategies: ['HYBRID', 'ENRICHED', 'ENRICHED_V2', 'GRAPH_ANSWER', 'NL_TO_CYPHER', 'SMART_SEARCH', 'CONTEXT_WALK'],
    expectedResults: [
      { namePattern: 'generateEmbedding', relevance: 3, reason: 'Single embedding' },
      { namePattern: 'generateEmbeddings', relevance: 3, reason: 'Batch embeddings' },
      { namePattern: 'warmupEmbedding', relevance: 1, reason: 'Model warmup' },
    ],
    description: 'Explore: embedding pipeline',
    category: 'quality',
  },
  {
    query: 'git history sync',
    strategies: ['HYBRID', 'ENRICHED', 'ENRICHED_V2', 'GRAPH_ANSWER', 'NL_TO_CYPHER', 'SMART_SEARCH', 'CONTEXT_WALK'],
    expectedResults: [
      { namePattern: 'syncGitHistory', relevance: 3, reason: 'Main git sync function' },
      { namePattern: 'getRepoInfo', relevance: 2, reason: 'Repo metadata' },
    ],
    description: 'Explore: git integration',
    category: 'semantic-gap',
  },
  {
    query: 'logging setup',
    strategies: ['HYBRID', 'ENRICHED', 'ENRICHED_V2', 'GRAPH_ANSWER', 'NL_TO_CYPHER', 'SMART_SEARCH', 'CONTEXT_WALK'],
    expectedResults: [
      { namePattern: 'createLogger', relevance: 3, reason: 'Logger factory' },
      { namePattern: 'Logger', relevance: 2, reason: 'Logger interface' },
    ],
    description: 'Explore: logging infrastructure',
    category: 'quality',
  },
  {
    query: 'code parsing pipeline',
    strategies: ['HYBRID', 'ENRICHED', 'ENRICHED_V2', 'GRAPH_ANSWER', 'NL_TO_CYPHER', 'SMART_SEARCH', 'CONTEXT_WALK'],
    expectedResults: [
      { namePattern: 'parseCode', relevance: 3, reason: 'Parse source code' },
      { namePattern: 'parseFile', relevance: 3, reason: 'Parse a file' },
      { namePattern: 'parseFiles', relevance: 2, reason: 'Parse multiple files' },
      { namePattern: 'initParser', relevance: 1, reason: 'Parser initialization' },
    ],
    description: 'Explore: parsing system',
    category: 'quality',
  },
];

// ============================================================================
// Ranking metrics: MRR, NDCG@K, Success@K (per CodeSearchNet / CoIR)
// ============================================================================

/**
 * Mean Reciprocal Rank: 1/rank of the first relevant result.
 * MRR = 1.0 means #1 result is relevant; MRR = 0.5 means #2 is first relevant.
 */
function calculateMRR(expected: HardTestCase['expectedResults'], actual: string[]): number {
  const actualLower = actual.map(n => (n ?? '').toLowerCase());
  for (let i = 0; i < actualLower.length; i++) {
    for (const exp of expected) {
      if (actualLower[i]!.includes(exp.namePattern.toLowerCase()) ||
          exp.namePattern.toLowerCase().includes(actualLower[i]!)) {
        return 1 / (i + 1);
      }
    }
  }
  return 0;
}

/**
 * Success@K: is there at least one relevant result in the top K?
 */
function successAtK(expected: HardTestCase['expectedResults'], actual: string[], k: number): boolean {
  const topK = actual.slice(0, k).map(n => (n ?? '').toLowerCase());
  for (const a of topK) {
    for (const exp of expected) {
      if (a.includes(exp.namePattern.toLowerCase()) || exp.namePattern.toLowerCase().includes(a)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * NDCG@K: Normalized Discounted Cumulative Gain.
 *
 * Measures ranking quality with graded relevance:
 * - DCG = Σ (2^rel_i - 1) / log2(i + 2)  for positions i=0..K-1
 * - IDCG = DCG of the ideal ranking (expected results in order)
 * - NDCG = DCG / IDCG
 *
 * Returns 0-1 where 1.0 = perfect ranking order.
 */
function calculateNDCG(expected: HardTestCase['expectedResults'], actual: string[], k: number): number {
  const topK = actual.slice(0, k);

  // Compute relevance grade for each position in actual results
  const grades: number[] = topK.map(name => {
    const nameLower = (name ?? '').toLowerCase();
    for (const exp of expected) {
      if (nameLower.includes(exp.namePattern.toLowerCase()) ||
          exp.namePattern.toLowerCase().includes(nameLower)) {
        return exp.relevance;
      }
    }
    return 0; // Not in expected = irrelevant
  });

  // DCG: sum of (2^rel - 1) / log2(position + 2)
  let dcg = 0;
  for (let i = 0; i < grades.length; i++) {
    dcg += (Math.pow(2, grades[i]!) - 1) / Math.log2(i + 2);
  }

  // IDCG: ideal DCG (expected results sorted by relevance, truncated to K)
  const idealGrades = expected
    .map(e => e.relevance)
    .sort((a, b) => b - a)
    .slice(0, k);

  let idcg = 0;
  for (let i = 0; i < idealGrades.length; i++) {
    idcg += (Math.pow(2, idealGrades[i]!) - 1) / Math.log2(i + 2);
  }

  return idcg > 0 ? dcg / idcg : 0;
}

/**
 * Recall@K: fraction of expected results found in top K.
 */
function recallAtK(expected: HardTestCase['expectedResults'], actual: string[], k: number): number {
  if (expected.length === 0) return 1.0;
  const topK = actual.slice(0, k).map(n => (n ?? '').toLowerCase());
  let found = 0;
  for (const exp of expected) {
    const expLower = exp.namePattern.toLowerCase();
    if (topK.some(a => a.includes(expLower) || expLower.includes(a))) {
      found++;
    }
  }
  return found / expected.length;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.floor(sorted.length * p);
  return sorted[Math.min(idx, sorted.length - 1)] ?? 0;
}

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
// Per-query result tracking
// ============================================================================

interface HardQueryResult {
  testCase: HardTestCase;
  strategy: SearchType;
  latencyMs: number;
  resultNames: string[];
  /** Top 5 results with scores for debugging */
  top5: Array<{ name: string; score: number; nodeType: string }>;
  mrr: number;
  ndcg5: number;
  ndcg10: number;
  success1: boolean;
  success5: boolean;
  recall10: number;
  error?: string;
}

// ============================================================================
// Main benchmark
// ============================================================================

async function main() {
  console.log(`\n${'═'.repeat(100)}`);
  console.log(`  CodeGraph Search Stress Test: ${label}`);
  console.log(`${'═'.repeat(100)}`);
  console.log(`  Time: ${new Date().toISOString()}`);
  console.log(`  LLM: ${noLlm ? 'disabled' : fastOnly ? 'fast-only' : 'enabled (two-tier)'}`);
  console.log(`  Embeddings: ${useEmbeddings ? `enabled (${embeddingProvider})` : 'disabled'}`);
  console.log(`  Analysis: ${runAnalysis ? 'enabled' : 'disabled (use --analysis)'}`);
  const strategySet = new Set(HARD_CASES.flatMap(tc => tc.strategies));
  const strategyCount = strategySet.size;
  console.log(`  Strategies: ${[...strategySet].join(', ')}`);
  console.log(`  Test cases: ${HARD_CASES.length} queries × up to ${strategyCount} strategies`);
  console.log(`  Reindex: ${reindex}\n`);

  // Register plugins for analysis
  registerPlugins();

  // Step 1: Connect and optionally reindex
  const client = await getGraphClient();

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
  if (useEmbeddings) {
    console.log('Warming up embedding model...');
    await warmupEmbedding(embeddingConfig);
    console.log(`Embeddings ready (${embeddingProvider})\n`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STRESS TEST: Run each query against both HYBRID and ENRICHED
  // ══════════════════════════════════════════════════════════════════════════

  console.log(`${'═'.repeat(100)}`);
  console.log('  RANKING STRESS TEST — ALL STRATEGIES');
  console.log(`${'═'.repeat(100)}\n`);

  const allResults: HardQueryResult[] = [];

  // Table header
  console.log(
    `${'Strategy'.padEnd(10)} ${'Query'.padEnd(28)} ${'Category'.padEnd(18)} ` +
    `${'MRR'.padStart(6)} ${'NDCG@5'.padStart(7)} ${'NDCG@10'.padStart(8)} ` +
    `${'S@1'.padStart(4)} ${'S@5'.padStart(4)} ${'R@10'.padStart(6)} ` +
    `${'Lat'.padStart(7)} ${'Top Result'.padEnd(20)}`
  );
  console.log('─'.repeat(125));

  for (const tc of HARD_CASES) {
    for (const strategy of tc.strategies) {
      // Only run strategies we support
      if (strategy !== 'ENRICHED_V2' && strategy !== 'HYBRID') continue;

      const start = Date.now();
      let response: SearchResponse;

      try {
        if (strategy === 'ENRICHED_V2') {
          const v2Result = await enrichedSearchV2(tc.query, client, { limit: 20, embeddings: embeddingConfig });
          response = {
            results: v2Result.hits.map((h: any) => ({ name: h.name, nodeType: h.nodeType, score: h.score, sources: h.sources ?? [], filePath: h.filePath, properties: h.properties })),
            total: v2Result.hits.length,
            meta: { searchType: 'ENRICHED_V2', durationMs: v2Result.meta.durationMs },
          };
        } else {
          // HYBRID — direct call to hybridSearch
          const hybridResult = await hybridSearch(tc.query, client, { limit: 20, embeddings: embeddingConfig });
          response = {
            results: hybridResult.hits.map((h: any) => ({ name: h.name, nodeType: h.nodeType, score: h.score, sources: h.sources ?? [], filePath: h.filePath })),
            total: hybridResult.hits.length,
            meta: { searchType: 'HYBRID', durationMs: hybridResult.meta.durationMs },
          };
        }
      } catch (err) {
        const latency = Date.now() - start;
        allResults.push({
          testCase: tc,
          strategy,
          latencyMs: latency,
          resultNames: [],
          top5: [],
          mrr: 0,
          ndcg5: 0,
          ndcg10: 0,
          success1: false,
          success5: false,
          recall10: 0,
          error: err instanceof Error ? err.message : String(err),
        });
        console.log(
          `${strategy.padEnd(10)} ${tc.query.slice(0, 28).padEnd(28)} ${tc.category.padEnd(18)} ` +
          `${'ERR'.padStart(6)} ${'ERR'.padStart(7)} ${'ERR'.padStart(8)} ` +
          `${'-'.padStart(4)} ${'-'.padStart(4)} ${'-'.padStart(6)} ` +
          `${(latency + 'ms').padStart(7)}`
        );
        continue;
      }

      const latency = Date.now() - start;
      const resultNames = response.results.map(r => r.name);
      const top5 = response.results.slice(0, 5).map(r => ({
        name: r.name,
        score: r.score,
        nodeType: r.nodeType,
      }));

      const mrr = calculateMRR(tc.expectedResults, resultNames);
      const ndcg5 = calculateNDCG(tc.expectedResults, resultNames, 5);
      const ndcg10 = calculateNDCG(tc.expectedResults, resultNames, 10);
      const s1 = successAtK(tc.expectedResults, resultNames, 1);
      const s5 = successAtK(tc.expectedResults, resultNames, 5);
      const r10 = recallAtK(tc.expectedResults, resultNames, 10);

      const qr: HardQueryResult = {
        testCase: tc,
        strategy,
        latencyMs: latency,
        resultNames,
        top5,
        mrr,
        ndcg5,
        ndcg10,
        success1: s1,
        success5: s5,
        recall10: r10,
      };
      allResults.push(qr);

      const topResult = resultNames[0] ?? '(none)';
      console.log(
        `${strategy.padEnd(10)} ${tc.query.slice(0, 28).padEnd(28)} ${tc.category.padEnd(18)} ` +
        `${mrr.toFixed(2).padStart(6)} ${ndcg5.toFixed(3).padStart(7)} ${ndcg10.toFixed(3).padStart(8)} ` +
        `${(s1 ? '✓' : '✗').padStart(4)} ${(s5 ? '✓' : '✗').padStart(4)} ${(r10 * 100).toFixed(0).padStart(5)}% ` +
        `${(latency + 'ms').padStart(7)} ${topResult.slice(0, 20)}`
      );
    }
  }

  console.log('─'.repeat(125));

  // ══════════════════════════════════════════════════════════════════════════
  // SUMMARY: aggregate by strategy
  // ══════════════════════════════════════════════════════════════════════════

  console.log(`\n${'═'.repeat(100)}`);
  console.log('  AGGREGATE METRICS BY STRATEGY');
  console.log(`${'═'.repeat(100)}\n`);

  const byStrategy = new Map<string, HardQueryResult[]>();
  for (const r of allResults) {
    if (!byStrategy.has(r.strategy)) byStrategy.set(r.strategy, []);
    byStrategy.get(r.strategy)!.push(r);
  }

  console.log(
    `${'Strategy'.padEnd(12)} ${'Queries'.padStart(8)} ` +
    `${'Avg MRR'.padStart(8)} ${'Avg NDCG@5'.padStart(11)} ${'Avg NDCG@10'.padStart(12)} ` +
    `${'S@1'.padStart(6)} ${'S@5'.padStart(6)} ${'Avg R@10'.padStart(9)} ` +
    `${'Avg Lat'.padStart(8)} ${'P50'.padStart(6)} ${'P95'.padStart(6)}`
  );
  console.log('─'.repeat(100));

  for (const [strategy, results] of byStrategy) {
    const n = results.length;
    const avgMRR = results.reduce((s, r) => s + r.mrr, 0) / n;
    const avgNDCG5 = results.reduce((s, r) => s + r.ndcg5, 0) / n;
    const avgNDCG10 = results.reduce((s, r) => s + r.ndcg10, 0) / n;
    const s1Rate = results.filter(r => r.success1).length / n;
    const s5Rate = results.filter(r => r.success5).length / n;
    const avgRecall10 = results.reduce((s, r) => s + r.recall10, 0) / n;
    const latencies = results.map(r => r.latencyMs).sort((a, b) => a - b);
    const avgLat = latencies.reduce((s, v) => s + v, 0) / n;
    const p50 = percentile(latencies, 0.5);
    const p95 = percentile(latencies, 0.95);

    console.log(
      `${strategy.padEnd(12)} ${String(n).padStart(8)} ` +
      `${avgMRR.toFixed(3).padStart(8)} ${avgNDCG5.toFixed(3).padStart(11)} ${avgNDCG10.toFixed(3).padStart(12)} ` +
      `${(s1Rate * 100).toFixed(0).padStart(5)}% ${(s5Rate * 100).toFixed(0).padStart(5)}% ${(avgRecall10 * 100).toFixed(1).padStart(8)}% ` +
      `${(avgLat.toFixed(0) + 'ms').padStart(8)} ${(p50 + 'ms').padStart(6)} ${(p95 + 'ms').padStart(6)}`
    );
  }

  console.log('─'.repeat(100));

  // ══════════════════════════════════════════════════════════════════════════
  // PER-QUERY COMPARISON: all strategies side by side
  // ══════════════════════════════════════════════════════════════════════════

  const strategyNames = [...byStrategy.keys()];
  if (strategyNames.length >= 2) {
    console.log(`\n${'═'.repeat(100)}`);
    console.log('  PER-QUERY MRR COMPARISON');
    console.log(`${'═'.repeat(100)}\n`);

    // Build per-query lookup for each strategy
    const resultsByQueryStrategy = new Map<string, Map<string, HardQueryResult>>();
    for (const r of allResults) {
      if (!resultsByQueryStrategy.has(r.testCase.query)) {
        resultsByQueryStrategy.set(r.testCase.query, new Map());
      }
      resultsByQueryStrategy.get(r.testCase.query)!.set(r.strategy, r);
    }

    // Header
    const stratCols = strategyNames.map(s => s.slice(0, 10).padStart(10)).join(' ');
    console.log(`${'Query'.padEnd(28)} ${'Category'.padEnd(18)} ${stratCols}  ${'Best'.padEnd(12)}`);
    console.log('─'.repeat(28 + 18 + strategyNames.length * 11 + 14));

    for (const tc of HARD_CASES) {
      const qMap = resultsByQueryStrategy.get(tc.query);
      if (!qMap) continue;

      let bestMRR = -1;
      let bestStrat = '';
      const cols: string[] = [];
      for (const s of strategyNames) {
        const r = qMap.get(s);
        if (r) {
          cols.push(r.mrr.toFixed(2).padStart(10));
          if (r.mrr > bestMRR) { bestMRR = r.mrr; bestStrat = s; }
        } else {
          cols.push('-'.padStart(10));
        }
      }
      console.log(`${tc.query.slice(0, 28).padEnd(28)} ${tc.category.padEnd(18)} ${cols.join(' ')}  ${bestStrat}`);
    }

    console.log('─'.repeat(28 + 18 + strategyNames.length * 11 + 14));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BY CATEGORY: where does enrichment help most?
  // ══════════════════════════════════════════════════════════════════════════

  console.log(`\n${'═'.repeat(100)}`);
  console.log('  BY CATEGORY: Average MRR per Strategy');
  console.log(`${'═'.repeat(100)}\n`);

  const categories = [...new Set(HARD_CASES.map(tc => tc.category))];

  // Dynamic header based on strategies that actually ran
  const catStratCols = strategyNames.map(s => s.slice(0, 10).padStart(10)).join(' ');
  console.log(`${'Category'.padEnd(20)} ${catStratCols}`);
  console.log('─'.repeat(20 + strategyNames.length * 11));

  for (const cat of categories) {
    const cols: string[] = [];
    for (const strat of strategyNames) {
      const results = (byStrategy.get(strat) ?? []).filter(r => r.testCase.category === cat);
      if (results.length === 0) {
        cols.push('-'.padStart(10));
      } else {
        const avgMRR = results.reduce((s, r) => s + r.mrr, 0) / results.length;
        cols.push(avgMRR.toFixed(3).padStart(10));
      }
    }
    console.log(`${cat.padEnd(20)} ${cols.join(' ')}`);
  }

  console.log('─'.repeat(20 + strategyNames.length * 11));

  // ══════════════════════════════════════════════════════════════════════════
  // ANALYSIS BENCHMARKS (optional)
  // ══════════════════════════════════════════════════════════════════════════

  const analysisResults: Array<{ name: string; latencyMs: number; success: boolean; resultCount: number; details?: string; error?: string }> = [];

  if (runAnalysis) {
    console.log(`\n${'═'.repeat(100)}`);
    console.log('  ANALYSIS BENCHMARKS');
    console.log(`${'═'.repeat(100)}\n`);

    const cases = getAnalysisCases();
    for (const ac of cases) {
      const start = Date.now();
      try {
        const result = await ac.run();
        const latency = Date.now() - start;
        analysisResults.push({ name: ac.name, latencyMs: latency, success: result.success, resultCount: result.resultCount, details: result.details });
        console.log(`  ${result.success ? '✓' : '✗'} ${ac.name.padEnd(25)} ${(latency + 'ms').padStart(8)} ${String(result.resultCount).padStart(5)} results${result.details ? `  (${result.details})` : ''}`);
      } catch (err) {
        const latency = Date.now() - start;
        analysisResults.push({ name: ac.name, latencyMs: latency, success: false, resultCount: 0, error: String(err) });
        console.log(`  ✗ ${ac.name.padEnd(25)} ${(latency + 'ms').padStart(8)} ERROR`);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FINAL SUMMARY
  // ══════════════════════════════════════════════════════════════════════════

  console.log(`\n${'═'.repeat(100)}`);
  console.log('  FINAL SUMMARY');
  console.log(`${'═'.repeat(100)}\n`);

  for (const [strategy, results] of byStrategy) {
    const n = results.length;
    const avgMRR = results.reduce((s, r) => s + r.mrr, 0) / n;
    const avgNDCG5 = results.reduce((s, r) => s + r.ndcg5, 0) / n;
    const s1Rate = results.filter(r => r.success1).length / n;
    const s5Rate = results.filter(r => r.success5).length / n;
    const avgLat = results.reduce((s, r) => s + r.latencyMs, 0) / n;

    console.log(`  ${strategy}:`);
    console.log(`    MRR: ${avgMRR.toFixed(3)}  NDCG@5: ${avgNDCG5.toFixed(3)}  S@1: ${(s1Rate * 100).toFixed(0)}%  S@5: ${(s5Rate * 100).toFixed(0)}%  Avg latency: ${avgLat.toFixed(0)}ms`);
  }

  // Worst cases
  const worst = allResults
    .filter(r => r.mrr === 0 && r.testCase.expectedResults.length > 0)
    .slice(0, 5);
  if (worst.length > 0) {
    console.log('\n  Worst cases (MRR=0):');
    for (const w of worst) {
      console.log(`    ${w.strategy}: "${w.testCase.query}" → top: ${w.resultNames.slice(0, 3).join(', ') || '(empty)'}`);
    }
  }

  // Save results to JSON
  const resultsDir = resolve(ROOT, 'scripts/benchmark-results');
  mkdirSync(resultsDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `${label}-${timestamp}.json`;
  const filepath = resolve(resultsDir, filename);
  writeFileSync(filepath, JSON.stringify({
    label,
    timestamp: new Date().toISOString(),
    nodeCount,
    embeddings: useEmbeddings,
    llm: !noLlm,
    results: allResults.map(r => ({
      query: r.testCase.query,
      strategy: r.strategy,
      category: r.testCase.category,
      latencyMs: r.latencyMs,
      mrr: r.mrr,
      ndcg5: r.ndcg5,
      ndcg10: r.ndcg10,
      success1: r.success1,
      success5: r.success5,
      recall10: r.recall10,
      top5: r.top5,
    })),
    summary: Object.fromEntries([...byStrategy].map(([strat, results]) => [strat, {
      avgMRR: results.reduce((s, r) => s + r.mrr, 0) / results.length,
      avgNDCG5: results.reduce((s, r) => s + r.ndcg5, 0) / results.length,
      avgNDCG10: results.reduce((s, r) => s + r.ndcg10, 0) / results.length,
      successAt1: results.filter(r => r.success1).length / results.length,
      successAt5: results.filter(r => r.success5).length / results.length,
      avgRecall10: results.reduce((s, r) => s + r.recall10, 0) / results.length,
      avgLatencyMs: results.reduce((s, r) => s + r.latencyMs, 0) / results.length,
    }])),
  }, null, 2));
  console.log(`\n  Results saved: ${filepath}`);

  // Machine-readable summary line
  const summaryParts: string[] = [`[STRESS] ${label}`];
  for (const [strat, results] of byStrategy) {
    const avgMRR = results.reduce((s, r) => s + r.mrr, 0) / results.length;
    summaryParts.push(`${strat}.MRR=${avgMRR.toFixed(3)}`);
  }
  summaryParts.push(`queries=${allResults.length}`);
  console.log(`\n${summaryParts.join(' | ')}`);

  await closeGraphClient();
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
