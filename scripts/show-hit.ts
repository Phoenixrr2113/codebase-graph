#!/usr/bin/env npx tsx
const { getGraphClient } = await import('../packages/core/dist/index.js');
const { enrichedSearchV2 } = await import('../packages/core/dist/enrichedSearchV2.js');
const { warmupEmbedding, generateEmbedding, isEmbeddingAvailable } = await import('../packages/plugin-nlp/dist/index.js');
const { createOperations } = await import('../packages/graph/dist/index.js');

const embeddingConfig = { provider: 'voyage' as const };
await warmupEmbedding(embeddingConfig);
console.log('Embedding available:', isEmbeddingAvailable(embeddingConfig));

const client = await getGraphClient();

// Test direct vector search
const ops = createOperations(client);
const emb = await generateEmbedding('analyzeImpact', { ...embeddingConfig, inputType: 'query' });
console.log('Embedding length:', emb.embedding.length);
const direct = await ops.searchByVector('Function', emb.embedding, 3);
console.log('Direct vector search results:', direct.length);
if (direct.length > 0) console.log('First:', direct[0].name, direct[0].distance);

// Now run full V2
const result = await enrichedSearchV2('analyzeImpact', client, { limit: 3, embeddings: embeddingConfig });
console.log('V2 hits:', result.hits.length);

for (const hit of result.hits) {
  const { properties, ...clean } = hit;
  console.log(JSON.stringify(clean, null, 2));
  console.log('---');
}
process.exit(0);
