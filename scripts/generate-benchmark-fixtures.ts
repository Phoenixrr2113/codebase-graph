#!/usr/bin/env npx tsx
/**
 * Generate Benchmark Fixtures — Discovers ground truth from the indexed graph
 * and generates a reusable test fixture file.
 *
 * The fixture file is a JSON file containing test cases that can be loaded
 * by the benchmark runner without re-discovering every time.
 *
 * Fixture categories:
 *   1. Symbol Lookup — exact function/class name → verify found
 *   2. Name Search — exact name → verify Top-1 ranking
 *   3. Partial Search — keyword substring → verify original in Top-K
 *   4. Fulltext Search — keyword/multi-word → verify ranking
 *   5. Semantic Search — natural language intent → verify results
 *   6. Cross-Mode — same query across name/fulltext/semantic
 *   7. Fuzzy/Typo — misspelled names → verify fuzzy recovery
 *   8. Context Retrieval — file/symbol → verify entities returned
 *   9. Impact Analysis — functions with known callers → verify callers
 *  10. Cross-File — CALLS/CONTAINS/IMPORTS edges → verify traversal
 *  11. Multi-Hop — 2+ hop traversal (callers-of-callers, transitive deps)
 *  12. Adversarial — injection, unicode, empty, long queries
 *
 * Usage:
 *   pnpm build && npx tsx scripts/generate-benchmark-fixtures.ts [output-file]
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

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

process.env.CODEGRAPH_RAW_TOOLS = 'true';

const { getGraphClient, closeGraphClient, registerPlugins } =
  await import('../packages/core/dist/index.js');

const outputFile = process.argv[2] ?? resolve(__dirname, 'benchmark-fixtures.json');

// ============================================================================
// Types
// ============================================================================

type TestCategory =
  | 'find_symbol' | 'search_exact' | 'search_partial' | 'search_fulltext'
  | 'search_semantic' | 'search_cross_mode' | 'fuzzy_typo' | 'adversarial'
  | 'context_file' | 'context_symbol' | 'impact' | 'cross_file_calls'
  | 'cross_file_contains' | 'multi_hop' | 'multi_repo' | 'operational';

interface FixtureTestCase {
  id: string;
  category: TestCategory;
  difficulty: 'easy' | 'medium' | 'hard';
  description: string;

  // What tool to call
  tool: string;
  args: Record<string, unknown>;

  // Ground truth
  expectedSymbols?: string[];
  expectedFiles?: string[];

  // Validation rules (serializable — no functions)
  validation: {
    type: 'found' | 'top_k' | 'has_results' | 'has_callers' | 'contains_entity'
         | 'edge_exists' | 'no_crash' | 'multi_project' | 'sorted_desc';
    /** For 'top_k': which position the expected symbol should be in (1, 3, 5, 10) */
    maxRank?: number;
    /** For 'contains_entity': entity name to check */
    entityName?: string;
    /** For 'edge_exists': caller name that should appear */
    callerName?: string;
    /** For 'has_callers': minimum callers expected */
    minCallers?: number;
  };

  // Flags
  requiresEmbeddings?: boolean;
  requiresMultiRepo?: boolean;
}

interface FixtureFile {
  generatedAt: string;
  graphStats: {
    totalNodes: number;
    totalFunctions: number;
    totalClasses: number;
    totalFiles: number;
    totalCallEdges: number;
    projects: string[];
  };
  testCases: FixtureTestCase[];
}

// ============================================================================
// Helpers
// ============================================================================

function fileBasename(path: string | null | undefined): string {
  if (!path) return '';
  return path.split('/').pop() ?? path;
}

/** Deterministic shuffle using a seed */
function seededShuffle<T>(arr: T[], seed: number): T[] {
  const result = [...arr];
  let s = seed;
  for (let i = result.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    const j = s % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function sample<T>(arr: T[], n: number, seed: number): T[] {
  return seededShuffle(arr, seed).slice(0, n);
}

/** Extract a meaningful keyword from a camelCase or snake_case name */
function extractKeywords(name: string): string[] {
  // Split camelCase
  const camelParts = name.replace(/([A-Z])/g, ' $1').trim().split(/\s+/);
  // Split snake_case
  const snakeParts = name.split('_').filter(p => p.length > 0);

  const parts = camelParts.length > snakeParts.length ? camelParts : snakeParts;
  return parts
    .map(p => p.toLowerCase())
    .filter(p => p.length >= 3)
    .filter(p => !['test', 'get', 'set', 'the', 'and', 'for', 'with', 'from', 'that', 'this', 'has', 'are', 'not', 'should'].includes(p));
}

/** Pick the most descriptive keyword from a name */
function bestKeyword(name: string): string | null {
  const keywords = extractKeywords(name);
  if (keywords.length === 0) return null;
  // Prefer longer, more unique keywords
  return keywords.sort((a, b) => b.length - a.length)[0];
}

/** Make a typo: swap two adjacent lowercase chars */
function makeTypo(name: string, seed: number): string {
  // Find swappable positions (both chars lowercase, not at boundaries)
  const positions: number[] = [];
  for (let i = 1; i < name.length - 1; i++) {
    if (name[i] === name[i].toLowerCase() && name[i + 1] === name[i + 1].toLowerCase()
        && name[i] !== '_' && name[i + 1] !== '_'
        && /[a-z]/.test(name[i]) && /[a-z]/.test(name[i + 1])) {
      positions.push(i);
    }
  }
  if (positions.length === 0) return name;
  const s = ((seed * 1664525 + 1013904223) & 0x7fffffff) % positions.length;
  const pos = positions[s];
  return name.slice(0, pos) + name[pos + 1] + name[pos] + name.slice(pos + 2);
}

/** Build a natural language query from a filename */
function filenameToQuery(filePath: string | null | undefined): string {
  if (!filePath) return '';
  const base = fileBasename(filePath).replace(/\.[^.]+$/, '');
  return base
    .replace(/([A-Z])/g, ' $1')    // camelCase
    .replace(/[-_]/g, ' ')          // kebab/snake
    .toLowerCase().trim()
    .split(/\s+/)
    .filter(w => w.length >= 2)
    .join(' ');
}

// ============================================================================
// Discovery
// ============================================================================

async function discover(client: any) {
  console.log('Discovering ground truth from graph...\n');

  // Node type counts
  const counts = await client.roQuery<{ type: string; cnt: number }>(
    "MATCH (n) RETURN labels(n)[0] as type, count(n) as cnt ORDER BY cnt DESC"
  );
  const totalNodes = counts.data.reduce((s: number, r: any) => s + r.cnt, 0);
  const totalFunctions = counts.data.find((r: any) => r.type === 'Function')?.cnt ?? 0;
  const totalClasses = counts.data.find((r: any) => r.type === 'Class')?.cnt ?? 0;
  const totalFiles = counts.data.find((r: any) => r.type === 'File')?.cnt ?? 0;

  // Projects
  const projResult = await client.roQuery<{ name: string }>(
    "MATCH (p:Project) RETURN p.name as name"
  );
  const projects = projResult.data.map((r: any) => r.name);

  // Unique functions (name appears exactly once — unambiguous)
  const funcResult = await client.roQuery<{ name: string; filePath: string }>(
    `MATCH (f:Function)
     WHERE f.name IS NOT NULL AND f.filePath IS NOT NULL
       AND size(f.name) >= 4 AND size(f.name) <= 80
       AND NOT f.name STARTS WITH '_'
       AND NOT f.name STARTS WITH '__'
       AND NOT f.name IN ['constructor', 'render', 'default', 'init', 'setup', 'main',
                          'test', 'run', 'start', 'stop', 'close', 'open', 'get', 'set',
                          'toString', 'valueOf', 'equals', 'hashCode']
     WITH f.name as name, collect(f.filePath) as paths, count(*) as cnt
     WHERE cnt = 1
     RETURN name, paths[0] as filePath
     ORDER BY size(name) DESC
     LIMIT 500`
  );
  const functions = funcResult.data as Array<{ name: string; filePath: string }>;

  // Unique classes
  const classResult = await client.roQuery<{ name: string; filePath: string }>(
    `MATCH (c:Class)
     WHERE c.name IS NOT NULL AND c.filePath IS NOT NULL
       AND size(c.name) >= 4 AND size(c.name) <= 60
       AND NOT c.name STARTS WITH '_'
     WITH c.name as name, collect(c.filePath) as paths, count(*) as cnt
     WHERE cnt = 1
     RETURN name, paths[0] as filePath
     ORDER BY size(name) DESC
     LIMIT 200`
  );
  const classes = classResult.data as Array<{ name: string; filePath: string }>;

  // Files with multiple functions
  const fileResult = await client.roQuery<{ filePath: string; cnt: number; funcs: string[] }>(
    `MATCH (f:File)-[:CONTAINS]->(fn:Function)
     WHERE f.filePath IS NOT NULL AND fn.name IS NOT NULL AND size(fn.name) >= 4
       AND NOT fn.name IN ['constructor', 'render', 'default']
     WITH f.filePath as filePath, count(fn) as cnt, collect(fn.name)[0..10] as funcs
     WHERE cnt >= 3
     RETURN filePath, cnt, funcs
     ORDER BY cnt DESC
     LIMIT 200`
  );
  const filesWithFunctions = fileResult.data as Array<{ filePath: string; cnt: number; funcs: string[] }>;

  // CALLS edges
  const callResult = await client.roQuery<{ caller: string; callee: string; callerFile: string; calleeFile: string }>(
    `MATCH (caller:Function)-[:CALLS]->(callee:Function)
     WHERE caller.name IS NOT NULL AND callee.name IS NOT NULL
       AND caller.filePath IS NOT NULL AND callee.filePath IS NOT NULL
       AND caller.name <> callee.name
       AND size(caller.name) >= 4 AND size(callee.name) >= 4
     RETURN caller.name as caller, callee.name as callee,
            caller.filePath as callerFile, callee.filePath as calleeFile
     LIMIT 500`
  );
  const callEdges = callResult.data as Array<{ caller: string; callee: string; callerFile: string; calleeFile: string }>;

  // Functions with the MOST callers (high fan-in)
  const fanInResult = await client.roQuery<{ name: string; callerCount: number }>(
    `MATCH (caller:Function)-[:CALLS]->(f:Function)
     WHERE f.name IS NOT NULL AND size(f.name) >= 4
     WITH f.name as name, count(DISTINCT caller) as callerCount
     WHERE callerCount >= 2
     RETURN name, callerCount
     ORDER BY callerCount DESC
     LIMIT 50`
  );
  const highFanIn = fanInResult.data as Array<{ name: string; callerCount: number }>;

  // Multi-hop: find 2-hop caller chains
  const multiHopResult = await client.roQuery<{ start: string; mid: string; end: string }>(
    `MATCH (a:Function)-[:CALLS]->(b:Function)-[:CALLS]->(c:Function)
     WHERE a.name IS NOT NULL AND b.name IS NOT NULL AND c.name IS NOT NULL
       AND a.name <> b.name AND b.name <> c.name AND a.name <> c.name
     RETURN a.name as start, b.name as mid, c.name as end
     LIMIT 100`
  );
  const multiHopChains = multiHopResult.data as Array<{ start: string; mid: string; end: string }>;

  // Total CALLS edges
  const totalCallsResult = await client.roQuery<{ cnt: number }>(
    "MATCH ()-[:CALLS]->() RETURN count(*) as cnt"
  );
  const totalCallEdges = totalCallsResult.data[0]?.cnt ?? 0;

  console.log(`  ${totalNodes} nodes | ${totalFunctions} functions | ${totalClasses} classes | ${totalFiles} files`);
  console.log(`  ${totalCallEdges} CALLS edges | ${projects.length} project(s): [${projects.join(', ')}]`);
  console.log(`  Discovered: ${functions.length} unique funcs, ${classes.length} unique classes`);
  console.log(`  ${filesWithFunctions.length} files w/ 3+ funcs, ${callEdges.length} call edges`);
  console.log(`  ${highFanIn.length} high fan-in functions, ${multiHopChains.length} multi-hop chains\n`);

  return {
    totalNodes, totalFunctions, totalClasses, totalFiles, totalCallEdges, projects,
    functions, classes, filesWithFunctions, callEdges, highFanIn, multiHopChains,
  };
}

// ============================================================================
// Test case generation
// ============================================================================

function generate(d: Awaited<ReturnType<typeof discover>>): FixtureTestCase[] {
  const tests: FixtureTestCase[] = [];
  const SEED = 42; // Deterministic

  // ─── OPERATIONAL (static) ──────────────────────────────────────────────

  tests.push(
    { id: 'op-ping', category: 'operational', difficulty: 'easy', description: 'Connectivity',
      tool: 'ping', args: {}, validation: { type: 'no_crash' } },
    { id: 'op-status', category: 'operational', difficulty: 'easy', description: 'Index status',
      tool: 'get_index_status', args: {}, validation: { type: 'has_results' } },
    { id: 'op-stats', category: 'operational', difficulty: 'easy', description: 'Graph stats',
      tool: 'get_stats', args: {}, validation: { type: 'has_results' } },
    { id: 'op-map', category: 'operational', difficulty: 'easy', description: 'Repo map',
      tool: 'get_repo_map', args: { maxTokens: 2048 }, validation: { type: 'has_results' } },
    { id: 'op-vuln', category: 'operational', difficulty: 'easy', description: 'Security scan',
      tool: 'find_vulnerabilities', args: {}, validation: { type: 'no_crash' } },
    { id: 'op-cx', category: 'operational', difficulty: 'easy', description: 'Complexity',
      tool: 'get_complexity_report', args: { threshold: 5 }, validation: { type: 'no_crash' } },
    { id: 'op-kg-store', category: 'operational', difficulty: 'easy', description: 'Store entity',
      tool: 'store_entity', args: { text: 'BenchFixture', type: 'Test' }, validation: { type: 'no_crash' } },
    { id: 'op-kg-stats', category: 'operational', difficulty: 'easy', description: 'KG stats',
      tool: 'get_knowledge_stats', args: {}, validation: { type: 'no_crash' } },
  );

  // Source from a discovered file
  if (d.filesWithFunctions.length > 0) {
    const f = d.filesWithFunctions[0];
    tests.push({
      id: 'op-source', category: 'operational', difficulty: 'easy',
      description: `Read ${fileBasename(f.filePath)}`,
      tool: 'get_source', args: { path: f.filePath, startLine: 1, endLine: 30 },
      validation: { type: 'has_results' },
    });
  }

  // ─── FIND_SYMBOL (120 tests) ──────────────────────────────────────────

  const fsFuncs = sample(d.functions, 100, SEED);
  for (let i = 0; i < fsFuncs.length; i++) {
    const fn = fsFuncs[i];
    tests.push({
      id: `fs-fn-${i}`, category: 'find_symbol', difficulty: 'easy',
      description: `find: ${fn.name}`,
      tool: 'find_symbol', args: { name: fn.name },
      expectedSymbols: [fn.name], expectedFiles: [fileBasename(fn.filePath)],
      validation: { type: 'found' },
    });
  }

  const fsClasses = sample(d.classes, 20, SEED + 1);
  for (let i = 0; i < fsClasses.length; i++) {
    const cls = fsClasses[i];
    tests.push({
      id: `fs-cls-${i}`, category: 'find_symbol', difficulty: 'easy',
      description: `find class: ${cls.name}`,
      tool: 'find_symbol', args: { name: cls.name, kind: 'class' },
      expectedSymbols: [cls.name], expectedFiles: [fileBasename(cls.filePath)],
      validation: { type: 'found' },
    });
  }

  // ─── SEARCH EXACT NAME (60 tests) ─────────────────────────────────────

  const snExact = sample(d.functions, 60, SEED + 2);
  for (let i = 0; i < snExact.length; i++) {
    const fn = snExact[i];
    tests.push({
      id: `sn-exact-${i}`, category: 'search_exact', difficulty: 'easy',
      description: `search exact: "${fn.name}"`,
      tool: 'search', args: { query: fn.name, limit: 10 },
      expectedSymbols: [fn.name],
      validation: { type: 'top_k', maxRank: 1 },
    });
  }

  // ─── SEARCH PARTIAL (60 tests) ────────────────────────────────────────

  const snPartialCandidates = d.functions.filter(f => {
    const kw = bestKeyword(f.name);
    return kw && kw.length >= 4;
  });
  const snPartial = sample(snPartialCandidates, 60, SEED + 3);
  for (let i = 0; i < snPartial.length; i++) {
    const fn = snPartial[i];
    const keyword = bestKeyword(fn.name)!;
    tests.push({
      id: `sn-partial-${i}`, category: 'search_partial', difficulty: 'medium',
      description: `partial: "${keyword}" → ${fn.name}`,
      tool: 'search', args: { query: keyword, limit: 10 },
      expectedSymbols: [fn.name],
      validation: { type: 'top_k', maxRank: 10 },
    });
  }

  // ─── FULLTEXT EXACT (40 tests) ────────────────────────────────────────

  const ftExact = sample(d.functions, 40, SEED + 4);
  for (let i = 0; i < ftExact.length; i++) {
    const fn = ftExact[i];
    tests.push({
      id: `ft-exact-${i}`, category: 'search_fulltext', difficulty: 'easy',
      description: `fulltext: "${fn.name}"`,
      tool: 'search_code', args: { query: fn.name },
      expectedSymbols: [fn.name], expectedFiles: [fileBasename(fn.filePath)],
      validation: { type: 'top_k', maxRank: 5 },
    });
  }

  // Fulltext partial (30 tests)
  const ftPartialCandidates = d.functions.filter(f => {
    const kw = bestKeyword(f.name);
    return kw && kw.length >= 4;
  });
  const ftPartial = sample(ftPartialCandidates, 30, SEED + 5);
  for (let i = 0; i < ftPartial.length; i++) {
    const fn = ftPartial[i];
    const keyword = bestKeyword(fn.name)!;
    tests.push({
      id: `ft-partial-${i}`, category: 'search_fulltext', difficulty: 'medium',
      description: `fulltext partial: "${keyword}" → ${fn.name}`,
      tool: 'search_code', args: { query: keyword, type: 'fulltext' },
      expectedSymbols: [fn.name],
      validation: { type: 'top_k', maxRank: 10 },
    });
  }

  // Fulltext multi-word (20 tests)
  const ftMulti = sample(d.filesWithFunctions.filter(f => f.funcs.length > 0), 20, SEED + 6);
  for (let i = 0; i < ftMulti.length; i++) {
    const file = ftMulti[i];
    const fnName = file.funcs[0];
    const fileQuery = filenameToQuery(file.filePath);
    if (fileQuery.length < 4) continue;
    tests.push({
      id: `ft-multi-${i}`, category: 'search_fulltext', difficulty: 'hard',
      description: `fulltext multi: "${fileQuery}"`,
      tool: 'search_code', args: { query: fileQuery, type: 'fulltext' },
      expectedSymbols: [fnName], expectedFiles: [fileBasename(file.filePath)],
      validation: { type: 'top_k', maxRank: 10 },
    });
  }

  // ─── SEMANTIC (40 tests, requires embeddings) ─────────────────────────

  // Semantic exact name (20)
  const semExact = sample(d.functions, 20, SEED + 7);
  for (let i = 0; i < semExact.length; i++) {
    const fn = semExact[i];
    tests.push({
      id: `sem-exact-${i}`, category: 'search_semantic', difficulty: 'easy',
      description: `semantic: "${fn.name}"`,
      tool: 'search_code', args: { query: fn.name, type: 'semantic' },
      expectedSymbols: [fn.name],
      validation: { type: 'top_k', maxRank: 5 },
      requiresEmbeddings: true,
    });
  }

  // Semantic from filename (20)
  const semFile = sample(d.filesWithFunctions.filter(f => f.filePath && filenameToQuery(f.filePath).length >= 5), 20, SEED + 8);
  for (let i = 0; i < semFile.length; i++) {
    const file = semFile[i];
    const query = filenameToQuery(file.filePath);
    tests.push({
      id: `sem-file-${i}`, category: 'search_semantic', difficulty: 'medium',
      description: `semantic: "${query}" → ${file.funcs[0]}`,
      tool: 'search_code', args: { query, type: 'semantic' },
      expectedSymbols: [file.funcs[0]], expectedFiles: [fileBasename(file.filePath)],
      validation: { type: 'top_k', maxRank: 10 },
      requiresEmbeddings: true,
    });
  }

  // Generic semantic (static, 10)
  const genericQueries = [
    'configuration and settings', 'error handling and exceptions',
    'logging and debugging', 'database connection',
    'authentication and authorization', 'parsing input data',
    'testing and validation', 'API endpoint handler',
    'file reading and writing', 'network HTTP request',
  ];
  for (let i = 0; i < genericQueries.length; i++) {
    tests.push({
      id: `sem-generic-${i}`, category: 'search_semantic', difficulty: 'hard',
      description: `semantic generic: "${genericQueries[i]}"`,
      tool: 'search_code', args: { query: genericQueries[i], type: 'semantic' },
      validation: { type: 'has_results' },
      requiresEmbeddings: true,
    });
  }

  // ─── CROSS-MODE (30 tests) ────────────────────────────────────────────

  const xmFuncs = sample(d.functions, 10, SEED + 9);
  for (let i = 0; i < xmFuncs.length; i++) {
    const fn = xmFuncs[i];
    tests.push({
      id: `xm-name-${i}`, category: 'search_cross_mode', difficulty: 'easy',
      description: `cross-mode name: "${fn.name}"`,
      tool: 'search', args: { query: fn.name, limit: 10 },
      expectedSymbols: [fn.name],
      validation: { type: 'top_k', maxRank: 1 },
    });
    tests.push({
      id: `xm-ft-${i}`, category: 'search_cross_mode', difficulty: 'medium',
      description: `cross-mode fulltext: "${fn.name}"`,
      tool: 'search_code', args: { query: fn.name },
      expectedSymbols: [fn.name],
      validation: { type: 'top_k', maxRank: 5 },
    });
    tests.push({
      id: `xm-sem-${i}`, category: 'search_cross_mode', difficulty: 'hard',
      description: `cross-mode semantic: "${fn.name}"`,
      tool: 'search_code', args: { query: fn.name, type: 'semantic' },
      expectedSymbols: [fn.name],
      validation: { type: 'top_k', maxRank: 10 },
      requiresEmbeddings: true,
    });
  }

  // ─── FUZZY / TYPO (60 tests) ──────────────────────────────────────────

  const fzCandidates = d.functions.filter(f => {
    // Only use names where makeTypo can actually swap chars
    const t = makeTypo(f.name, 42);
    return t !== f.name && f.name.length >= 6;
  });
  const fzFuncs = sample(fzCandidates, 60, SEED + 10);
  for (let i = 0; i < fzFuncs.length; i++) {
    const fn = fzFuncs[i];
    const typo = makeTypo(fn.name, SEED + 10 + i);
    if (typo === fn.name) continue;
    tests.push({
      id: `fz-${i}`, category: 'fuzzy_typo', difficulty: 'hard',
      description: `typo: "${typo}" → ${fn.name}`,
      tool: 'search', args: { query: typo, limit: 10 },
      expectedSymbols: [fn.name],
      validation: { type: 'top_k', maxRank: 5 },
    });
  }

  // ─── ADVERSARIAL (10 tests, static) ───────────────────────────────────

  tests.push(
    { id: 'adv-empty', category: 'adversarial', difficulty: 'easy', description: 'Empty query',
      tool: 'search', args: { query: '', limit: 5 }, validation: { type: 'no_crash' } },
    { id: 'adv-long', category: 'adversarial', difficulty: 'medium', description: 'Very long query',
      tool: 'search_code', args: { query: 'find '.repeat(200), type: 'fulltext' }, validation: { type: 'no_crash' } },
    { id: 'adv-special', category: 'adversarial', difficulty: 'medium', description: 'Type signature',
      tool: 'search', args: { query: 'function(a: string[]): Promise<void>', limit: 5 }, validation: { type: 'no_crash' } },
    { id: 'adv-injection', category: 'adversarial', difficulty: 'hard', description: 'Cypher injection',
      tool: 'search', args: { query: "'; MATCH (n) DETACH DELETE n; //", limit: 5 }, validation: { type: 'no_crash' } },
    { id: 'adv-unicode', category: 'adversarial', difficulty: 'medium', description: 'Unicode + emoji',
      tool: 'search', args: { query: '日本語 🚀 embedding', limit: 5 }, validation: { type: 'no_crash' } },
    { id: 'adv-numbers', category: 'adversarial', difficulty: 'easy', description: 'Just numbers',
      tool: 'search', args: { query: '12345', limit: 5 }, validation: { type: 'no_crash' } },
    { id: 'adv-single-char', category: 'adversarial', difficulty: 'easy', description: 'Single char',
      tool: 'search', args: { query: 'x', limit: 5 }, validation: { type: 'no_crash' } },
    { id: 'adv-newlines', category: 'adversarial', difficulty: 'medium', description: 'Newlines in query',
      tool: 'search', args: { query: 'function\nclass\nimport', limit: 5 }, validation: { type: 'no_crash' } },
    { id: 'adv-regex', category: 'adversarial', difficulty: 'hard', description: 'Regex chars',
      tool: 'search', args: { query: '(.*?)\\d+[a-z]+', limit: 5 }, validation: { type: 'no_crash' } },
    { id: 'adv-null-bytes', category: 'adversarial', difficulty: 'hard', description: 'Null bytes',
      tool: 'search', args: { query: 'test\x00null', limit: 5 }, validation: { type: 'no_crash' } },
  );

  // ─── CONTEXT FILE (40 tests) ──────────────────────────────────────────

  const ctxFiles = sample(d.filesWithFunctions, 40, SEED + 11);
  for (let i = 0; i < ctxFiles.length; i++) {
    const file = ctxFiles[i];
    tests.push({
      id: `ctx-file-${i}`, category: 'context_file', difficulty: 'easy',
      description: `context: ${fileBasename(file.filePath)}`,
      tool: 'get_context', args: { file: file.filePath, includeRelationships: true },
      expectedSymbols: [file.funcs[0]],
      validation: { type: 'contains_entity', entityName: file.funcs[0] },
    });
  }

  // ─── CONTEXT SYMBOL (30 tests) ────────────────────────────────────────

  const ctxSyms = sample(d.functions, 30, SEED + 12);
  for (let i = 0; i < ctxSyms.length; i++) {
    const fn = ctxSyms[i];
    tests.push({
      id: `ctx-sym-${i}`, category: 'context_symbol', difficulty: 'medium',
      description: `context sym: ${fn.name}`,
      tool: 'get_context', args: { symbol: fn.name, includeRelationships: true },
      expectedSymbols: [fn.name],
      validation: { type: 'has_results' },
    });
  }

  // ─── IMPACT ANALYSIS (30 tests) ───────────────────────────────────────

  // Functions with KNOWN callers
  const impactKnown = sample(d.highFanIn, Math.min(20, d.highFanIn.length), SEED + 13);
  for (let i = 0; i < impactKnown.length; i++) {
    const fn = impactKnown[i];
    tests.push({
      id: `imp-known-${i}`, category: 'impact', difficulty: 'medium',
      description: `impact (${fn.callerCount} callers): ${fn.name}`,
      tool: 'analyze_impact', args: { symbol: fn.name },
      validation: { type: 'has_callers', minCallers: 1 },
    });
  }

  // Random functions (no caller expectation)
  const impactRandom = sample(d.functions, 10, SEED + 14);
  for (let i = 0; i < impactRandom.length; i++) {
    tests.push({
      id: `imp-rand-${i}`, category: 'impact', difficulty: 'easy',
      description: `impact: ${impactRandom[i].name}`,
      tool: 'analyze_impact', args: { symbol: impactRandom[i].name },
      validation: { type: 'no_crash' },
    });
  }

  // ─── CROSS-FILE CALLS (40 tests) ──────────────────────────────────────

  const xfCalls = sample(d.callEdges, Math.min(40, d.callEdges.length), SEED + 15);
  for (let i = 0; i < xfCalls.length; i++) {
    const edge = xfCalls[i];
    tests.push({
      id: `xf-call-${i}`, category: 'cross_file_calls', difficulty: 'medium',
      description: `CALLS: ${edge.caller.slice(0, 20)} → ${edge.callee.slice(0, 20)}`,
      tool: 'query',
      args: { cypher: `MATCH (caller:Function)-[:CALLS]->(callee:Function) WHERE callee.name = '${edge.callee.replace(/'/g, "\\'")}' RETURN caller.name as name LIMIT 10` },
      expectedSymbols: [edge.caller],
      validation: { type: 'edge_exists', callerName: edge.caller },
    });
  }

  // ─── CROSS-FILE CONTAINS (30 tests) ───────────────────────────────────

  const xfContains = sample(d.filesWithFunctions, 30, SEED + 16);
  for (let i = 0; i < xfContains.length; i++) {
    const file = xfContains[i];
    const base = fileBasename(file.filePath);
    tests.push({
      id: `xf-contains-${i}`, category: 'cross_file_contains', difficulty: 'easy',
      description: `CONTAINS: ${base} → ${file.funcs[0]}`,
      tool: 'query',
      args: { cypher: `MATCH (f:File)-[:CONTAINS]->(fn:Function) WHERE f.filePath CONTAINS '${base.replace(/'/g, "\\'")}' RETURN fn.name as name LIMIT 20` },
      expectedSymbols: [file.funcs[0]],
      validation: { type: 'contains_entity', entityName: file.funcs[0] },
    });
  }

  // ─── MULTI-HOP (20 tests) ─────────────────────────────────────────────

  const mhChains = sample(d.multiHopChains, Math.min(20, d.multiHopChains.length), SEED + 17);
  for (let i = 0; i < mhChains.length; i++) {
    const chain = mhChains[i];
    tests.push({
      id: `mh-${i}`, category: 'multi_hop', difficulty: 'hard',
      description: `2-hop: ${chain.start.slice(0, 15)} → ${chain.mid.slice(0, 15)} → ${chain.end.slice(0, 15)}`,
      tool: 'query',
      args: { cypher: `MATCH (a:Function)-[:CALLS*1..2]->(c:Function) WHERE c.name = '${chain.end.replace(/'/g, "\\'")}' RETURN DISTINCT a.name as name LIMIT 20` },
      expectedSymbols: [chain.start],
      validation: { type: 'top_k', maxRank: 20 },
    });
  }

  // ─── MULTI-REPO (if applicable) ───────────────────────────────────────

  if (d.projects.length > 1) {
    tests.push(
      { id: 'mr-count', category: 'multi_repo', difficulty: 'easy', description: 'Count projects',
        tool: 'query', args: { cypher: "MATCH (p:Project) RETURN p.name as name" },
        validation: { type: 'multi_project' }, requiresMultiRepo: true },
      { id: 'mr-search', category: 'multi_repo', difficulty: 'medium', description: 'Search spans projects',
        tool: 'search', args: { query: 'config', limit: 20 },
        validation: { type: 'multi_project' }, requiresMultiRepo: true },
      { id: 'mr-files', category: 'multi_repo', difficulty: 'easy', description: 'Total files',
        tool: 'query', args: { cypher: "MATCH (f:File) RETURN count(f) as total" },
        validation: { type: 'has_results' }, requiresMultiRepo: true },
    );
  }

  // ─── COMPLEXITY (3 tests, static) ─────────────────────────────────────

  tests.push(
    { id: 'cx-low', category: 'operational', difficulty: 'easy', description: 'Complexity threshold 5',
      tool: 'get_complexity_report', args: { threshold: 5 }, validation: { type: 'no_crash' } },
    { id: 'cx-high', category: 'operational', difficulty: 'medium', description: 'Complexity threshold 15',
      tool: 'get_complexity_report', args: { threshold: 15 }, validation: { type: 'no_crash' } },
    { id: 'cx-sorted', category: 'operational', difficulty: 'medium', description: 'Complexity sorted',
      tool: 'get_complexity_report', args: { threshold: 3 }, validation: { type: 'sorted_desc' } },
  );

  return tests;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('═'.repeat(80));
  console.log('  Benchmark Fixture Generator');
  console.log('═'.repeat(80));

  registerPlugins();
  const client = await getGraphClient();

  const d = await discover(client);

  console.log('Generating test cases...\n');
  const tests = generate(d);

  // Count by category
  const byCat = new Map<string, number>();
  for (const t of tests) byCat.set(t.category, (byCat.get(t.category) ?? 0) + 1);

  console.log('  Test cases by category:');
  for (const [cat, count] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${cat.padEnd(25)} ${count}`);
  }
  console.log(`\n  Total: ${tests.length} test cases\n`);

  const fixture: FixtureFile = {
    generatedAt: new Date().toISOString(),
    graphStats: {
      totalNodes: d.totalNodes,
      totalFunctions: d.totalFunctions,
      totalClasses: d.totalClasses,
      totalFiles: d.totalFiles,
      totalCallEdges: d.totalCallEdges,
      projects: d.projects,
    },
    testCases: tests,
  };

  writeFileSync(outputFile, JSON.stringify(fixture, null, 2));
  console.log(`  Written to: ${outputFile}`);
  console.log(`  File size: ${(JSON.stringify(fixture).length / 1024).toFixed(1)} KB`);

  await closeGraphClient();
}

main().catch(err => { console.error('Failed:', err); process.exit(1); });
