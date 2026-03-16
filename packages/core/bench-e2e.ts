/**
 * End-to-end indexing benchmark with graph writes.
 * Run: CODEGRAPH_DRIVER=falkordb npx tsx packages/core/bench-e2e.ts
 */

import { indexProject } from './src/indexer.js';
import { registerPlugins } from './src/pipeline/pipeline.js';

registerPlugins();

const ROOT = '/path/to/user/Desktop/codebase-graph';

async function main() {
  console.log('\n=== End-to-End Indexing Benchmark ===\n');

  const withEmbeddings = process.argv.includes('--embed');

  const t0 = Date.now();
  const result = await indexProject(ROOT, {
    force: true,
    embeddings: withEmbeddings ? undefined : false,
    deferEmbeddings: false,
  });
  const dur = Date.now() - t0;

  console.log(`\nResult: ${result.success ? 'SUCCESS' : 'FAILED'}`);
  console.log(`Files: ${result.stats.files}`);
  console.log(`Entities: ${result.stats.entities}`);
  console.log(`Edges: ${result.stats.edges}`);
  console.log(`Embedded: ${result.stats.embedded ?? 0}`);
  console.log(`Errors: ${result.stats.errors}`);
  console.log(`Duration: ${dur}ms`);

  if (result.errorMessages.length > 0) {
    console.log(`\nFirst errors:\n${result.errorMessages.slice(0, 5).join('\n')}`);
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
