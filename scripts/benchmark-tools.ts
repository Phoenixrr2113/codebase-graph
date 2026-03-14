#!/usr/bin/env npx tsx
/**
 * Benchmark: Raw MCP Tool Suite — Dynamic Multi-Repo Evaluation
 *
 * Discovers ground truth from the indexed graph, then generates and runs
 * tests dynamically. Works with ANY indexed codebase(s).
 *
 * Phase 1: Discovery — query graph for functions, classes, files, relationships
 * Phase 2: Generate — build test cases from discovered entities
 * Phase 3: Run — execute tests, measure Top-K precision, MRR, latency
 *
 * Results saved to scripts/benchmark-results/<label>-<timestamp>.json
 *
 * Usage:
 *   pnpm build && npx tsx scripts/benchmark-tools.ts [label] [flags]
 *
 * Flags:
 *   --reindex          Re-index codebase-graph before running
 *   --embeddings       Enable local embeddings for vector search
 *   --include-llm      Include LLM-dependent tools
 *   --index-projects   Index external projects from ~/Desktop/projects
 *   --from-fixtures    Load test cases from benchmark-fixtures.json instead of dynamic generation
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';

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

const { getGraphClient, closeGraphClient, indexProject, registerPlugins } =
  await import('../packages/core/dist/index.js');
const { handleToolCall } = await import('../packages/mcp-server/dist/tools/consolidated.js');
const { warmupEmbedding } = await import('../packages/plugin-nlp/dist/index.js');

const args = process.argv.slice(2);
const reindex = args.includes('--reindex');
const useEmbeddings = args.includes('--embeddings');
const includeLlm = args.includes('--include-llm');
const indexExternalProjects = args.includes('--index-projects');
const fromFixtures = args.includes('--from-fixtures');
const label = args.filter(a => !a.startsWith('--'))[0] ?? 'unlabeled';

const PROJECTS_DIR = '/path/to/user/Desktop/projects';
const EXTERNAL_PROJECTS = [
  'LightRAG', 'cognee', 'graphiti', 'crewAI-main', 'bolt.new-main',
  'openclaw', 'qwik', 'screenshot-to-code-main', 'openui', 'code-gen',
  'context-engine', 'Next-js-Boilerplate-main', 'banking-main',
  'figma_clone-main', 'novel-main',
];

// ============================================================================
// Types
// ============================================================================

type TestCategory =
  | 'find_symbol' | 'search_name' | 'search_fulltext' | 'search_semantic'
  | 'search_cross_mode' | 'fuzzy_typo' | 'adversarial' | 'get_context'
  | 'impact_analysis' | 'complexity' | 'cross_file' | 'multi_repo'
  | 'operational'
  // Fixture-based categories
  | 'search_exact' | 'search_partial' | 'context_file' | 'context_symbol'
  | 'impact' | 'cross_file_calls' | 'cross_file_contains' | 'multi_hop'
  // New v2 fixture categories
  | 'config' | 'reindex' | 'refactoring' | 'dataflow' | 'history'
  | 'explain' | 'ask_code' | 'nl_to_cypher' | 'knowledge_crud'
  | 'vulnerabilities' | 'source' | 'repo_map'
  | 'search_filters' | 'search_strategies' | 'raw_query' | 'persona';

interface TestCase {
  id: string;
  tool: string;
  description: string;
  args: Record<string, unknown>;
  category: TestCategory;
  difficulty: 'easy' | 'medium' | 'hard';
  requiresLlm?: boolean;
  requiresEmbeddings?: boolean;
  requiresMultiRepo?: boolean;
  expectedSymbols?: string[];
  expectedFiles?: string[];
  validate: (result: Record<string, unknown>) => string | null;
}

interface SearchResult {
  name?: string; kind?: string; file?: string; filePath?: string;
  line?: number; score?: number;
}
interface ContextEntity { name?: string; type?: string; filePath?: string; }
interface ImpactCaller { name?: string; file?: string; }
interface ComplexityHotspot { name?: string; file?: string; complexity?: number; }

interface TestResult {
  id: string; tool: string; description: string;
  category: TestCategory; difficulty: 'easy' | 'medium' | 'hard';
  latencyMs: number; passed: boolean; error?: string; resultSize: number;
  topK?: {
    top1: boolean; top3: boolean; top5: boolean;
    reciprocalRank: number; foundAt?: number;
    expectedSymbols: string[]; actualTop5: string[];
  };
  topKFiles?: {
    top1: boolean; top3: boolean; top5: boolean;
    reciprocalRank: number; expectedFiles: string[]; actualTop5: string[];
  };
}

// ============================================================================
// Discovered ground truth — populated in Phase 1
// ============================================================================

interface DiscoveredEntity {
  name: string;
  filePath: string;
  kind: string; // Function, Class, Interface, Variable
  project?: string;
}

interface DiscoveredRelationship {
  callerName: string;
  calleeName: string;
}

interface DiscoveredFile {
  filePath: string;
  functionCount: number;
  functions: string[];
}

interface GroundTruth {
  functions: DiscoveredEntity[];
  classes: DiscoveredEntity[];
  filesWithFunctions: DiscoveredFile[];
  callEdges: DiscoveredRelationship[];
  projects: Array<{ name: string; rootPath: string }>;
  totalNodes: number;
  totalFunctions: number;
  totalFiles: number;
}

// ============================================================================
// Helpers
// ============================================================================

function extractNames(result: Record<string, unknown>, tool: string): string[] {
  if (tool === 'find_symbol') {
    const sym = result.symbol as SearchResult | undefined;
    if (sym?.name) return [sym.name];
    const alts = result.alternatives as SearchResult[] | undefined;
    if (alts) return alts.map(a => a.name).filter(Boolean) as string[];
    return [];
  }
  if (tool === 'search' || tool === 'search_code') {
    return ((result.results as SearchResult[]) ?? []).map(r => r.name).filter(Boolean) as string[];
  }
  if (tool === 'get_context') {
    const names: string[] = [];
    const entity = result.entity as ContextEntity | undefined;
    if (entity?.name) names.push(entity.name);
    const file = result.file as { entities?: ContextEntity[] } | undefined;
    if (file?.entities) for (const e of file.entities) if (e.name) names.push(e.name);
    return names;
  }
  if (tool === 'analyze_impact') {
    return ((result.directCallers as ImpactCaller[]) ?? []).map(c => c.name).filter(Boolean) as string[];
  }
  if (tool === 'query') {
    const data = result.data as Array<Record<string, unknown>> | undefined;
    if (!data) return [];
    return data.map(row => (row.name ?? row['n.name'] ?? row['f.name']) as string).filter(Boolean);
  }
  return [];
}

function extractFiles(result: Record<string, unknown>, tool: string): string[] {
  if (tool === 'search' || tool === 'search_code') {
    return ((result.results as SearchResult[]) ?? []).map(r => r.file ?? r.filePath).filter(Boolean) as string[];
  }
  if (tool === 'get_context') {
    const entity = result.entity as ContextEntity | undefined;
    if (entity?.filePath) return [entity.filePath];
    const file = result.file as { path?: string } | undefined;
    if (file?.path) return [file.path];
    return [];
  }
  if (tool === 'analyze_impact') return (result.affectedFiles as string[] | undefined) ?? [];
  return [];
}

function hasAny(actual: string[], expected: string[]): boolean {
  return expected.some(exp =>
    actual.some(a => a.toLowerCase().includes(exp.toLowerCase()) || exp.toLowerCase().includes(a.toLowerCase()))
  );
}

/** Generate a typo version of a name: swap two adjacent chars */
function makeTypo(name: string): string {
  if (name.length < 4) return name;
  // Find a good position to swap (not at camelCase boundary)
  const positions: number[] = [];
  for (let i = 1; i < name.length - 1; i++) {
    if (name[i] === name[i].toLowerCase() && name[i + 1] === name[i + 1].toLowerCase()) {
      positions.push(i);
    }
  }
  if (positions.length === 0) positions.push(1);
  const pos = positions[Math.floor(Math.random() * positions.length)];
  return name.slice(0, pos) + name[pos + 1] + name[pos] + name.slice(pos + 2);
}

/** Generate a partial query — take a substring of the name */
function makePartial(name: string): string {
  // Find camelCase word boundaries
  const parts: string[] = [];
  let current = '';
  for (const ch of name) {
    if (ch === ch.toUpperCase() && current.length > 0) {
      parts.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);

  // Return the most descriptive word (longest, not first which is usually a verb)
  if (parts.length > 1) {
    return parts.sort((a, b) => b.length - a.length)[0].toLowerCase();
  }
  // For snake_case or single words, take a meaningful substring
  if (name.includes('_')) {
    const snakeParts = name.split('_');
    return snakeParts.sort((a, b) => b.length - a.length)[0].toLowerCase();
  }
  return name.slice(0, Math.ceil(name.length * 0.6)).toLowerCase();
}

/** Pick N random items from array */
function sample<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

/** Get basename of a file path */
function fileBasename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

function computeTopK(expected: string[], actual: string[]) {
  const actualTop5 = actual.slice(0, 5);
  let foundAt: number | undefined;
  for (let i = 0; i < actual.length; i++) {
    const a = actual[i]?.toLowerCase() ?? '';
    if (expected.some(exp => a.includes(exp.toLowerCase()) || exp.toLowerCase().includes(a))) {
      foundAt = i + 1; break;
    }
  }
  return {
    top1: foundAt === 1, top3: foundAt !== undefined && foundAt <= 3,
    top5: foundAt !== undefined && foundAt <= 5,
    reciprocalRank: foundAt !== undefined ? 1 / foundAt : 0,
    foundAt, actualTop5,
  };
}

function computeTopKFiles(expected: string[], actual: string[]) {
  const actualTop5 = actual.slice(0, 5);
  let foundAt: number | undefined;
  for (let i = 0; i < actual.length; i++) {
    const a = actual[i]?.toLowerCase() ?? '';
    if (expected.some(exp => a.includes(exp.toLowerCase()))) { foundAt = i + 1; break; }
  }
  return {
    top1: foundAt === 1, top3: foundAt !== undefined && foundAt <= 3,
    top5: foundAt !== undefined && foundAt <= 5,
    reciprocalRank: foundAt !== undefined ? 1 / foundAt : 0, actualTop5,
  };
}

// ============================================================================
// Phase 1: Discover ground truth from the graph
// ============================================================================

async function discoverGroundTruth(client: any): Promise<GroundTruth> {
  console.log('Phase 1: Discovering ground truth from indexed graph...');

  // Get total counts
  const counts = await client.roQuery<{ type: string; cnt: number }>(
    "MATCH (n) RETURN labels(n)[0] as type, count(n) as cnt ORDER BY cnt DESC"
  );
  const totalNodes = counts.data.reduce((s: number, r: any) => s + r.cnt, 0);
  const totalFunctions = counts.data.find((r: any) => r.type === 'Function')?.cnt ?? 0;
  const totalFiles = counts.data.find((r: any) => r.type === 'File')?.cnt ?? 0;

  // Get projects
  const projResult = await client.roQuery<{ name: string; rootPath: string }>(
    "MATCH (p:Project) RETURN p.name as name, p.rootPath as rootPath"
  );
  const projects = projResult.data;

  // Get functions with unique names (avoid ambiguous ones)
  // Pick functions that have unique names so find_symbol can precisely match
  const funcResult = await client.roQuery<{ name: string; filePath: string; cnt: number }>(
    `MATCH (f:Function)
     WHERE f.name IS NOT NULL AND f.filePath IS NOT NULL
       AND size(f.name) > 3 AND NOT f.name STARTS WITH '_'
       AND NOT f.name IN ['constructor', 'render', 'default', 'init', 'setup', 'main', 'test']
     WITH f.name as name, collect(f.filePath)[0] as filePath, count(*) as cnt
     WHERE cnt = 1
     RETURN name, filePath, cnt
     ORDER BY size(name) DESC
     LIMIT 100`
  );
  const functions: DiscoveredEntity[] = funcResult.data.map((r: any) => ({
    name: r.name, filePath: r.filePath, kind: 'Function',
  }));

  // Get classes
  const classResult = await client.roQuery<{ name: string; filePath: string }>(
    `MATCH (c:Class)
     WHERE c.name IS NOT NULL AND c.filePath IS NOT NULL
       AND size(c.name) > 3 AND NOT c.name STARTS WITH '_'
     WITH c.name as name, collect(c.filePath)[0] as filePath, count(*) as cnt
     WHERE cnt = 1
     RETURN name, filePath
     ORDER BY size(name) DESC
     LIMIT 50`
  );
  const classes: DiscoveredEntity[] = classResult.data.map((r: any) => ({
    name: r.name, filePath: r.filePath, kind: 'Class',
  }));

  // Get files with their function counts
  const fileResult = await client.roQuery<{ filePath: string; cnt: number; funcs: string[] }>(
    `MATCH (f:File)-[:CONTAINS]->(fn:Function)
     WHERE fn.name IS NOT NULL
     WITH f.filePath as filePath, count(fn) as cnt, collect(fn.name)[0..5] as funcs
     WHERE cnt >= 2
     RETURN filePath, cnt, funcs
     ORDER BY cnt DESC
     LIMIT 50`
  );
  const filesWithFunctions: DiscoveredFile[] = fileResult.data.map((r: any) => ({
    filePath: r.filePath, functionCount: r.cnt, functions: r.funcs,
  }));

  // Get CALLS edges
  const callResult = await client.roQuery<{ caller: string; callee: string }>(
    `MATCH (caller:Function)-[:CALLS]->(callee:Function)
     WHERE caller.name IS NOT NULL AND callee.name IS NOT NULL
       AND caller.name <> callee.name
     RETURN caller.name as caller, callee.name as callee
     LIMIT 100`
  );
  const callEdges: DiscoveredRelationship[] = callResult.data.map((r: any) => ({
    callerName: r.caller, calleeName: r.callee,
  }));

  console.log(`  Found: ${functions.length} unique functions, ${classes.length} classes,`);
  console.log(`         ${filesWithFunctions.length} files with 2+ functions, ${callEdges.length} CALLS edges`);
  console.log(`         ${projects.length} project(s), ${totalNodes} total nodes\n`);

  return { functions, classes, filesWithFunctions, callEdges, projects, totalNodes, totalFunctions, totalFiles };
}

// ============================================================================
// Phase 2: Generate test cases from ground truth
// ============================================================================

function generateTests(gt: GroundTruth, useEmbeddings: boolean): TestCase[] {
  const tests: TestCase[] = [];
  const hasMultiRepo = gt.projects.length > 1;

  // ─── OPERATIONAL (static, work with any codebase) ──────────────────────

  tests.push(
    {
      id: 'op-ping', tool: 'ping', description: 'Connectivity',
      args: {}, category: 'operational', difficulty: 'easy',
      validate: (r) => r.status === 'ok' ? null : `status=${r.status}`,
    },
    {
      id: 'op-index-status', tool: 'get_index_status', description: 'Index status',
      args: {}, category: 'operational', difficulty: 'easy',
      validate: (r) => {
        if (r.error) return `Error: ${r.error}`;
        if (typeof r.totalFiles !== 'number' || (r.totalFiles as number) < 1) return 'No files';
        return null;
      },
    },
    {
      id: 'op-stats', tool: 'get_stats', description: 'Graph stats',
      args: {}, category: 'operational', difficulty: 'easy',
      validate: (r) => r.error ? `Error: ${r.error}` : null,
    },
    {
      id: 'op-repo-map', tool: 'get_repo_map', description: 'Repo map',
      args: { maxTokens: 2048 }, category: 'operational', difficulty: 'easy',
      validate: (r) => {
        if (r.error) return `Error: ${r.error}`;
        const map = r.map as string;
        if (!map || map.length < 50) return 'Map too short';
        return null;
      },
    },
    {
      id: 'op-vuln', tool: 'find_vulnerabilities', description: 'Security scan',
      args: {}, category: 'operational', difficulty: 'easy',
      validate: (r) => r.error ? `Error: ${r.error}` : null,
    },
    {
      id: 'op-cx', tool: 'get_complexity_report', description: 'Complexity report',
      args: { threshold: 5 }, category: 'operational', difficulty: 'easy',
      validate: (r) => r.error ? `Error: ${r.error}` : null,
    },
    {
      id: 'op-kg-store', tool: 'store_entity', description: 'Store entity',
      args: { text: `BenchmarkTest_${Date.now()}`, type: 'Test' },
      category: 'operational', difficulty: 'easy',
      validate: (r) => r.error ? `Error: ${r.error}` : null,
    },
    {
      id: 'op-kg-stats', tool: 'get_knowledge_stats', description: 'KG stats',
      args: {}, category: 'operational', difficulty: 'easy',
      validate: (r) => r.error ? `Error: ${r.error}` : null,
    },
  );

  // Read source from a discovered file
  if (gt.filesWithFunctions.length > 0) {
    const f = gt.filesWithFunctions[0];
    tests.push({
      id: 'op-source', tool: 'get_source', description: `Read ${fileBasename(f.filePath)}`,
      args: { path: f.filePath, startLine: 1, endLine: 30 },
      category: 'operational', difficulty: 'easy',
      validate: (r) => {
        if (r.error) return `Error: ${r.error}`;
        const code = (r.code ?? r.source ?? r.content) as string;
        if (!code || code.length < 10) return 'No/empty code';
        return null;
      },
    });
  }

  // ─── FIND_SYMBOL — exact lookup (sample 12 functions + 4 classes) ──────

  const symbolSample = sample(gt.functions, 12);
  for (const fn of symbolSample) {
    tests.push({
      id: `fs-${fn.name.slice(0, 25)}`,
      tool: 'find_symbol',
      description: `find_symbol: ${fn.name}`,
      args: { name: fn.name },
      category: 'find_symbol', difficulty: 'easy',
      expectedSymbols: [fn.name],
      expectedFiles: [fileBasename(fn.filePath)],
      validate: (r) => {
        if (!r.found) return `Not found: ${fn.name}`;
        const sym = r.symbol as SearchResult;
        if (sym?.name !== fn.name) return `Wrong: ${sym?.name} (expected ${fn.name})`;
        return null;
      },
    });
  }

  const classSample = sample(gt.classes, 4);
  for (const cls of classSample) {
    tests.push({
      id: `fs-cls-${cls.name.slice(0, 22)}`,
      tool: 'find_symbol',
      description: `find_symbol class: ${cls.name}`,
      args: { name: cls.name, kind: 'class' },
      category: 'find_symbol', difficulty: 'easy',
      expectedSymbols: [cls.name],
      validate: (r) => {
        if (!r.found) return `Not found: ${cls.name}`;
        const sym = r.symbol as SearchResult;
        if (sym?.name !== cls.name) return `Wrong: ${sym?.name}`;
        return null;
      },
    });
  }

  // Not-found test
  tests.push({
    id: 'fs-notfound', tool: 'find_symbol', description: 'Not-found: graceful',
    args: { name: 'xyzNotARealSymbol_' + Date.now() },
    category: 'find_symbol', difficulty: 'easy',
    validate: (r) => (r.found === false || (r.error && String(r.error).includes('not found'))) ? null : 'Expected not-found',
  });

  // ─── NAME SEARCH — exact and partial name queries ──────────────────────

  // Exact name — should be Top-1
  const nameExactSample = sample(gt.functions, 6);
  for (const fn of nameExactSample) {
    tests.push({
      id: `sn-exact-${fn.name.slice(0, 22)}`,
      tool: 'search',
      description: `search exact: "${fn.name}"`,
      args: { query: fn.name, limit: 10 },
      category: 'search_name', difficulty: 'easy',
      expectedSymbols: [fn.name],
      validate: (r) => {
        if (r.error) return `Error: ${r.error}`;
        const results = r.results as SearchResult[];
        if (!results?.length) return 'No results';
        if (results[0]?.name !== fn.name) return `Top-1: ${results[0]?.name} (expected ${fn.name})`;
        return null;
      },
    });
  }

  // Partial name — extract keyword, should find original in Top-5
  const namePartialSample = sample(gt.functions.filter(f => f.name.length > 6), 6);
  for (const fn of namePartialSample) {
    const partial = makePartial(fn.name);
    if (partial.length < 3) continue; // Skip too-short partials
    tests.push({
      id: `sn-partial-${partial.slice(0, 20)}`,
      tool: 'search',
      description: `search partial: "${partial}" → ${fn.name}`,
      args: { query: partial, limit: 10 },
      category: 'search_name', difficulty: 'medium',
      expectedSymbols: [fn.name],
      validate: (r) => {
        if (r.error) return `Error: ${r.error}`;
        const results = r.results as SearchResult[];
        if (!results?.length) return 'No results';
        const top10 = results.slice(0, 10).map(x => x.name ?? '');
        if (!hasAny(top10, [fn.name]))
          return `"${fn.name}" not in Top-10 for "${partial}": [${top10.slice(0, 5).join(', ')}]`;
        return null;
      },
    });
  }

  // ─── FULLTEXT SEARCH — keyword search ──────────────────────────────────

  // Search by exact function name via fulltext — should find in Top-3
  const ftExactSample = sample(gt.functions, 6);
  for (const fn of ftExactSample) {
    tests.push({
      id: `ft-exact-${fn.name.slice(0, 22)}`,
      tool: 'search_code',
      description: `fulltext: "${fn.name}"`,
      args: { query: fn.name },
      category: 'search_fulltext', difficulty: 'easy',
      expectedSymbols: [fn.name],
      expectedFiles: [fileBasename(fn.filePath)],
      validate: (r) => {
        if (r.error) return `Error: ${r.error}`;
        const results = r.results as SearchResult[];
        if (!results?.length) return 'No results';
        const top5 = results.slice(0, 5).map(x => x.name ?? '');
        if (!hasAny(top5, [fn.name]))
          return `${fn.name} not in Top-5: [${top5.join(', ')}]`;
        return null;
      },
    });
  }

  // Fulltext partial — extract keyword from function name
  const ftPartialSample = sample(gt.functions.filter(f => f.name.length > 8), 6);
  for (const fn of ftPartialSample) {
    const keyword = makePartial(fn.name);
    if (keyword.length < 3) continue;
    tests.push({
      id: `ft-partial-${keyword.slice(0, 20)}`,
      tool: 'search_code',
      description: `fulltext partial: "${keyword}" → ${fn.name}`,
      args: { query: keyword, type: 'fulltext' },
      category: 'search_fulltext', difficulty: 'medium',
      expectedSymbols: [fn.name],
      validate: (r) => {
        if (r.error) return `Error: ${r.error}`;
        const results = r.results as SearchResult[];
        if (!results?.length) return 'No results';
        return null; // Just check it doesn't crash — ranking is measured via topK
      },
    });
  }

  // Multi-word fulltext — combine file basename + function name keyword
  const ftMultiSample = sample(gt.filesWithFunctions.filter(f => f.functions.length > 0), 4);
  for (const file of ftMultiSample) {
    const fnName = file.functions[0];
    const fileWord = fileBasename(file.filePath).replace(/\.[^.]+$/, '').toLowerCase();
    const query = `${fileWord} ${makePartial(fnName)}`;
    tests.push({
      id: `ft-multi-${fileWord.slice(0, 20)}`,
      tool: 'search_code',
      description: `fulltext multi: "${query}"`,
      args: { query, type: 'fulltext' },
      category: 'search_fulltext', difficulty: 'hard',
      expectedSymbols: [fnName],
      expectedFiles: [fileBasename(file.filePath)],
      validate: (r) => {
        if (r.error) return `Error: ${r.error}`;
        return null;
      },
    });
  }

  // ─── SEMANTIC SEARCH — natural language intent (requires embeddings) ───

  if (useEmbeddings) {
    // Semantic: search by exact name — baseline, should work at least as well as name search
    const semExactSample = sample(gt.functions, 6);
    for (const fn of semExactSample) {
      tests.push({
        id: `sem-exact-${fn.name.slice(0, 20)}`,
        tool: 'search_code',
        description: `semantic exact: "${fn.name}"`,
        args: { query: fn.name, type: 'semantic' },
        category: 'search_semantic', difficulty: 'easy',
        expectedSymbols: [fn.name],
        validate: (r) => {
          if (r.error) return `Error: ${r.error}`;
          const results = r.results as SearchResult[];
          if (!results?.length) return 'No results';
          const top5 = results.slice(0, 5).map(x => x.name ?? '');
          if (!hasAny(top5, [fn.name]))
            return `${fn.name} not in Top-5: [${top5.join(', ')}]`;
          return null;
        },
      });
    }

    // Semantic: search by partial / descriptive phrase
    // Use the file name context to build a natural language query
    const semPartialSample = sample(
      gt.filesWithFunctions.filter(f => f.functions.length > 0), 6
    );
    for (const file of semPartialSample) {
      const fnName = file.functions[0];
      const fileWord = fileBasename(file.filePath).replace(/\.[^.]+$/, '');
      // Make a descriptive query from the filename
      const words = fileWord
        .replace(/([A-Z])/g, ' $1')     // camelCase
        .replace(/[-_]/g, ' ')           // kebab/snake
        .toLowerCase().trim().split(/\s+/);
      const query = words.join(' ');
      if (query.length < 4) continue;

      tests.push({
        id: `sem-file-${fileWord.slice(0, 20)}`,
        tool: 'search_code',
        description: `semantic: "${query}" → ${fnName}`,
        args: { query, type: 'semantic' },
        category: 'search_semantic', difficulty: 'medium',
        expectedSymbols: [fnName],
        expectedFiles: [fileBasename(file.filePath)],
        validate: (r) => {
          if (r.error) return `Error: ${r.error}`;
          const results = r.results as SearchResult[];
          if (!results?.length) return 'No results';
          return null;
        },
      });
    }

    // Semantic hard: abstract intent phrases
    // We don't know what the code does, but we can test generic programming concepts
    const semanticGenericQueries = [
      { query: 'configuration and settings', desc: 'config/settings' },
      { query: 'error handling and exceptions', desc: 'error handling' },
      { query: 'logging and debugging', desc: 'logging' },
      { query: 'database connection and queries', desc: 'database' },
      { query: 'authentication and authorization', desc: 'auth' },
      { query: 'parsing and processing input data', desc: 'parsing' },
      { query: 'testing and validation', desc: 'testing' },
      { query: 'API endpoint handler', desc: 'API handler' },
    ];
    for (const { query, desc } of semanticGenericQueries) {
      tests.push({
        id: `sem-generic-${desc.replace(/\s+/g, '-').slice(0, 18)}`,
        tool: 'search_code',
        description: `semantic generic: "${query}"`,
        args: { query, type: 'semantic' },
        category: 'search_semantic', difficulty: 'hard',
        // No expected symbols — we just check it returns relevant-looking results
        validate: (r) => {
          if (r.error) return `Error: ${r.error}`;
          const results = r.results as SearchResult[];
          if (!results?.length) return 'No results for generic query';
          return null;
        },
      });
    }
  }

  // ─── CROSS-MODE COMPARISON — same query, all modes ─────────────────────

  // Pick 3 functions and test them across name/fulltext/semantic
  const crossModeSample = sample(gt.functions, 3);
  for (const fn of crossModeSample) {
    tests.push({
      id: `xm-name-${fn.name.slice(0, 18)}`,
      tool: 'search', description: `cross-mode name: "${fn.name}"`,
      args: { query: fn.name, limit: 10 },
      category: 'search_cross_mode', difficulty: 'easy',
      expectedSymbols: [fn.name],
      validate: (r) => {
        const results = r.results as SearchResult[];
        if (!results?.length) return 'No results';
        if (results[0]?.name !== fn.name) return `Top-1: ${results[0]?.name}`;
        return null;
      },
    });
    tests.push({
      id: `xm-ft-${fn.name.slice(0, 20)}`,
      tool: 'search_code', description: `cross-mode fulltext: "${fn.name}"`,
      args: { query: fn.name },
      category: 'search_cross_mode', difficulty: 'medium',
      expectedSymbols: [fn.name],
      validate: (r) => {
        const results = r.results as SearchResult[];
        if (!results?.length) return 'No results';
        const top5 = results.slice(0, 5).map(x => x.name ?? '');
        if (!hasAny(top5, [fn.name])) return `Not in Top-5: [${top5.join(', ')}]`;
        return null;
      },
    });
    if (useEmbeddings) {
      tests.push({
        id: `xm-sem-${fn.name.slice(0, 18)}`,
        tool: 'search_code', description: `cross-mode semantic: "${fn.name}"`,
        args: { query: fn.name, type: 'semantic' },
        category: 'search_cross_mode', difficulty: 'hard',
        requiresEmbeddings: true,
        expectedSymbols: [fn.name],
        validate: (r) => {
          const results = r.results as SearchResult[];
          if (!results?.length) return 'No results';
          const top10 = results.slice(0, 10).map(x => x.name ?? '');
          if (!hasAny(top10, [fn.name])) return `Not in Top-10: [${top10.slice(0, 5).join(', ')}]`;
          return null;
        },
      });
    }
  }

  // ─── FUZZY / TYPO — misspelled names ───────────────────────────────────

  const fuzzyBase = sample(gt.functions.filter(f => f.name.length > 6), 6);
  for (const fn of fuzzyBase) {
    const typo = makeTypo(fn.name);
    if (typo === fn.name) continue; // Skip if no change
    tests.push({
      id: `fz-${typo.slice(0, 24)}`,
      tool: 'search',
      description: `typo: "${typo}" → ${fn.name}`,
      args: { query: typo, limit: 10 },
      category: 'fuzzy_typo', difficulty: 'hard',
      expectedSymbols: [fn.name],
      validate: (r) => {
        if (r.error) return `Error: ${r.error}`;
        const results = r.results as SearchResult[];
        if (!results?.length) return `No results for typo "${typo}"`;
        const top5 = results.slice(0, 5).map(x => x.name ?? '');
        if (!hasAny(top5, [fn.name]))
          return `${fn.name} not in Top-5 for typo "${typo}": [${top5.join(', ')}]`;
        return null;
      },
    });
  }

  // ─── ADVERSARIAL — edge cases ──────────────────────────────────────────

  tests.push(
    {
      id: 'adv-empty', tool: 'search', description: 'Empty query',
      args: { query: '', limit: 5 }, category: 'adversarial', difficulty: 'easy',
      validate: () => null,
    },
    {
      id: 'adv-long', tool: 'search_code', description: 'Very long query',
      args: { query: 'find '.repeat(100), type: 'fulltext' },
      category: 'adversarial', difficulty: 'medium',
      validate: () => null,
    },
    {
      id: 'adv-special', tool: 'search', description: 'Special chars',
      args: { query: 'function(a: string[]): Promise<void>', limit: 5 },
      category: 'adversarial', difficulty: 'medium',
      validate: () => null,
    },
    {
      id: 'adv-injection', tool: 'search', description: 'Cypher injection',
      args: { query: "'; MATCH (n) DETACH DELETE n; //", limit: 5 },
      category: 'adversarial', difficulty: 'hard',
      validate: () => null,
    },
    {
      id: 'adv-unicode', tool: 'search', description: 'Unicode',
      args: { query: '日本語 🚀 test', limit: 5 },
      category: 'adversarial', difficulty: 'medium',
      validate: () => null,
    },
  );

  // ─── GET_CONTEXT — file and symbol context ─────────────────────────────

  // File context — pick files with known functions
  const ctxFileSample = sample(gt.filesWithFunctions, 4);
  for (const file of ctxFileSample) {
    const base = fileBasename(file.filePath);
    tests.push({
      id: `ctx-file-${base.slice(0, 22)}`,
      tool: 'get_context',
      description: `context file: ${base}`,
      args: { file: file.filePath, includeRelationships: true },
      category: 'get_context', difficulty: 'easy',
      expectedSymbols: [file.functions[0]],
      validate: (r) => {
        if (r.error) return `Error: ${r.error}`;
        const f = r.file as { entities?: ContextEntity[] };
        if (!f?.entities?.length) return 'No entities';
        const names = f.entities.map(e => e.name ?? '');
        if (!hasAny(names, [file.functions[0]]))
          return `Expected ${file.functions[0]} not in: [${names.slice(0, 10).join(', ')}]`;
        return null;
      },
    });
  }

  // Symbol context
  const ctxSymSample = sample(gt.functions, 4);
  for (const fn of ctxSymSample) {
    tests.push({
      id: `ctx-sym-${fn.name.slice(0, 22)}`,
      tool: 'get_context',
      description: `context symbol: ${fn.name}`,
      args: { symbol: fn.name, includeRelationships: true },
      category: 'get_context', difficulty: 'medium',
      expectedSymbols: [fn.name],
      validate: (r) => {
        if (r.error) return `Error: ${r.error}`;
        const json = JSON.stringify(r);
        if (json.length < 20) return 'Response too small';
        return null;
      },
    });
  }

  // ─── IMPACT ANALYSIS ───────────────────────────────────────────────────

  // Use functions that we KNOW have callers (from discovered CALLS edges)
  const calledFunctions = [...new Set(gt.callEdges.map(e => e.calleeName))];
  const impactWithCallers = sample(calledFunctions.slice(0, 20), Math.min(3, calledFunctions.length));
  for (const fnName of impactWithCallers) {
    tests.push({
      id: `imp-called-${fnName.slice(0, 20)}`,
      tool: 'analyze_impact',
      description: `impact (has callers): ${fnName}`,
      args: { symbol: fnName },
      category: 'impact_analysis', difficulty: 'medium',
      validate: (r) => {
        if (r.error) return `Error: ${r.error}`;
        if (r.riskScore === undefined) return 'No riskScore';
        const callers = r.directCallers as ImpactCaller[];
        if (!Array.isArray(callers) || callers.length === 0)
          return `Expected callers for ${fnName} (graph has CALLS edges) but got none`;
        return null;
      },
    });
  }

  // Impact for random functions (may or may not have callers)
  const impactRandom = sample(gt.functions, 3);
  for (const fn of impactRandom) {
    tests.push({
      id: `imp-${fn.name.slice(0, 24)}`,
      tool: 'analyze_impact',
      description: `impact: ${fn.name}`,
      args: { symbol: fn.name },
      category: 'impact_analysis', difficulty: 'easy',
      validate: (r) => {
        if (r.error) return `Error: ${r.error}`;
        if (r.riskScore === undefined) return 'No riskScore';
        return null;
      },
    });
  }

  // ─── COMPLEXITY ────────────────────────────────────────────────────────

  tests.push(
    {
      id: 'cx-low', tool: 'get_complexity_report', description: 'Hotspots threshold 5',
      args: { threshold: 5 }, category: 'complexity', difficulty: 'easy',
      validate: (r) => {
        if (r.error) return `Error: ${r.error}`;
        const h = r.hotspots as ComplexityHotspot[];
        if (!Array.isArray(h)) return 'No hotspots array';
        if (h.some(x => (x.complexity ?? 0) < 5)) return 'Below threshold';
        return null;
      },
    },
    {
      id: 'cx-high', tool: 'get_complexity_report', description: 'Hotspots threshold 15',
      args: { threshold: 15 }, category: 'complexity', difficulty: 'medium',
      validate: (r) => {
        if (r.error) return `Error: ${r.error}`;
        const h = r.hotspots as ComplexityHotspot[];
        if (!Array.isArray(h)) return 'No array';
        if (h.some(x => (x.complexity ?? 0) < 15)) return 'Below threshold';
        return null;
      },
    },
    {
      id: 'cx-sorted', tool: 'get_complexity_report', description: 'Sorted descending',
      args: { threshold: 3 }, category: 'complexity', difficulty: 'medium',
      validate: (r) => {
        const h = r.hotspots as ComplexityHotspot[];
        if (!Array.isArray(h) || h.length < 2) return null;
        for (let i = 1; i < h.length; i++) {
          if ((h[i]?.complexity ?? 0) > (h[i - 1]?.complexity ?? 0))
            return `Not sorted at ${i}`;
        }
        return null;
      },
    },
  );

  // ─── CROSS-FILE — relationship integrity ───────────────────────────────

  // Test CALLS edges we discovered
  const callSample = sample(gt.callEdges, Math.min(4, gt.callEdges.length));
  for (const edge of callSample) {
    tests.push({
      id: `xf-calls-${edge.calleeName.slice(0, 18)}`,
      tool: 'query',
      description: `CALLS: ${edge.callerName.slice(0, 15)} → ${edge.calleeName.slice(0, 15)}`,
      args: {
        cypher: `MATCH (caller:Function)-[:CALLS]->(callee:Function) WHERE callee.name = '${edge.calleeName}' RETURN caller.name as name LIMIT 10`,
      },
      category: 'cross_file', difficulty: 'medium',
      validate: (r) => {
        if (r.error) return `Error: ${r.error}`;
        const data = r.data as Array<{ name: string }>;
        if (!data?.length) return `No callers found for ${edge.calleeName}`;
        const names = data.map(d => d.name);
        if (!names.includes(edge.callerName))
          return `Expected caller ${edge.callerName} not in: [${names.join(', ')}]`;
        return null;
      },
    });
  }

  // File CONTAINS functions
  const containsSample = sample(gt.filesWithFunctions.filter(f => f.functions.length > 0), 3);
  for (const file of containsSample) {
    const base = fileBasename(file.filePath);
    tests.push({
      id: `xf-contains-${base.slice(0, 20)}`,
      tool: 'query',
      description: `CONTAINS: ${base} → ${file.functions[0]}`,
      args: {
        cypher: `MATCH (f:File)-[:CONTAINS]->(fn:Function) WHERE f.filePath CONTAINS '${base}' RETURN fn.name as name LIMIT 20`,
      },
      category: 'cross_file', difficulty: 'easy',
      expectedSymbols: [file.functions[0]],
      validate: (r) => {
        if (r.error) return `Error: ${r.error}`;
        const data = r.data as Array<{ name: string }>;
        if (!data?.length) return `No functions in ${base}`;
        const names = data.map(d => d.name);
        if (!names.includes(file.functions[0]))
          return `${file.functions[0]} not in: [${names.slice(0, 10).join(', ')}]`;
        return null;
      },
    });
  }

  // Node type counts — sanity check
  tests.push({
    id: 'xf-node-types', tool: 'query', description: 'Node type distribution',
    args: { cypher: "MATCH (n) RETURN labels(n)[0] as type, count(n) as cnt ORDER BY cnt DESC" },
    category: 'cross_file', difficulty: 'easy',
    validate: (r) => {
      if (r.error) return `Error: ${r.error}`;
      const data = r.data as Array<{ type: string; cnt: number }>;
      if (!data?.length) return 'No data';
      const types = data.map(d => d.type);
      if (!types.includes('Function')) return `No Function in: [${types.join(', ')}]`;
      if (!types.includes('File')) return `No File in: [${types.join(', ')}]`;
      return null;
    },
  });

  // ─── MULTI-REPO — only if multiple projects indexed ────────────────────

  if (hasMultiRepo) {
    tests.push(
      {
        id: 'mr-projects', tool: 'query', description: 'Count projects',
        args: { cypher: "MATCH (p:Project) RETURN p.name as name" },
        category: 'multi_repo', difficulty: 'easy', requiresMultiRepo: true,
        validate: (r) => {
          const data = r.data as Array<{ name: string }>;
          if (!data || data.length < 2) return `Only ${data?.length} project(s)`;
          return null;
        },
      },
      {
        id: 'mr-cross-search', tool: 'search', description: 'Search spans projects',
        args: { query: 'config', limit: 20 },
        category: 'multi_repo', difficulty: 'medium', requiresMultiRepo: true,
        validate: (r) => {
          const results = r.results as SearchResult[];
          if (!results?.length) return 'No results';
          const paths = results.map(x => x.file ?? x.filePath ?? '');
          const roots = new Set(paths.map(p => {
            const parts = p.split('/');
            return parts.length > 5 ? parts.slice(0, 6).join('/') : parts.slice(0, 3).join('/');
          }));
          if (roots.size < 2) return `Results from only ${roots.size} project(s)`;
          return null;
        },
      },
      {
        id: 'mr-total-files', tool: 'query', description: 'Total files across repos',
        args: { cypher: "MATCH (f:File) RETURN count(f) as total" },
        category: 'multi_repo', difficulty: 'easy', requiresMultiRepo: true,
        validate: (r) => {
          const data = r.data as Array<{ total: number }>;
          if (!data?.length || data[0].total < 50) return `Too few: ${data?.[0]?.total}`;
          return null;
        },
      },
    );
  }

  return tests;
}

// ============================================================================
// Fixture Loading (--from-fixtures mode)
// ============================================================================

interface FixtureValidation {
  type: 'no_crash' | 'has_results' | 'found' | 'top_k' | 'contains_entity'
    | 'has_callers' | 'edge_exists' | 'sorted_desc' | 'multi_project';
  maxRank?: number;
  entityName?: string;
  minCallers?: number;
}

interface FixtureTestCase {
  id: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  description: string;
  tool: string;
  args: Record<string, unknown>;
  expectedSymbols?: string[];
  expectedFiles?: string[];
  validation: FixtureValidation;
  requiresLlm?: boolean;
  requiresEmbeddings?: boolean;
  requiresMultiRepo?: boolean;
}

function fixtureValidationToFn(v: FixtureValidation, tc: FixtureTestCase): (result: Record<string, unknown>) => string | null {
  switch (v.type) {
    case 'no_crash':
      return () => null;

    case 'has_results':
      return (result) => {
        const str = JSON.stringify(result);
        return str.length > 10 ? null : 'Empty result';
      };

    case 'found':
      return (result) => {
        const expectedSyms = tc.expectedSymbols ?? [];
        const expectedFs = tc.expectedFiles ?? [];
        if (expectedSyms.length > 0) {
          const names = extractNames(result, tc.tool);
          if (hasAny(names, expectedSyms)) return null;
        }
        if (expectedFs.length > 0) {
          const files = extractFiles(result, tc.tool);
          if (hasAny(files, expectedFs)) return null;
        }
        if (expectedSyms.length === 0 && expectedFs.length === 0) {
          // No expectations — just check non-empty
          const str = JSON.stringify(result);
          return str.length > 10 ? null : 'Empty result';
        }
        const names = extractNames(result, tc.tool);
        return `Not found: syms=[${expectedSyms.join(', ')}] files=[${expectedFs.join(', ')}] in [${names.slice(0, 5).join(', ')}]`;
      };

    case 'top_k':
      return (result) => {
        const maxRank = v.maxRank ?? 5;
        const expectedSyms = tc.expectedSymbols ?? [];
        const expectedFs = tc.expectedFiles ?? [];
        if (expectedSyms.length > 0) {
          const names = extractNames(result, tc.tool);
          const top = names.slice(0, maxRank);
          if (hasAny(top, expectedSyms)) return null;
        }
        if (expectedFs.length > 0) {
          const files = extractFiles(result, tc.tool);
          const topFiles = files.slice(0, maxRank);
          if (hasAny(topFiles, expectedFs)) return null;
        }
        const names = extractNames(result, tc.tool);
        const top = names.slice(0, maxRank);
        const want = expectedSyms.length > 0 ? expectedSyms : expectedFs;
        return `Not in top-${maxRank}: want [${want.join(', ')}] got [${top.join(', ')}]`;
      };

    case 'contains_entity':
      return (result) => {
        const str = JSON.stringify(result);
        const name = v.entityName ?? '';
        return str.includes(name) ? null : `Result does not contain entity "${name}"`;
      };

    case 'has_callers':
      return (result) => {
        const str = JSON.stringify(result);
        const minCallers = v.minCallers ?? 1;
        // Check if we have callers/dependents in the result
        const callerMatches = str.match(/"name"/g);
        return (callerMatches?.length ?? 0) >= minCallers ? null : `Expected >= ${minCallers} callers`;
      };

    case 'edge_exists':
      return (result) => {
        const names = extractNames(result, tc.tool);
        const expected = tc.expectedSymbols ?? [];
        return hasAny(names, expected) ? null : `Edge not found: want [${expected.join(', ')}] in [${names.slice(0, 5).join(', ')}]`;
      };

    case 'sorted_desc':
      return (result) => {
        const str = JSON.stringify(result);
        const complexities = [...str.matchAll(/"complexity"\s*:\s*(\d+)/g)].map(m => parseInt(m[1]));
        if (complexities.length < 2) return null;
        for (let i = 1; i < complexities.length; i++) {
          if (complexities[i] > complexities[i - 1]) return 'Not sorted descending by complexity';
        }
        return null;
      };

    case 'multi_project':
      return (result) => {
        const str = JSON.stringify(result);
        const projects = [...str.matchAll(/"name"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
        return projects.length >= 2 ? null : `Found ${projects.length} projects, expected >= 2`;
      };

    default:
      return () => null;
  }
}

function loadFixtures(fixturesPath: string): TestCase[] {
  const raw = readFileSync(fixturesPath, 'utf-8');
  const data = JSON.parse(raw);
  const fixtures: FixtureTestCase[] = data.testCases;

  console.log(`\n  Loaded ${fixtures.length} test cases from fixtures`);
  console.log(`  Generated: ${data.generatedAt}`);
  console.log(`  Graph: ${data.graphStats.totalNodes} nodes, ${data.graphStats.projects.length} projects\n`);

  return fixtures.map((ftc) => ({
    id: ftc.id,
    tool: ftc.tool,
    description: ftc.description,
    args: ftc.args,
    category: ftc.category as TestCategory,
    difficulty: ftc.difficulty,
    requiresLlm: ftc.requiresLlm,
    requiresEmbeddings: ftc.requiresEmbeddings,
    requiresMultiRepo: ftc.requiresMultiRepo,
    expectedSymbols: ftc.expectedSymbols,
    expectedFiles: ftc.expectedFiles,
    validate: fixtureValidationToFn(ftc.validation, ftc),
  }));
}

// ============================================================================
// Phase 3: Run tests + report
// ============================================================================

async function main() {
  console.log('═'.repeat(100));
  console.log(`  CodeGraph MCP Tool Benchmark: ${label}`);
  console.log('═'.repeat(100));
  console.log(`  Time:       ${new Date().toISOString()}`);
  console.log(`  Embeddings: ${useEmbeddings ? 'enabled' : 'disabled'}`);
  console.log(`  Reindex:    ${reindex}`);
  console.log(`  Index ext:  ${indexExternalProjects}`);
  console.log(`  Fixtures:   ${fromFixtures ? 'yes' : 'no (dynamic)'}\n`);

  registerPlugins();
  const client = await getGraphClient();

  // ─── Index external projects ──────────────────────────────────────────
  if (indexExternalProjects) {
    const embeddingConfig = useEmbeddings ? { provider: 'local' as const } : false;
    let indexed = 0;
    const totalStart = Date.now();
    for (const proj of EXTERNAL_PROJECTS) {
      const projPath = resolve(PROJECTS_DIR, proj);
      if (!existsSync(projPath)) { console.log(`  SKIP: ${proj}`); continue; }
      try {
        const start = Date.now();
        console.log(`  Indexing ${proj}...`);
        const result = await indexProject(projPath, { client, deepAnalysis: false, embeddings: embeddingConfig, force: false });
        console.log(`    → ${result.stats.files} files, ${result.stats.entities} entities in ${Date.now() - start}ms`);
        indexed++;
      } catch (err) { console.log(`    → ERROR: ${err instanceof Error ? err.message : err}`); }
    }
    console.log(`\n  Indexed ${indexed} external projects in ${Date.now() - totalStart}ms\n`);
  }

  if (reindex) {
    console.log('Re-indexing codebase-graph...');
    const embeddingConfig = useEmbeddings ? { provider: 'local' as const } : false;
    const start = Date.now();
    const result = await indexProject(ROOT, { client, deepAnalysis: true, embeddings: embeddingConfig, force: false });
    console.log(`Indexed ${result.stats.files} files in ${Date.now() - start}ms\n`);
  }

  // Verify graph not empty
  const countResult = await client.roQuery<{ cnt: number }>('MATCH (n) RETURN count(n) AS cnt');
  const nodeCount = countResult.data[0]?.cnt ?? 0;
  if (nodeCount === 0) {
    console.error('ERROR: Graph empty. Run with --reindex.');
    await closeGraphClient(); process.exit(1);
  }

  if (useEmbeddings) { await warmupEmbedding(); console.log('Embeddings ready\n'); }

  // ─── Phase 1/2: Get test cases ──────────────────────────────────────
  let allTests: TestCase[];
  let gt: GroundTruth | null = null;

  if (fromFixtures) {
    const fixturesPath = resolve(__dirname, 'benchmark-fixtures.json');
    if (!existsSync(fixturesPath)) {
      console.error('ERROR: benchmark-fixtures.json not found. Run generate-benchmark-fixtures.ts first.');
      await closeGraphClient(); process.exit(1);
    }
    allTests = loadFixtures(fixturesPath);
    console.log(`Loaded ${allTests.length} test cases from fixtures\n`);
  } else {
    gt = await discoverGroundTruth(client);
    allTests = generateTests(gt, useEmbeddings);
    console.log(`Phase 2: Generated ${allTests.length} test cases\n`);
  }

  // Filter
  const runnableCases = allTests.filter(tc => {
    if (tc.requiresLlm && !includeLlm) return false;
    if (tc.requiresEmbeddings && !useEmbeddings) return false;
    if (tc.requiresMultiRepo && (gt?.projects?.length ?? 0) < 2) return false;
    return true;
  });
  const skippedCount = allTests.length - runnableCases.length;
  console.log(`Running ${runnableCases.length}/${allTests.length} tests (${skippedCount} skipped)...\n`);

  // ─── Phase 3: Run ─────────────────────────────────────────────────────
  const results: TestResult[] = [];

  for (const tc of runnableCases) {
    const start = Date.now();
    let rawResult: Record<string, unknown>;
    let error: string | null = null;
    let resultSize = 0;

    try {
      rawResult = (await handleToolCall(tc.tool, tc.args)) as Record<string, unknown>;
      resultSize = JSON.stringify(rawResult).length;
      error = tc.validate(rawResult);
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      rawResult = {};
    }

    const latencyMs = Date.now() - start;
    const passed = error === null;
    const testResult: TestResult = {
      id: tc.id, tool: tc.tool, description: tc.description,
      category: tc.category, difficulty: tc.difficulty,
      latencyMs, passed, resultSize,
    };
    if (error) testResult.error = error;

    if (tc.expectedSymbols?.length) {
      const actualNames = extractNames(rawResult, tc.tool);
      testResult.topK = { ...computeTopK(tc.expectedSymbols, actualNames), expectedSymbols: tc.expectedSymbols };
    }
    if (tc.expectedFiles?.length) {
      const actualFiles = extractFiles(rawResult, tc.tool);
      testResult.topKFiles = { ...computeTopKFiles(tc.expectedFiles, actualFiles), expectedFiles: tc.expectedFiles };
    }
    results.push(testResult);
  }

  // ─── Report ───────────────────────────────────────────────────────────
  const categoryOrder: TestCategory[] = [
    'operational', 'config', 'reindex', 'source', 'repo_map',
    'find_symbol', 'search_name', 'search_exact', 'search_partial',
    'search_filters', 'search_fulltext', 'search_strategies',
    'search_semantic', 'search_cross_mode',
    'fuzzy_typo', 'adversarial',
    'get_context', 'context_file', 'context_symbol',
    'impact_analysis', 'impact', 'complexity', 'vulnerabilities',
    'refactoring', 'dataflow', 'history',
    'explain', 'ask_code', 'nl_to_cypher',
    'knowledge_crud',
    'cross_file', 'cross_file_calls', 'cross_file_contains',
    'raw_query', 'multi_hop',
    'multi_repo', 'persona',
  ];

  const categoryLabels: Record<TestCategory, string> = {
    operational: 'Operational', config: 'Config', reindex: 'Reindex',
    source: 'Source', repo_map: 'Repo Map',
    find_symbol: 'Symbol Lookup', search_name: 'Name Search',
    search_exact: 'Search (Exact)', search_partial: 'Search (Partial)',
    search_filters: 'Search (Filters)', search_fulltext: 'Fulltext Search',
    search_strategies: 'Search Strategies',
    search_semantic: 'Semantic Search',
    search_cross_mode: 'Cross-Mode', fuzzy_typo: 'Fuzzy/Typo', adversarial: 'Adversarial',
    get_context: 'Context', context_file: 'Context (File)', context_symbol: 'Context (Symbol)',
    impact_analysis: 'Impact (Dynamic)', impact: 'Impact (Fixture)',
    complexity: 'Complexity', vulnerabilities: 'Vulnerabilities',
    refactoring: 'Refactoring', dataflow: 'Data Flow', history: 'Symbol History',
    explain: 'Explain Code', ask_code: 'Ask Code', nl_to_cypher: 'NL→Cypher',
    knowledge_crud: 'Knowledge CRUD',
    cross_file: 'Cross-File', cross_file_calls: 'Cross-File CALLS', cross_file_contains: 'Cross-File CONTAINS',
    raw_query: 'Raw Query', multi_hop: 'Multi-Hop', multi_repo: 'Multi-Repo',
    persona: 'Persona Tools',
  };

  for (const cat of categoryOrder) {
    const cr = results.filter(r => r.category === cat);
    if (!cr.length) continue;

    console.log(`\n${'─'.repeat(100)}`);
    console.log(`  ${categoryLabels[cat]} (${cr.length} tests)`);
    console.log('─'.repeat(100));
    console.log('  ID'.padEnd(36) + 'Description'.padEnd(48) +
      'Lat'.padStart(7) + 'Pass'.padStart(6) + 'Top1'.padStart(6) + 'MRR'.padStart(6));
    console.log('  ' + '·'.repeat(96));

    for (const r of cr) {
      console.log(
        `  ${r.id}`.padEnd(36) +
        r.description.slice(0, 46).padEnd(48) +
        `${r.latencyMs}ms`.padStart(7) +
        (r.passed ? '    ✓' : '    ✗').padStart(6) +
        (r.topK ? (r.topK.top1 ? '    ✓' : '    ✗') : '    -').padStart(6) +
        (r.topK ? r.topK.reciprocalRank.toFixed(2).padStart(5) : '    -').padStart(6),
      );
      if (r.error) console.log(`    └─ ${r.error}`);
      if (r.topK && !r.topK.top5 && r.topK.expectedSymbols.length > 0)
        console.log(`    └─ Want: [${r.topK.expectedSymbols.join(', ')}] Got: [${r.topK.actualTop5.join(', ')}]`);
    }
  }

  // ─── Aggregate ────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(100));
  console.log('  AGGREGATE');
  console.log('═'.repeat(100));
  console.log('\n  Category'.padEnd(30) +
    'N'.padStart(5) + 'Pass%'.padStart(7) + 'Top1%'.padStart(7) +
    'Top3%'.padStart(7) + 'MRR'.padStart(7) + 'P50'.padStart(7) + 'P95'.padStart(7));
  console.log('  ' + '─'.repeat(70));

  for (const cat of categoryOrder) {
    const cr = results.filter(r => r.category === cat);
    if (!cr.length) continue;
    const wt = cr.filter(r => r.topK);
    const lats = cr.map(r => r.latencyMs).sort((a, b) => a - b);
    console.log(
      `  ${categoryLabels[cat]}`.padEnd(30) +
      `${cr.length}`.padStart(5) +
      `${((cr.filter(r => r.passed).length / cr.length) * 100).toFixed(0)}%`.padStart(7) +
      (wt.length ? `${((wt.filter(r => r.topK!.top1).length / wt.length) * 100).toFixed(0)}%` : '-').padStart(7) +
      (wt.length ? `${((wt.filter(r => r.topK!.top3).length / wt.length) * 100).toFixed(0)}%` : '-').padStart(7) +
      (wt.length ? (wt.reduce((s, r) => s + r.topK!.reciprocalRank, 0) / wt.length).toFixed(2) : '-').padStart(7) +
      `${lats[Math.floor(lats.length * 0.5)]}`.padStart(7) +
      `${lats[Math.floor(lats.length * 0.95)] ?? lats.at(-1)}`.padStart(7),
    );
  }

  const allTopK = results.filter(r => r.topK);
  if (allTopK.length > 0) {
    const t1 = ((allTopK.filter(r => r.topK!.top1).length / allTopK.length) * 100).toFixed(1);
    const t3 = ((allTopK.filter(r => r.topK!.top3).length / allTopK.length) * 100).toFixed(1);
    const mrr = (allTopK.reduce((s, r) => s + r.topK!.reciprocalRank, 0) / allTopK.length).toFixed(3);
    console.log(`\n  Overall (${allTopK.length} ranked): Top-1 ${t1}%  Top-3 ${t3}%  MRR ${mrr}`);
  }

  for (const d of ['easy', 'medium', 'hard'] as const) {
    const dr = allTopK.filter(r => r.difficulty === d);
    if (!dr.length) continue;
    console.log(`  ${d.padEnd(8)} (${dr.length}): Top-1 ${((dr.filter(r => r.topK!.top1).length / dr.length) * 100).toFixed(0)}%, MRR ${(dr.reduce((s, r) => s + r.topK!.reciprocalRank, 0) / dr.length).toFixed(2)}`);
  }

  const totalPassed = results.filter(r => r.passed).length;
  const totalFailed = results.filter(r => !r.passed).length;
  const lats = results.map(r => r.latencyMs).sort((a, b) => a - b);
  const avg = Math.round(lats.reduce((s, l) => s + l, 0) / lats.length);
  const passRate = ((totalPassed / results.length) * 100).toFixed(1);

  console.log('\n' + '═'.repeat(100));
  console.log(`  SUMMARY: ${results.length} tests | ${totalPassed} pass | ${totalFailed} fail | ${skippedCount} skip`);
  console.log(`  Pass: ${passRate}% | Latency: avg=${avg}ms P50=${lats[Math.floor(lats.length * 0.5)]}ms P95=${lats[Math.floor(lats.length * 0.95)] ?? lats.at(-1)}ms`);
  console.log('═'.repeat(100));

  if (totalFailed > 0) {
    console.log('\n  Failures:');
    for (const r of results.filter(r => !r.passed))
      console.log(`    ✗ [${r.id}] ${r.error}`);
  }

  // Save JSON
  const resultsDir = resolve(__dirname, 'benchmark-results');
  mkdirSync(resultsDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const resultsFile = resolve(resultsDir, `${label}-${ts}.json`);

  writeFileSync(resultsFile, JSON.stringify({
    label, timestamp: new Date().toISOString(),
    config: { embeddings: useEmbeddings, reindex, nodeCount, projects: gt?.projects?.length ?? 0, fromFixtures },
    groundTruth: gt ? {
      functions: gt.functions.length, classes: gt.classes.length,
      filesWithFunctions: gt.filesWithFunctions.length, callEdges: gt.callEdges.length,
      projects: gt.projects.map(p => p.name),
    } : { source: 'fixtures' },
    summary: {
      total: results.length, passed: totalPassed, failed: totalFailed, skipped: skippedCount,
      passRate: parseFloat(passRate),
      latency: { avg, p50: lats[Math.floor(lats.length * 0.5)], p95: lats[Math.floor(lats.length * 0.95)] ?? lats.at(-1) },
      searchQuality: allTopK.length > 0 ? {
        queries: allTopK.length,
        top1: parseFloat(((allTopK.filter(r => r.topK!.top1).length / allTopK.length) * 100).toFixed(1)),
        top3: parseFloat(((allTopK.filter(r => r.topK!.top3).length / allTopK.length) * 100).toFixed(1)),
        mrr: parseFloat((allTopK.reduce((s, r) => s + r.topK!.reciprocalRank, 0) / allTopK.length).toFixed(3)),
      } : null,
    },
    byCategory: Object.fromEntries(categoryOrder.map(cat => {
      const cr = results.filter(r => r.category === cat);
      if (!cr.length) return [cat, null];
      const wt = cr.filter(r => r.topK);
      return [cat, {
        tests: cr.length, passed: cr.filter(r => r.passed).length,
        top1: wt.length ? parseFloat(((wt.filter(r => r.topK!.top1).length / wt.length) * 100).toFixed(1)) : null,
        mrr: wt.length ? parseFloat((wt.reduce((s, r) => s + r.topK!.reciprocalRank, 0) / wt.length).toFixed(3)) : null,
      }];
    }).filter(([, v]) => v !== null)),
    results,
  }, null, 2));

  console.log(`\n  Results: ${resultsFile}`);
  console.log(`\n[BENCHMARK] ${label} | tests=${results.length} | passed=${totalPassed} | failed=${totalFailed} | pass_rate=${passRate}%` +
    (allTopK.length ? ` | top1=${((allTopK.filter(r => r.topK!.top1).length / allTopK.length) * 100).toFixed(1)}% | mrr=${(allTopK.reduce((s, r) => s + r.topK!.reciprocalRank, 0) / allTopK.length).toFixed(3)}` : '') +
    ` | avg_ms=${avg} | skipped=${skippedCount}`);

  await closeGraphClient();
}

main().catch((err) => { console.error('Benchmark failed:', err); process.exit(1); });
