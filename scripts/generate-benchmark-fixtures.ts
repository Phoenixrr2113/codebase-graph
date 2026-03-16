#!/usr/bin/env npx tsx
/**
 * Generate Benchmark Fixtures — Discovers ground truth from the indexed graph
 * and generates a reusable test fixture file covering ALL 29 raw MCP tools
 * and 5 persona tools.
 *
 * Fixture categories:
 *   1.  find_symbol        — exact function/class name → verify found
 *   2.  search_exact       — exact name search → verify Top-1
 *   3.  search_partial     — keyword substring → verify Top-K
 *   4.  search_fulltext    — fulltext/multi-word → verify ranking
 *   5.  search_semantic    — natural language intent → verify results
 *   6.  search_cross_mode  — same query across name/fulltext/semantic
 *   7.  search_filters     — search with type filters (file/function/class/interface)
 *   8.  search_strategies  — search_code with strategy param
 *   9.  fuzzy_typo         — misspelled names → verify fuzzy recovery
 *  10.  adversarial        — injection, unicode, empty, long queries
 *  11.  context_file       — file context → verify entities
 *  12.  context_symbol     — symbol context → verify results
 *  13.  impact             — functions with known callers → verify callers
 *  14.  cross_file_calls   — CALLS edges → verify traversal
 *  15.  cross_file_contains — CONTAINS edges → verify
 *  16.  multi_hop          — 2+ hop traversal
 *  17.  multi_repo         — multi-project queries
 *  18.  operational        — ping, status, stats, etc.
 *  19.  config             — configure_projects (list/status)
 *  20.  reindex            — trigger_reindex
 *  21.  refactoring        — analyze_file_for_refactoring
 *  22.  dataflow           — trace_data_flow
 *  23.  history            — get_symbol_history
 *  24.  explain            — explain_code (requiresLlm)
 *  25.  ask_code           — ask_code (requiresLlm)
 *  26.  nl_to_cypher       — query_cypher (requiresLlm)
 *  27.  knowledge_crud     — store/query/recall/decay knowledge
 *  28.  vulnerabilities    — find_vulnerabilities with severity/category
 *  29.  complexity         — get_complexity_report with sortBy variants
 *  30.  source             — get_source deeper reading
 *  31.  repo_map           — get_repo_map with focusFiles/focusSymbols
 *  32.  raw_query          — raw Cypher (IMPORTS, EXTENDS, IMPLEMENTS)
 *  33.  persona            — all 5 persona tools with action dispatch
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
  | 'search_semantic' | 'search_cross_mode' | 'search_filters' | 'search_strategies'
  | 'fuzzy_typo' | 'adversarial'
  | 'context_file' | 'context_symbol' | 'impact' | 'cross_file_calls'
  | 'cross_file_contains' | 'multi_hop' | 'multi_repo' | 'operational'
  | 'config' | 'reindex' | 'refactoring' | 'dataflow' | 'history'
  | 'explain' | 'ask_code' | 'nl_to_cypher' | 'knowledge_crud'
  | 'vulnerabilities' | 'complexity' | 'source' | 'repo_map'
  | 'raw_query' | 'persona';

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
  requiresLlm?: boolean;
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

/** Extract meaningful keywords from a camelCase or snake_case name */
function extractKeywords(name: string): string[] {
  const camelParts = name.replace(/([A-Z])/g, ' $1').trim().split(/\s+/);
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
  return keywords.sort((a, b) => b.length - a.length)[0];
}

/** Make a typo: swap two adjacent lowercase chars */
function makeTypo(name: string, seed: number): string {
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

/** Generic file names that produce overly broad queries */
const GENERIC_FILENAMES = new Set([
  'index', 'helpers', 'utils', 'types', 'constants', 'config', 'schema',
  'main', 'app', 'server', 'client', 'model', 'test', 'spec', 'setup',
  'api', 'service', 'pipeline', 'queries', 'operations', 'context',
]);

const FILENAME_STOP_WORDS = new Set([
  'type', 'types', 'index', 'utils', 'helpers', 'api', 'test', 'spec',
  'service', 'config', 'model', 'schema', 'client', 'server', 'main',
]);

/** Build a natural language query from a filename */
function filenameToQuery(filePath: string | null | undefined): string {
  if (!filePath) return '';
  const base = fileBasename(filePath).replace(/\.[^.]+$/, '');
  return base
    .replace(/([A-Z])/g, ' $1')
    .replace(/[-_]/g, ' ')
    .toLowerCase().trim()
    .split(/\s+/)
    .filter(w => w.length >= 2 && !FILENAME_STOP_WORDS.has(w))
    .join(' ');
}

/** Check if a filename produces a generic, overly broad query */
function isGenericFilename(filePath: string): boolean {
  const base = fileBasename(filePath).replace(/\.[^.]+$/, '').toLowerCase();
  return GENERIC_FILENAMES.has(base);
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

  // Unique interfaces
  const ifaceResult = await client.roQuery<{ name: string; filePath: string }>(
    `MATCH (i:Interface)
     WHERE i.name IS NOT NULL AND i.filePath IS NOT NULL
       AND size(i.name) >= 4 AND size(i.name) <= 60
     WITH i.name as name, collect(i.filePath) as paths, count(*) as cnt
     WHERE cnt = 1
     RETURN name, paths[0] as filePath
     ORDER BY size(name) DESC
     LIMIT 100`
  );
  const interfaces = ifaceResult.data as Array<{ name: string; filePath: string }>;

  // Files with multiple functions (5+ for refactoring candidates)
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

  // Files with 5+ functions (refactoring candidates)
  const refactoringFiles = filesWithFunctions.filter(f => f.cnt >= 5);

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

  // IMPORTS edges
  const importResult = await client.roQuery<{ importer: string; imported: string }>(
    `MATCH (a:File)-[:IMPORTS]->(b:File)
     WHERE a.filePath IS NOT NULL AND b.filePath IS NOT NULL
     RETURN a.filePath as importer, b.filePath as imported
     LIMIT 200`
  );
  const importEdges = importResult.data as Array<{ importer: string; imported: string }>;

  // EXTENDS edges
  const extendsResult = await client.roQuery<{ child: string; parent: string }>(
    `MATCH (child)-[:EXTENDS]->(parent)
     WHERE child.name IS NOT NULL AND parent.name IS NOT NULL
       AND size(child.name) >= 3 AND size(parent.name) >= 3
     RETURN child.name as child, parent.name as parent
     LIMIT 100`
  );
  const extendsEdges = extendsResult.data as Array<{ child: string; parent: string }>;

  // IMPLEMENTS edges
  const implResult = await client.roQuery<{ cls: string; iface: string }>(
    `MATCH (c)-[:IMPLEMENTS]->(i)
     WHERE c.name IS NOT NULL AND i.name IS NOT NULL
       AND size(c.name) >= 3 AND size(i.name) >= 3
     RETURN c.name as cls, i.name as iface
     LIMIT 100`
  );
  const implementsEdges = implResult.data as Array<{ cls: string; iface: string }>;

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

  // Files for source reading (varied sizes)
  const sourceFiles = await client.roQuery<{ filePath: string; lineCount: number }>(
    `MATCH (f:File)
     WHERE f.filePath IS NOT NULL AND f.lineCount IS NOT NULL AND f.lineCount > 10
     RETURN f.filePath as filePath, f.lineCount as lineCount
     ORDER BY f.lineCount DESC
     LIMIT 100`
  );
  const filesForSource = sourceFiles.data as Array<{ filePath: string; lineCount: number }>;

  console.log(`  ${totalNodes} nodes | ${totalFunctions} functions | ${totalClasses} classes | ${totalFiles} files`);
  console.log(`  ${totalCallEdges} CALLS edges | ${projects.length} project(s): [${projects.join(', ')}]`);
  console.log(`  Discovered: ${functions.length} unique funcs, ${classes.length} unique classes, ${interfaces.length} interfaces`);
  console.log(`  ${filesWithFunctions.length} files w/ 3+ funcs, ${refactoringFiles.length} files w/ 5+ funcs`);
  console.log(`  ${callEdges.length} call edges, ${importEdges.length} import edges`);
  console.log(`  ${extendsEdges.length} extends, ${implementsEdges.length} implements`);
  console.log(`  ${highFanIn.length} high fan-in functions, ${multiHopChains.length} multi-hop chains`);
  console.log(`  ${filesForSource.length} files for source reading\n`);

  return {
    totalNodes, totalFunctions, totalClasses, totalFiles, totalCallEdges, projects,
    functions, classes, interfaces, filesWithFunctions, refactoringFiles,
    callEdges, importEdges, extendsEdges, implementsEdges,
    highFanIn, multiHopChains, filesForSource,
  };
}

// ============================================================================
// Test case generation
// ============================================================================

function generate(d: Awaited<ReturnType<typeof discover>>): FixtureTestCase[] {
  const tests: FixtureTestCase[] = [];
  const SEED = 42;

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
    { id: 'op-kg-stats', category: 'operational', difficulty: 'easy', description: 'KG stats',
      tool: 'get_knowledge_stats', args: {}, validation: { type: 'no_crash' } },
  );

  // ─── CONFIG (configure_projects) ───────────────────────────────────────

  tests.push(
    { id: 'cfg-list', category: 'config', difficulty: 'easy', description: 'List projects',
      tool: 'configure_projects', args: { action: 'list' }, validation: { type: 'has_results' } },
    { id: 'cfg-status', category: 'config', difficulty: 'easy', description: 'Project status',
      tool: 'configure_projects', args: { action: 'status' }, validation: { type: 'has_results' } },
  );

  // ─── REINDEX ───────────────────────────────────────────────────────────

  tests.push(
    { id: 'reidx-incr', category: 'reindex', difficulty: 'easy', description: 'Incremental reindex',
      tool: 'trigger_reindex', args: { mode: 'incremental' }, validation: { type: 'no_crash' } },
  );

  // ─── SOURCE (get_source — deeper file reading) ─────────────────────────

  // First file for basic source
  if (d.filesWithFunctions.length > 0) {
    const f = d.filesWithFunctions[0];
    tests.push({
      id: 'src-basic', category: 'source', difficulty: 'easy',
      description: `Read ${fileBasename(f.filePath)} lines 1-30`,
      tool: 'get_source', args: { path: f.filePath, startLine: 1, endLine: 30 },
      validation: { type: 'has_results' },
    });
  }

  // More source reading tests from discovered files
  const srcFiles = sample(d.filesForSource.length > 0 ? d.filesForSource : d.filesWithFunctions, 10, SEED + 100);
  for (let i = 0; i < srcFiles.length; i++) {
    const f = srcFiles[i];
    const fp = 'filePath' in f ? f.filePath : '';
    const lineCount = 'lineCount' in f ? (f as any).lineCount : 100;
    const startLine = Math.max(1, Math.floor(lineCount / 3));
    const endLine = Math.min(lineCount, startLine + 40);
    tests.push({
      id: `src-mid-${i}`, category: 'source', difficulty: 'easy',
      description: `Read ${fileBasename(fp)} lines ${startLine}-${endLine}`,
      tool: 'get_source', args: { path: fp, startLine, endLine },
      validation: { type: 'has_results' },
    });
  }

  // ─── REPO MAP (with focusFiles and focusSymbols) ───────────────────────

  tests.push(
    { id: 'rm-default', category: 'repo_map', difficulty: 'easy', description: 'Repo map default',
      tool: 'get_repo_map', args: { maxTokens: 4096 }, validation: { type: 'has_results' } },
    { id: 'rm-small', category: 'repo_map', difficulty: 'easy', description: 'Repo map small',
      tool: 'get_repo_map', args: { maxTokens: 1024 }, validation: { type: 'has_results' } },
  );

  if (d.filesWithFunctions.length > 0) {
    const focusFile = d.filesWithFunctions[0].filePath;
    tests.push({
      id: 'rm-focus-file', category: 'repo_map', difficulty: 'medium',
      description: `Repo map focus: ${fileBasename(focusFile)}`,
      tool: 'get_repo_map', args: { maxTokens: 4096, focusFiles: [focusFile] },
      validation: { type: 'has_results' },
    });
  }

  if (d.functions.length > 0) {
    const focusSym = d.functions[0].name;
    tests.push({
      id: 'rm-focus-sym', category: 'repo_map', difficulty: 'medium',
      description: `Repo map focus symbol: ${focusSym}`,
      tool: 'get_repo_map', args: { maxTokens: 4096, focusSymbols: [focusSym] },
      validation: { type: 'has_results' },
    });
  }

  if (d.filesWithFunctions.length >= 2 && d.functions.length >= 2) {
    tests.push({
      id: 'rm-multi-focus', category: 'repo_map', difficulty: 'hard',
      description: 'Repo map multi-focus',
      tool: 'get_repo_map', args: {
        maxTokens: 8192,
        focusFiles: [d.filesWithFunctions[0].filePath, d.filesWithFunctions[1].filePath],
        focusSymbols: [d.functions[0].name, d.functions[1].name],
      },
      validation: { type: 'has_results' },
    });
  }

  // ─── VULNERABILITIES (with severity/category) ─────────────────────────

  tests.push(
    { id: 'vuln-all', category: 'vulnerabilities', difficulty: 'easy', description: 'All vulnerabilities',
      tool: 'find_vulnerabilities', args: {}, validation: { type: 'no_crash' } },
    { id: 'vuln-critical', category: 'vulnerabilities', difficulty: 'medium', description: 'Critical only',
      tool: 'find_vulnerabilities', args: { severity: 'critical' }, validation: { type: 'no_crash' } },
    { id: 'vuln-high', category: 'vulnerabilities', difficulty: 'medium', description: 'High severity',
      tool: 'find_vulnerabilities', args: { severity: 'high' }, validation: { type: 'no_crash' } },
    { id: 'vuln-injection', category: 'vulnerabilities', difficulty: 'medium', description: 'Injection category',
      tool: 'find_vulnerabilities', args: { category: 'injection' }, validation: { type: 'no_crash' } },
    { id: 'vuln-xss', category: 'vulnerabilities', difficulty: 'medium', description: 'XSS category',
      tool: 'find_vulnerabilities', args: { category: 'xss' }, validation: { type: 'no_crash' } },
    { id: 'vuln-auth', category: 'vulnerabilities', difficulty: 'medium', description: 'Auth category',
      tool: 'find_vulnerabilities', args: { category: 'auth' }, validation: { type: 'no_crash' } },
  );

  // Scoped vulnerability scan
  if (d.filesWithFunctions.length > 0) {
    const scopePath = d.filesWithFunctions[0].filePath.split('/').slice(0, -1).join('/');
    tests.push({
      id: 'vuln-scoped', category: 'vulnerabilities', difficulty: 'medium',
      description: `Scoped vuln scan: ${fileBasename(scopePath)}`,
      tool: 'find_vulnerabilities', args: { scope: scopePath, severity: 'all' },
      validation: { type: 'no_crash' },
    });
  }

  // ─── COMPLEXITY (with sortBy variants) ─────────────────────────────────

  tests.push(
    { id: 'cx-default', category: 'complexity', difficulty: 'easy', description: 'Complexity default',
      tool: 'get_complexity_report', args: { threshold: 5 }, validation: { type: 'no_crash' } },
    { id: 'cx-high', category: 'complexity', difficulty: 'medium', description: 'Complexity threshold 15',
      tool: 'get_complexity_report', args: { threshold: 15 }, validation: { type: 'no_crash' } },
    { id: 'cx-low', category: 'complexity', difficulty: 'easy', description: 'Complexity threshold 3',
      tool: 'get_complexity_report', args: { threshold: 3 }, validation: { type: 'sorted_desc' } },
    { id: 'cx-cognitive', category: 'complexity', difficulty: 'medium', description: 'Sort by cognitive',
      tool: 'get_complexity_report', args: { threshold: 5, sortBy: 'cognitive' }, validation: { type: 'no_crash' } },
    { id: 'cx-nesting', category: 'complexity', difficulty: 'medium', description: 'Sort by nesting',
      tool: 'get_complexity_report', args: { threshold: 5, sortBy: 'nesting' }, validation: { type: 'no_crash' } },
  );

  // Scoped complexity
  if (d.filesWithFunctions.length > 0) {
    const scopePath = d.filesWithFunctions[0].filePath.split('/').slice(0, -1).join('/');
    tests.push({
      id: 'cx-scoped', category: 'complexity', difficulty: 'medium',
      description: `Scoped complexity: ${fileBasename(scopePath)}`,
      tool: 'get_complexity_report', args: { scope: scopePath, threshold: 3 },
      validation: { type: 'no_crash' },
    });
  }

  // ─── REFACTORING (analyze_file_for_refactoring) ────────────────────────

  const refFiles = sample(d.refactoringFiles, Math.min(10, d.refactoringFiles.length), SEED + 20);
  for (let i = 0; i < refFiles.length; i++) {
    const f = refFiles[i];
    tests.push({
      id: `refactor-${i}`, category: 'refactoring', difficulty: 'medium',
      description: `Refactor: ${fileBasename(f.filePath)} (${f.cnt} funcs)`,
      tool: 'analyze_file_for_refactoring', args: { file: f.filePath },
      validation: { type: 'has_results' },
    });
  }

  // ─── DATA FLOW (trace_data_flow) ───────────────────────────────────────

  const dataflowSources = ['request.body', 'req.params', 'req.query', 'input', 'data',
    'config', 'process.env', 'args', 'params', 'options'];
  const dfFiles = sample(d.filesWithFunctions, Math.min(10, d.filesWithFunctions.length), SEED + 21);
  for (let i = 0; i < dfFiles.length; i++) {
    const f = dfFiles[i];
    const source = dataflowSources[i % dataflowSources.length];
    tests.push({
      id: `df-${i}`, category: 'dataflow', difficulty: 'medium',
      description: `Dataflow "${source}" in ${fileBasename(f.filePath)}`,
      tool: 'trace_data_flow', args: { source, file: f.filePath },
      validation: { type: 'no_crash' },
    });
  }

  // ─── SYMBOL HISTORY (get_symbol_history) ───────────────────────────────

  const histSymbols = sample(d.functions, Math.min(10, d.functions.length), SEED + 22);
  for (let i = 0; i < histSymbols.length; i++) {
    const fn = histSymbols[i];
    tests.push({
      id: `hist-${i}`, category: 'history', difficulty: 'medium',
      description: `History: ${fn.name}`,
      tool: 'get_symbol_history', args: { symbol: fn.name, limit: 10 },
      validation: { type: 'no_crash' },
    });
  }

  // ─── EXPLAIN CODE (requiresLlm) ───────────────────────────────────────

  const explainFiles = sample(d.filesWithFunctions, Math.min(5, d.filesWithFunctions.length), SEED + 23);
  for (let i = 0; i < explainFiles.length; i++) {
    const f = explainFiles[i];
    tests.push({
      id: `explain-${i}`, category: 'explain', difficulty: 'hard',
      description: `Explain: ${fileBasename(f.filePath)}`,
      tool: 'explain_code', args: { file: f.filePath, start_line: 1, end_line: 50 },
      validation: { type: 'no_crash' },
      requiresLlm: true,
    });
  }

  // ─── ASK CODE (requiresLlm) ───────────────────────────────────────────

  const askQuestions = [
    'How does the search pipeline work?',
    'What are the main entry points?',
    'How is authentication handled?',
    'What database operations are used?',
    'How are errors handled across the codebase?',
  ];
  for (let i = 0; i < askQuestions.length; i++) {
    tests.push({
      id: `ask-${i}`, category: 'ask_code', difficulty: 'hard',
      description: `Ask: ${askQuestions[i].slice(0, 40)}`,
      tool: 'ask_code', args: { question: askQuestions[i] },
      validation: { type: 'no_crash' },
      requiresLlm: true,
    });
  }

  // ─── NL TO CYPHER (query_cypher, requiresLlm) ─────────────────────────

  const cypherQuestions = [
    'Find all functions that call more than 5 other functions',
    'Which files import the most other files?',
    'What classes extend other classes?',
  ];
  for (let i = 0; i < cypherQuestions.length; i++) {
    tests.push({
      id: `nlcypher-${i}`, category: 'nl_to_cypher', difficulty: 'hard',
      description: `NL→Cypher: ${cypherQuestions[i].slice(0, 40)}`,
      tool: 'query_cypher', args: { question: cypherQuestions[i] },
      validation: { type: 'no_crash' },
      requiresLlm: true,
    });
  }

  // ─── KNOWLEDGE CRUD ───────────────────────────────────────────────────

  tests.push(
    // Store entity
    { id: 'kg-store-1', category: 'knowledge_crud', difficulty: 'easy', description: 'Store entity: concept',
      tool: 'store_entity', args: { text: 'BenchmarkFixtureTest', type: 'Concept' },
      validation: { type: 'no_crash' } },
    { id: 'kg-store-2', category: 'knowledge_crud', difficulty: 'easy', description: 'Store entity: decision',
      tool: 'store_entity', args: { text: 'UseGraphDB', type: 'Decision', confidence: 0.95 },
      validation: { type: 'no_crash' } },
    { id: 'kg-store-3', category: 'knowledge_crud', difficulty: 'easy', description: 'Store entity: person',
      tool: 'store_entity', args: { text: 'TestUser', type: 'Person' },
      validation: { type: 'no_crash' } },

    // Store relationship
    { id: 'kg-rel-1', category: 'knowledge_crud', difficulty: 'medium', description: 'Store relationship',
      tool: 'store_relationship', args: {
        headText: 'BenchmarkFixtureTest', headType: 'Concept',
        tailText: 'UseGraphDB', tailType: 'Decision',
        type: 'RELATES_TO',
      }, validation: { type: 'no_crash' } },
    { id: 'kg-rel-2', category: 'knowledge_crud', difficulty: 'medium', description: 'Store relationship: created_by',
      tool: 'store_relationship', args: {
        headText: 'BenchmarkFixtureTest', headType: 'Concept',
        tailText: 'TestUser', tailType: 'Person',
        type: 'CREATED_BY', fact: 'Test was created by user',
      }, validation: { type: 'no_crash' } },

    // Query knowledge
    { id: 'kg-query-type', category: 'knowledge_crud', difficulty: 'easy', description: 'Query knowledge by type',
      tool: 'query_knowledge', args: { type: 'Concept', limit: 10 },
      validation: { type: 'no_crash' } },
    { id: 'kg-query-text', category: 'knowledge_crud', difficulty: 'easy', description: 'Query knowledge by text',
      tool: 'query_knowledge', args: { textContains: 'Benchmark', limit: 10 },
      validation: { type: 'no_crash' } },

    // Recall
    { id: 'kg-recall-1', category: 'knowledge_crud', difficulty: 'medium', description: 'Recall: benchmark',
      tool: 'recall', args: { text: 'benchmark fixture test' },
      validation: { type: 'no_crash' } },
    { id: 'kg-recall-2', category: 'knowledge_crud', difficulty: 'medium', description: 'Recall with type',
      tool: 'recall', args: { text: 'test', type: 'Concept', limit: 5 },
      validation: { type: 'no_crash' } },

    // Decay and prune
    { id: 'kg-decay', category: 'knowledge_crud', difficulty: 'easy', description: 'Decay knowledge',
      tool: 'decay_and_prune', args: { prune: false, decayRate: 0.01 },
      validation: { type: 'no_crash' } },

    // Store fact (requires LLM)
    { id: 'kg-fact', category: 'knowledge_crud', difficulty: 'hard', description: 'Store fact (LLM)',
      tool: 'store_fact', args: { text: 'The benchmark suite tests all 29 MCP tools for correctness.' },
      validation: { type: 'no_crash' }, requiresLlm: true },

    // Ingest conversation (requires LLM)
    { id: 'kg-ingest', category: 'knowledge_crud', difficulty: 'hard', description: 'Ingest conversation (LLM)',
      tool: 'ingest_conversation', args: {
        text: 'User: What tools are tested?\nAssistant: All 29 raw tools and 5 persona tools.',
        format: 'chat',
      }, validation: { type: 'no_crash' }, requiresLlm: true },

    // Query knowledge - list all (acts as list_entities)
    { id: 'kg-list', category: 'knowledge_crud', difficulty: 'easy', description: 'List all entities',
      tool: 'query_knowledge', args: { limit: 10 },
      validation: { type: 'no_crash' } },

    // Recall specific entity (acts as retrieve_entity)
    { id: 'kg-retrieve', category: 'knowledge_crud', difficulty: 'easy', description: 'Retrieve specific entity',
      tool: 'recall', args: { text: 'BenchmarkFixtureTest', type: 'Concept', limit: 1 },
      validation: { type: 'no_crash' } },
  );

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

  const SN_GENERIC = new Set(['resolve', 'complex', 'build', 'handle', 'parse', 'check', 'init',
    'create', 'update', 'delete', 'render', 'fetch', 'load', 'save', 'find', 'match', 'format',
    'validate', 'convert', 'process', 'extract', 'generate', 'normalize', 'transform', 'merge',
    'function', 'class', 'type', 'interface', 'variable', 'component', 'module', 'file', 'node',
    'context', 'search', 'query', 'result', 'index', 'entity', 'config', 'schema', 'model',
    'event', 'state', 'input', 'output', 'value', 'error', 'param', 'response', 'request',
    'operations', 'relationship', 'service', 'handler', 'pipeline', 'register',
    'refactoring', 'cleanup', 'exported', 'languages', 'traversal', 'schedules']);
  const snPartialCandidates = d.functions.filter(f => {
    const kw = bestKeyword(f.name);
    if (!kw || kw.length < 5 || SN_GENERIC.has(kw.toLowerCase())) return false;
    // Dynamic check: skip keywords that match too many functions (ambiguous ranking)
    const kwLower = kw.toLowerCase();
    const matchCount = d.functions.filter(fn => fn.name.toLowerCase().includes(kwLower)).length;
    return matchCount <= 3;
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

  // ─── SEARCH FILTERS (type filters: file, function, class, interface) ──

  // Search with type=function
  const sfFuncs = sample(d.functions, 10, SEED + 30);
  for (let i = 0; i < sfFuncs.length; i++) {
    const fn = sfFuncs[i];
    tests.push({
      id: `sf-func-${i}`, category: 'search_filters', difficulty: 'easy',
      description: `search type=function: "${fn.name}"`,
      tool: 'search', args: { query: fn.name, type: 'function', limit: 10 },
      expectedSymbols: [fn.name],
      validation: { type: 'top_k', maxRank: 5 },
    });
  }

  // Search with type=class
  const sfClasses = sample(d.classes, 10, SEED + 31);
  for (let i = 0; i < sfClasses.length; i++) {
    const cls = sfClasses[i];
    tests.push({
      id: `sf-class-${i}`, category: 'search_filters', difficulty: 'easy',
      description: `search type=class: "${cls.name}"`,
      tool: 'search', args: { query: cls.name, type: 'class', limit: 10 },
      expectedSymbols: [cls.name],
      validation: { type: 'top_k', maxRank: 5 },
    });
  }

  // Search with type=interface
  const sfIfaces = sample(d.interfaces, Math.min(10, d.interfaces.length), SEED + 32);
  for (let i = 0; i < sfIfaces.length; i++) {
    const iface = sfIfaces[i];
    tests.push({
      id: `sf-iface-${i}`, category: 'search_filters', difficulty: 'easy',
      description: `search type=interface: "${iface.name}"`,
      tool: 'search', args: { query: iface.name, type: 'interface', limit: 10 },
      expectedSymbols: [iface.name],
      validation: { type: 'top_k', maxRank: 5 },
    });
  }

  // Search with type=file
  const sfFiles = sample(d.filesWithFunctions, 10, SEED + 33);
  for (let i = 0; i < sfFiles.length; i++) {
    const f = sfFiles[i];
    const base = fileBasename(f.filePath).replace(/\.[^.]+$/, '');
    tests.push({
      id: `sf-file-${i}`, category: 'search_filters', difficulty: 'medium',
      description: `search type=file: "${base}"`,
      tool: 'search', args: { query: base, type: 'file', limit: 10 },
      expectedFiles: [fileBasename(f.filePath)],
      validation: { type: 'has_results' },
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
  // Use distinctive keywords (7+ chars) to avoid generic matches flooding results
  const GENERIC_KEYWORDS = new Set(['context', 'project', 'knowledge', 'relationship', 'internal',
    'content', 'function', 'service', 'handler', 'config', 'module', 'object', 'default', 'options',
    'resolve', 'complex', 'remove', 'create', 'update', 'delete', 'result', 'response', 'request',
    'process', 'element', 'schema', 'index', 'build', 'component', 'entities', 'extract', 'import',
    'export', 'render', 'transform', 'generate', 'validate', 'convert', 'analyze', 'display',
    'property', 'properties', 'register', 'document', 'pipeline', 'dataflow', 'operations',
    'relationships', 'answer', 'message', 'template', 'variable', 'interface', 'callback',
    'refactoring', 'traversal', 'navigation', 'staleness', 'extraction', 'embedding',
    'complexity', 'vulnerability', 'automation', 'sidebar', 'dropdown', 'separator',
    'contains', 'connect', 'dispatch', 'trigger', 'loading', 'parsing', 'building',
    'impact', 'changes', 'returns', 'settings', 'storage', 'wrapper', 'provider',
    'extension', 'language', 'aliases', 'episode', 'controls', 'calculate',
    'security', 'markdown', 'approval', 'sanitizer', 'sanitizers', 'history',
    'pattern', 'declaration', 'notifications', 'generic', 'normalize', 'scoring',
    'parsing', 'logging', 'caching', 'execute', 'dispatch', 'testing',
    'payload', 'implements', 'explanation', 'imports', 'payment', 'resolution',
    'analytics', 'dashboard', 'timestamped', 'declarator', 'conversation',
    'callers', 'mission', 'missions', 'exported', 'languages', 'schedules',
    'cleanup', 'traversal', 'dependency', 'extends', 'strategy', 'strategies']);
  const ftPartialCandidates = d.functions.filter(f => {
    const kw = bestKeyword(f.name);
    if (!kw || kw.length < 7 || GENERIC_KEYWORDS.has(kw.toLowerCase())) return false;
    // Dynamic check: skip keywords that match too many functions (ambiguous ranking)
    const kwLower = kw.toLowerCase();
    const matchCount = d.functions.filter(fn => fn.name.toLowerCase().includes(kwLower)).length;
    return matchCount <= 3;
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
      validation: { type: 'top_k', maxRank: 20 },
    });
  }

  // Fulltext multi-word (20 tests)
  // For each file, find a function whose name contains a word from the file-derived query.
  // If none match, validate that the file itself appears in results.
  const ftMulti = sample(d.filesWithFunctions.filter(f => {
    if (f.funcs.length === 0 || isGenericFilename(f.filePath)) return false;
    const q = filenameToQuery(f.filePath);
    // Require multi-word queries (single words are too generic)
    return q.split(/\s+/).filter(w => w.length >= 3).length >= 2;
  }), 20, SEED + 6);
  for (let i = 0; i < ftMulti.length; i++) {
    const file = ftMulti[i];
    const fileQuery = filenameToQuery(file.filePath);
    if (fileQuery.length < 4) continue;
    const queryWords = fileQuery.toLowerCase().split(/\s+/);
    const relevantWords = queryWords.filter(w => w.length >= 3);
    // Find a function whose name contains ALL query words (strongest match)
    const matchingFn = file.funcs.find(fn =>
      relevantWords.every(w => fn.toLowerCase().includes(w))
    );
    if (matchingFn) {
      tests.push({
        id: `ft-multi-${i}`, category: 'search_fulltext', difficulty: 'hard',
        description: `fulltext multi: "${fileQuery}" → ${matchingFn}`,
        tool: 'search_code', args: { query: fileQuery, type: 'fulltext' },
        expectedSymbols: [matchingFn], expectedFiles: [fileBasename(file.filePath)],
        validation: { type: 'top_k', maxRank: 10 },
      });
    }
    // Skip files where no function matches all query words — file-based fallback
    // is too unreliable (other files may have better-matching functions)
  }

  // ─── SEARCH STRATEGIES (search_code with strategy param) ──────────────

  const stratFuncs = sample(d.functions, 5, SEED + 40);
  const strategies = ['SMART_SEARCH', 'HYBRID', 'GRAPH_ANSWER', 'CONTEXT_WALK'];
  for (let i = 0; i < stratFuncs.length; i++) {
    const fn = stratFuncs[i];
    for (const strategy of strategies) {
      tests.push({
        id: `strat-${strategy.toLowerCase().replace(/_/g, '')}-${i}`,
        category: 'search_strategies', difficulty: 'medium',
        description: `${strategy}: "${fn.name}"`,
        tool: 'search_code', args: { query: fn.name, strategy },
        expectedSymbols: [fn.name],
        validation: { type: 'has_results' },
      });
    }
  }

  // search_code with scope filter
  if (d.filesWithFunctions.length > 0) {
    const scopePath = d.filesWithFunctions[0].filePath.split('/').slice(0, -1).join('/');
    const scopeFn = d.filesWithFunctions[0].funcs[0];
    tests.push({
      id: 'strat-scoped', category: 'search_strategies', difficulty: 'medium',
      description: `Scoped search: "${scopeFn}" in ${fileBasename(scopePath)}`,
      tool: 'search_code', args: { query: scopeFn, scope: scopePath },
      expectedSymbols: [scopeFn],
      validation: { type: 'has_results' },
    });
  }

  // search_code with language filter
  tests.push(
    { id: 'strat-lang-ts', category: 'search_strategies', difficulty: 'medium',
      description: 'Language filter: typescript',
      tool: 'search_code', args: { query: 'function', language: 'typescript' },
      validation: { type: 'has_results' } },
    { id: 'strat-lang-js', category: 'search_strategies', difficulty: 'medium',
      description: 'Language filter: javascript',
      tool: 'search_code', args: { query: 'module', language: 'javascript' },
      validation: { type: 'no_crash' } },
  );

  // ─── SEMANTIC (40 tests, requires embeddings) ─────────────────────────

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

  // Semantic file-based tests: find a function whose name relates to the file-derived query
  const semFile = sample(d.filesWithFunctions.filter(f => f.filePath && filenameToQuery(f.filePath).length >= 5 && !isGenericFilename(f.filePath)), 20, SEED + 8);
  for (let i = 0; i < semFile.length; i++) {
    const file = semFile[i];
    const query = filenameToQuery(file.filePath);
    const queryWords = query.toLowerCase().split(/\s+/);
    // Find a function whose name contains ALL query words (strongest match)
    const semRelevantWords = queryWords.filter(w => w.length >= 3);
    const matchingFn = file.funcs.find(fn =>
      semRelevantWords.every(w => fn.toLowerCase().includes(w))
    );
    if (matchingFn) {
      tests.push({
        id: `sem-file-${i}`, category: 'search_semantic', difficulty: 'medium',
        description: `semantic: "${query}" → ${matchingFn}`,
        tool: 'search_code', args: { query, type: 'semantic' },
        expectedSymbols: [matchingFn], expectedFiles: [fileBasename(file.filePath)],
        validation: { type: 'top_k', maxRank: 10 },
        requiresEmbeddings: true,
      });
    } else {
      // No name-matching function — just validate file appears
      tests.push({
        id: `sem-file-${i}`, category: 'search_semantic', difficulty: 'medium',
        description: `semantic: "${query}" → file ${fileBasename(file.filePath)}`,
        tool: 'search_code', args: { query, type: 'semantic' },
        expectedFiles: [fileBasename(file.filePath)],
        validation: { type: 'found' },
        requiresEmbeddings: true,
      });
    }
  }

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
      // Don't set expectedSymbols — context returns all entities in a file,
      // ranking position of a specific function is not meaningful
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
      validation: { type: 'edge_exists', callerName: edge.caller },
    });
  }

  // ─── CROSS-FILE CONTAINS (30 tests) ───────────────────────────────────

  // Filter out generic filenames that match too many files (index.ts, api.ts, etc.)
  const xfContains = sample(d.filesWithFunctions.filter(f => !isGenericFilename(f.filePath)), 30, SEED + 16);
  for (let i = 0; i < xfContains.length; i++) {
    const file = xfContains[i];
    const base = fileBasename(file.filePath);
    tests.push({
      id: `xf-contains-${i}`, category: 'cross_file_contains', difficulty: 'easy',
      description: `CONTAINS: ${base} → ${file.funcs[0]}`,
      tool: 'query',
      args: { cypher: `MATCH (f:File)-[:CONTAINS]->(fn:Function) WHERE f.filePath ENDS WITH '/${base.replace(/'/g, "\\'")}' RETURN fn.name as name LIMIT 30` },
      validation: { type: 'contains_entity', entityName: file.funcs[0] },
    });
  }

  // ─── RAW QUERY (IMPORTS, EXTENDS, IMPLEMENTS edges) ───────────────────

  // IMPORTS edges
  const rqImports = sample(d.importEdges, Math.min(10, d.importEdges.length), SEED + 50);
  for (let i = 0; i < rqImports.length; i++) {
    const edge = rqImports[i];
    const importerBase = fileBasename(edge.importer);
    const importedBase = fileBasename(edge.imported);
    tests.push({
      id: `rq-import-${i}`, category: 'raw_query', difficulty: 'medium',
      description: `IMPORTS: ${importerBase} → ${importedBase}`,
      tool: 'query',
      args: { cypher: `MATCH (a:File)-[:IMPORTS]->(b:File) WHERE a.filePath CONTAINS '${importerBase.replace(/'/g, "\\'")}' RETURN b.filePath as filePath LIMIT 10` },
      expectedFiles: [importedBase],
      validation: { type: 'has_results' },
    });
  }

  // EXTENDS edges
  const rqExtends = sample(d.extendsEdges, Math.min(10, d.extendsEdges.length), SEED + 51);
  for (let i = 0; i < rqExtends.length; i++) {
    const edge = rqExtends[i];
    tests.push({
      id: `rq-extends-${i}`, category: 'raw_query', difficulty: 'medium',
      description: `EXTENDS: ${edge.child} → ${edge.parent}`,
      tool: 'query',
      args: { cypher: `MATCH (child)-[:EXTENDS]->(parent) WHERE parent.name = '${edge.parent.replace(/'/g, "\\'")}' RETURN child.name as name LIMIT 10` },
      validation: { type: 'contains_entity', entityName: edge.child },
    });
  }

  // IMPLEMENTS edges
  const rqImpl = sample(d.implementsEdges, Math.min(10, d.implementsEdges.length), SEED + 52);
  for (let i = 0; i < rqImpl.length; i++) {
    const edge = rqImpl[i];
    tests.push({
      id: `rq-implements-${i}`, category: 'raw_query', difficulty: 'medium',
      description: `IMPLEMENTS: ${edge.cls} → ${edge.iface}`,
      tool: 'query',
      args: { cypher: `MATCH (c)-[:IMPLEMENTS]->(i) WHERE i.name = '${edge.iface.replace(/'/g, "\\'")}' RETURN c.name as name LIMIT 10` },
      validation: { type: 'contains_entity', entityName: edge.cls },
    });
  }

  // Node type distribution
  tests.push({
    id: 'rq-node-types', category: 'raw_query', difficulty: 'easy',
    description: 'Node type distribution',
    tool: 'query',
    args: { cypher: "MATCH (n) RETURN labels(n)[0] as type, count(n) as cnt ORDER BY cnt DESC" },
    validation: { type: 'has_results' },
  });

  // Edge type distribution
  tests.push({
    id: 'rq-edge-types', category: 'raw_query', difficulty: 'easy',
    description: 'Edge type distribution',
    tool: 'query',
    args: { cypher: "MATCH ()-[r]->() RETURN type(r) as relType, count(r) as cnt ORDER BY cnt DESC" },
    validation: { type: 'has_results' },
  });

  // ─── MULTI-HOP (20 tests) ─────────────────────────────────────────────

  const mhChains = sample(d.multiHopChains, Math.min(20, d.multiHopChains.length), SEED + 17);
  for (let i = 0; i < mhChains.length; i++) {
    const chain = mhChains[i];
    tests.push({
      id: `mh-${i}`, category: 'multi_hop', difficulty: 'hard',
      description: `2-hop: ${chain.start.slice(0, 15)} → ${chain.mid.slice(0, 15)} → ${chain.end.slice(0, 15)}`,
      tool: 'query',
      args: { cypher: `MATCH (a:Function)-[:CALLS*1..2]->(c:Function) WHERE c.name = '${chain.end.replace(/'/g, "\\'")}' RETURN DISTINCT a.name as name LIMIT 20` },
      validation: { type: 'found', entityName: chain.start },
    });
  }

  // ─── MULTI-REPO ───────────────────────────────────────────────────────

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

  // ─── PERSONA TOOLS (5 persona tools with action dispatch) ─────────────

  // Persona: search
  tests.push(
    { id: 'persona-search-find', category: 'persona', difficulty: 'easy',
      description: 'Persona search: find',
      tool: 'search', args: { action: 'find', query: d.functions[0]?.name ?? 'main', type: 'function' },
      validation: { type: 'has_results' } },
    { id: 'persona-search-context', category: 'persona', difficulty: 'easy',
      description: 'Persona search: context',
      tool: 'search', args: { action: 'context', file: d.filesWithFunctions[0]?.filePath ?? 'index.ts' },
      validation: { type: 'has_results' } },
    { id: 'persona-search-map', category: 'persona', difficulty: 'easy',
      description: 'Persona search: map',
      tool: 'search', args: { action: 'map', maxTokens: 2048 },
      validation: { type: 'has_results' } },
  );

  // Persona: analyze
  tests.push(
    { id: 'persona-analyze-impact', category: 'persona', difficulty: 'medium',
      description: 'Persona analyze: impact',
      tool: 'analyze', args: { action: 'impact', symbol: d.functions[0]?.name ?? 'main' },
      validation: { type: 'no_crash' } },
    { id: 'persona-analyze-vuln', category: 'persona', difficulty: 'medium',
      description: 'Persona analyze: vulnerabilities',
      tool: 'analyze', args: { action: 'vulnerabilities' },
      validation: { type: 'no_crash' } },
    { id: 'persona-analyze-complexity', category: 'persona', difficulty: 'medium',
      description: 'Persona analyze: complexity',
      tool: 'analyze', args: { action: 'complexity', threshold: 5 },
      validation: { type: 'no_crash' } },
  );

  if (d.refactoringFiles.length > 0) {
    tests.push({
      id: 'persona-analyze-refactoring', category: 'persona', difficulty: 'medium',
      description: 'Persona analyze: refactoring',
      tool: 'analyze', args: { action: 'refactoring', file: d.refactoringFiles[0].filePath },
      validation: { type: 'no_crash' },
    });
  }

  if (d.functions.length > 0) {
    tests.push({
      id: 'persona-analyze-history', category: 'persona', difficulty: 'medium',
      description: 'Persona analyze: history',
      tool: 'analyze', args: { action: 'history', symbol: d.functions[0].name },
      validation: { type: 'no_crash' },
    });
  }

  // Persona: knowledge
  tests.push(
    { id: 'persona-kg-store', category: 'persona', difficulty: 'easy',
      description: 'Persona knowledge: store_entity',
      tool: 'knowledge', args: { action: 'store_entity', text: 'PersonaTestEntity', type: 'Test' },
      validation: { type: 'no_crash' } },
    { id: 'persona-kg-query', category: 'persona', difficulty: 'easy',
      description: 'Persona knowledge: query',
      tool: 'knowledge', args: { action: 'query', type: 'Test', limit: 5 },
      validation: { type: 'no_crash' } },
    { id: 'persona-kg-recall', category: 'persona', difficulty: 'medium',
      description: 'Persona knowledge: recall',
      tool: 'knowledge', args: { action: 'recall', text: 'persona test' },
      validation: { type: 'no_crash' } },
    { id: 'persona-kg-stats', category: 'persona', difficulty: 'easy',
      description: 'Persona knowledge: stats',
      tool: 'knowledge', args: { action: 'stats' },
      validation: { type: 'no_crash' } },
    { id: 'persona-kg-maintain', category: 'persona', difficulty: 'easy',
      description: 'Persona knowledge: maintain',
      tool: 'knowledge', args: { action: 'maintain' },
      validation: { type: 'no_crash' } },
  );

  // Persona: codebase
  tests.push(
    { id: 'persona-codebase-status', category: 'persona', difficulty: 'easy',
      description: 'Persona codebase: status',
      tool: 'codebase', args: { action: 'status' },
      validation: { type: 'has_results' } },
    { id: 'persona-codebase-stats', category: 'persona', difficulty: 'easy',
      description: 'Persona codebase: stats',
      tool: 'codebase', args: { action: 'stats' },
      validation: { type: 'has_results' } },
    { id: 'persona-codebase-ping', category: 'persona', difficulty: 'easy',
      description: 'Persona codebase: ping',
      tool: 'codebase', args: { action: 'ping' },
      validation: { type: 'no_crash' } },
  );

  if (d.filesWithFunctions.length > 0) {
    tests.push({
      id: 'persona-codebase-source', category: 'persona', difficulty: 'easy',
      description: 'Persona codebase: source',
      tool: 'codebase', args: { action: 'source', path: d.filesWithFunctions[0].filePath },
      validation: { type: 'has_results' },
    });
  }

  // Persona: query
  tests.push(
    { id: 'persona-query-cypher', category: 'persona', difficulty: 'medium',
      description: 'Persona query: raw Cypher',
      tool: 'query', args: { cypher: "MATCH (f:Function) RETURN f.name as name LIMIT 5" },
      validation: { type: 'has_results' } },
  );

  return tests;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('═'.repeat(80));
  console.log('  Benchmark Fixture Generator (v2 — Full Tool Coverage)');
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

  // Count tools used
  const byTool = new Map<string, number>();
  for (const t of tests) byTool.set(t.tool, (byTool.get(t.tool) ?? 0) + 1);
  console.log('  Tools covered:');
  for (const [tool, count] of [...byTool.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${tool.padEnd(30)} ${count}`);
  }
  console.log(`\n  Unique tools: ${byTool.size}\n`);

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
