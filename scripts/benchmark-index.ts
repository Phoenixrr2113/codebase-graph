#!/usr/bin/env npx tsx
/**
 * Benchmark: Index Performance
 *
 * Clears the graph (unless --no-clear), indexes the codegraph codebase, reports timing.
 * Must `npm run build` first, then run:
 *   npx tsx scripts/benchmark-index.ts <label> [--no-clear] [--force]
 */

// Use compiled dist output (avoids decorator issues with tsx)
const { indexProject, getGraphClient, closeGraphClient } = await import('../packages/core/dist/index.js');
const { createOperations } = await import('../packages/graph/dist/index.js');
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Parse args
const args = process.argv.slice(2);
const noClear = args.includes('--no-clear');
const force = args.includes('--force');
const label = args.filter(a => !a.startsWith('--'))[0] ?? 'unlabeled';

async function main() {
  console.log(`\n=== Benchmark: ${label} ===`);
  console.log(`Target: ${ROOT}`);
  console.log(`Clear: ${!noClear} | Force: ${force}`);
  console.log(`Time: ${new Date().toISOString()}\n`);

  const client = await getGraphClient();
  const ops = createOperations(client);

  if (!noClear) {
    console.log('Clearing graph...');
    const clearStart = Date.now();
    await ops.clearAll();
    console.log(`Graph cleared in ${Date.now() - clearStart}ms\n`);
  } else {
    console.log('Skipping graph clear (--no-clear)\n');
  }

  await client.ensureIndexes();

  console.log('Indexing...');
  const result = await indexProject(ROOT, {
    client,
    deepAnalysis: true,
    embeddings: false,
    force,
  });

  // Report
  console.log('\n--- Results ---');
  console.log(`Label:      ${label}`);
  console.log(`Success:    ${result.success}`);
  console.log(`Files:      ${result.stats.files}`);
  console.log(`Skipped:    ${result.stats.skipped ?? 0}`);
  console.log(`Entities:   ${result.stats.entities}`);
  console.log(`Edges:      ${result.stats.edges}`);
  console.log(`Errors:     ${result.stats.errors}`);
  console.log(`Duration:   ${result.stats.durationMs}ms (${(result.stats.durationMs / 1000).toFixed(2)}s)`);

  if (result.errorMessages.length > 0) {
    console.log(`\nErrors (first 5):`);
    result.errorMessages.slice(0, 5).forEach((m: string) => console.log(`  - ${m}`));
    if (result.errorMessages.length > 5) {
      console.log(`  ... and ${result.errorMessages.length - 5} more`);
    }
  }

  console.log(`\n[BENCHMARK] ${label} | files=${result.stats.files} | entities=${result.stats.entities} | edges=${result.stats.edges} | errors=${result.stats.errors} | duration_ms=${result.stats.durationMs} | skipped=${result.stats.skipped ?? 0}`);

  await closeGraphClient();
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
