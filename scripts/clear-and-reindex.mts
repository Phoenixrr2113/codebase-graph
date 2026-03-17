import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Load .env so VOYAGE_API_KEY and other config is available
const envPath = resolve(ROOT, '.env');
try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
} catch { /* no .env file */ }

import { getGraphClient, closeGraphClient, indexProject, registerPlugins } from '../packages/core/src/index.js';
import { warmupEmbedding, isEmbeddingAvailable } from '../packages/plugin-nlp/src/index.js';

// Register language plugins
registerPlugins();

const client = await getGraphClient();

// Clear existing data
console.log('Clearing graph...');
await client.query('MATCH (n) DETACH DELETE n');
const countResult = await client.roQuery<{cnt: number}>('MATCH (n) RETURN count(n) AS cnt');
console.log('Nodes after clear:', countResult.data[0]?.cnt);

// Warmup embeddings
console.log('\nWarming up embedding model...');
const provider = (process.env['CODEGRAPH_EMBEDDING_PROVIDER'] ?? 'voyage') as 'local' | 'openrouter' | 'voyage';
const embeddingConfig = { provider };
console.log(`Provider: ${provider}, available: ${isEmbeddingAvailable(embeddingConfig)}, VOYAGE_API_KEY set: ${!!process.env['VOYAGE_API_KEY']}`);
await warmupEmbedding(embeddingConfig);
console.log('Embeddings ready.\n');

// Index this codebase only
console.log('Indexing codebase-graph...');
const startTime = Date.now();
const result = await indexProject(ROOT, {
  client,
  deepAnalysis: true,
  embeddings: embeddingConfig,
  force: true,
});
const elapsed = Date.now() - startTime;

console.log(`\nIndexed in ${(elapsed / 1000).toFixed(1)}s:`);
console.log(`  Files: ${result.stats.files}`);
console.log(`  Entities: ${result.stats.entities}`);

// Verify
const finalCount = await client.roQuery<{cnt: number}>('MATCH (n) RETURN count(n) AS cnt');
console.log(`\nFinal node count: ${finalCount.data[0]?.cnt}`);

// Check embedding coverage
const embCount = await client.roQuery<{nodeType: string; cnt: number}>(
  "MATCH (n) WHERE n.embedding IS NOT NULL RETURN labels(n)[0] AS nodeType, count(n) AS cnt ORDER BY cnt DESC"
);
console.log('\nEmbedding coverage:');
for (const row of embCount.data) {
  console.log(`  ${row.nodeType}: ${row.cnt}`);
}

await closeGraphClient();
