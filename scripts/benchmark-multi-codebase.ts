#!/usr/bin/env npx tsx
/**
 * Multi-codebase indexing + search benchmark.
 *
 * Indexes ~10 projects from ~/Desktop, then runs cross-project search queries
 * to measure indexing speed, embedding throughput, and search quality at scale.
 *
 * Usage:
 *   export $(grep -v '^#' .env | xargs)
 *   npx tsx scripts/benchmark-multi-codebase.ts <label> [--embeddings] [--no-clear] [--search-only]
 */

const { indexProject, getGraphClient, closeGraphClient } = await import('../packages/core/dist/index.js');
const { createOperations } = await import('../packages/graph/dist/index.js');
const { registerPlugins } = await import('../packages/core/dist/pipeline/pipeline.js');
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Parse args
const args = process.argv.slice(2);
const noClear = args.includes('--no-clear');
const withEmbeddings = args.includes('--embeddings');
const searchOnly = args.includes('--search-only');
const label = args.filter(a => !a.startsWith('--'))[0] ?? 'unlabeled';

// Projects to index — real codebases from ~/Desktop
const DESKTOP = '/path/to/user/Desktop';
const CANDIDATE_PROJECTS = [
  'codebase-graph',
  'Sitecore-MCP',
  'agntK',
  'capsule-corp',
  'feature-spec-app',
  'phantom',
  'sweet-revenge',
  'life-guardian',
  'PMI',
  'projects',
];

// Cross-project search queries to test after indexing
const SEARCH_QUERIES = [
  // Symbol lookups that should work across projects
  { query: 'createClient', type: 'function', description: 'Common factory pattern' },
  { query: 'index', type: 'file', description: 'Entry point files' },
  { query: 'config', type: 'file', description: 'Configuration files' },
  { query: 'Router', type: 'class', description: 'Router classes' },
  { query: 'middleware', type: 'function', description: 'Middleware functions' },
  { query: 'auth', type: 'function', description: 'Auth-related functions' },
  { query: 'database', type: 'function', description: 'Database functions' },
  { query: 'handleRequest', type: 'function', description: 'Request handlers' },
  { query: 'parse', type: 'function', description: 'Parser functions' },
  { query: 'test', type: 'file', description: 'Test files' },
  // Natural language / semantic queries
  { query: 'how does authentication work', description: 'NL: auth flow' },
  { query: 'error handling patterns', description: 'NL: error handling' },
  { query: 'API endpoint definitions', description: 'NL: API endpoints' },
  { query: 'data validation logic', description: 'NL: validation' },
  { query: 'state management', description: 'NL: state mgmt' },
];

interface ProjectResult {
  name: string;
  path: string;
  success: boolean;
  files: number;
  entities: number;
  edges: number;
  embedded: number;
  errors: number;
  durationMs: number;
}

async function main() {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  MULTI-CODEBASE BENCHMARK: ${label}`);
  console.log(`${'═'.repeat(70)}`);
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Embeddings: ${withEmbeddings}`);
  console.log(`Clear: ${!noClear}\n`);

  registerPlugins();

  const client = await getGraphClient();
  const ops = createOperations(client);

  // Discover available projects
  const projects = CANDIDATE_PROJECTS
    .map(name => ({ name, path: resolve(DESKTOP, name) }))
    .filter(p => existsSync(resolve(p.path, 'package.json')));

  console.log(`Found ${projects.length} projects to index:`);
  projects.forEach(p => console.log(`  • ${p.name} (${p.path})`));
  console.log();

  // ── Phase 1: Indexing ──────────────────────────────────────────────
  const projectResults: ProjectResult[] = [];

  if (!searchOnly) {
    if (!noClear) {
      console.log('Clearing graph...');
      const clearStart = Date.now();
      await ops.clearAll();
      console.log(`Graph cleared in ${Date.now() - clearStart}ms\n`);
    }

    await client.ensureIndexes();

    console.log(`${'─'.repeat(70)}`);
    console.log('  PHASE 1: INDEXING');
    console.log(`${'─'.repeat(70)}\n`);

    const totalStart = Date.now();

    for (const project of projects) {
      console.log(`\n▶ Indexing ${project.name}...`);
      const t0 = Date.now();

      try {
        const result = await indexProject(project.path, {
          client,
          force: true,
          embeddings: withEmbeddings ? undefined : false,
          deferEmbeddings: false,
        });
        const dur = Date.now() - t0;

        const pr: ProjectResult = {
          name: project.name,
          path: project.path,
          success: result.success,
          files: result.stats.files,
          entities: result.stats.entities,
          edges: result.stats.edges,
          embedded: result.stats.embedded ?? 0,
          errors: result.stats.errors,
          durationMs: dur,
        };
        projectResults.push(pr);

        console.log(`  ✓ ${pr.files} files, ${pr.entities} entities, ${pr.edges} edges, ${pr.embedded} embedded, ${pr.errors} errors — ${(dur / 1000).toFixed(1)}s`);

        if (result.errorMessages?.length > 0) {
          console.log(`  ⚠ Errors: ${result.errorMessages.slice(0, 3).join('; ')}`);
        }
      } catch (err) {
        const dur = Date.now() - t0;
        console.log(`  ✗ FAILED in ${(dur / 1000).toFixed(1)}s: ${err}`);
        projectResults.push({
          name: project.name,
          path: project.path,
          success: false,
          files: 0, entities: 0, edges: 0, embedded: 0, errors: 1,
          durationMs: dur,
        });
      }
    }

    const totalDuration = Date.now() - totalStart;

    // Indexing summary
    const totalFiles = projectResults.reduce((s, r) => s + r.files, 0);
    const totalEntities = projectResults.reduce((s, r) => s + r.entities, 0);
    const totalEdges = projectResults.reduce((s, r) => s + r.edges, 0);
    const totalEmbedded = projectResults.reduce((s, r) => s + r.embedded, 0);
    const totalErrors = projectResults.reduce((s, r) => s + r.errors, 0);
    const succeeded = projectResults.filter(r => r.success).length;

    console.log(`\n${'─'.repeat(70)}`);
    console.log('  INDEXING SUMMARY');
    console.log(`${'─'.repeat(70)}`);
    console.log(`  Projects:   ${succeeded}/${projects.length} succeeded`);
    console.log(`  Files:      ${totalFiles}`);
    console.log(`  Entities:   ${totalEntities}`);
    console.log(`  Edges:      ${totalEdges}`);
    console.log(`  Embedded:   ${totalEmbedded}`);
    console.log(`  Errors:     ${totalErrors}`);
    console.log(`  Duration:   ${(totalDuration / 1000).toFixed(1)}s`);
    console.log(`  Files/sec:  ${(totalFiles / (totalDuration / 1000)).toFixed(1)}`);
    if (totalEmbedded > 0) {
      console.log(`  ms/embed:   ${(totalDuration / totalEmbedded).toFixed(1)}`);
    }
    console.log();

    // Per-project table
    console.log(`  ${'Project'.padEnd(20)} ${'Files'.padStart(6)} ${'Entities'.padStart(9)} ${'Edges'.padStart(7)} ${'Embed'.padStart(6)} ${'Errors'.padStart(7)} ${'Time'.padStart(8)}`);
    console.log(`  ${'─'.repeat(65)}`);
    for (const r of projectResults) {
      console.log(`  ${r.name.padEnd(20)} ${String(r.files).padStart(6)} ${String(r.entities).padStart(9)} ${String(r.edges).padStart(7)} ${String(r.embedded).padStart(6)} ${String(r.errors).padStart(7)} ${(r.durationMs / 1000).toFixed(1).padStart(7)}s`);
    }

    console.log(`\n[INDEX] ${label} | projects=${succeeded} | files=${totalFiles} | entities=${totalEntities} | edges=${totalEdges} | embedded=${totalEmbedded} | errors=${totalErrors} | duration_ms=${totalDuration}`);
  }

  // ── Phase 2: Search Quality ────────────────────────────────────────
  console.log(`\n${'─'.repeat(70)}`);
  console.log('  PHASE 2: SEARCH QUALITY');
  console.log(`${'─'.repeat(70)}\n`);

  // Get graph stats
  try {
    const statsResult = await client.query('MATCH (n) RETURN labels(n)[0] AS label, count(n) AS cnt ORDER BY cnt DESC');
    console.log('  Graph node counts:');
    for (const row of statsResult.data ?? []) {
      console.log(`    ${String(row.label).padEnd(20)} ${row.cnt}`);
    }
    console.log();
  } catch { /* ignore */ }

  // Import hybrid search
  const { hybridSearch } = await import('../packages/core/dist/hybridSearch.js');

  const searchResults: Array<{
    query: string;
    description: string;
    hits: number;
    topHit: string;
    latencyMs: number;
    projects: string[];
  }> = [];

  for (const sq of SEARCH_QUERIES) {
    const t0 = performance.now();
    try {
      const results = await hybridSearch(
        sq.query,
        client,
        { limit: 10, type: (sq as any).type },
      );
      const latency = performance.now() - t0;

      // Collect unique projects from results
      const hitProjects = new Set<string>();
      for (const hit of results.hits) {
        const fp = hit.filePath || '';
        // Extract project name from path
        const match = fp.match(/\/Desktop\/([^/]+)\//);
        if (match) hitProjects.add(match[1]);
      }

      const topHit = results.hits[0]
        ? `${results.hits[0].name} (${basename(results.hits[0].filePath || '?')})`
        : '(none)';

      searchResults.push({
        query: sq.query,
        description: sq.description,
        hits: results.hits.length,
        topHit,
        latencyMs: latency,
        projects: Array.from(hitProjects),
      });

      const projStr = hitProjects.size > 0 ? ` [${Array.from(hitProjects).join(', ')}]` : '';
      console.log(`  ✓ "${sq.query}" → ${results.hits.length} hits, ${latency.toFixed(0)}ms, top: ${topHit}${projStr}`);
    } catch (err) {
      const latency = performance.now() - t0;
      console.log(`  ✗ "${sq.query}" FAILED in ${latency.toFixed(0)}ms: ${err}`);
      searchResults.push({
        query: sq.query,
        description: sq.description,
        hits: 0,
        topHit: 'ERROR',
        latencyMs: latency,
        projects: [],
      });
    }
  }

  // Search summary
  const avgLatency = searchResults.reduce((s, r) => s + r.latencyMs, 0) / searchResults.length;
  const avgHits = searchResults.reduce((s, r) => s + r.hits, 0) / searchResults.length;
  const multiProjectQueries = searchResults.filter(r => r.projects.length > 1).length;
  const zeroHitQueries = searchResults.filter(r => r.hits === 0).length;

  console.log(`\n${'─'.repeat(70)}`);
  console.log('  SEARCH SUMMARY');
  console.log(`${'─'.repeat(70)}`);
  console.log(`  Queries:          ${searchResults.length}`);
  console.log(`  Avg hits:         ${avgHits.toFixed(1)}`);
  console.log(`  Avg latency:      ${avgLatency.toFixed(0)}ms`);
  console.log(`  Multi-project:    ${multiProjectQueries}/${searchResults.length} queries returned results from multiple projects`);
  console.log(`  Zero-hit:         ${zeroHitQueries}`);

  console.log(`\n[SEARCH] ${label} | queries=${searchResults.length} | avg_hits=${avgHits.toFixed(1)} | avg_latency_ms=${avgLatency.toFixed(0)} | multi_project=${multiProjectQueries} | zero_hit=${zeroHitQueries}`);

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  BENCHMARK COMPLETE: ${label}`);
  console.log(`${'═'.repeat(70)}\n`);

  await closeGraphClient();
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
