#!/usr/bin/env npx tsx
/**
 * Test Phase 3 search signals: testReferenceCount and dependencyDepth
 */
const { getGraphClient, closeGraphClient, enrichedSearchV2, registerPlugins } =
  await import('../packages/core/dist/index.js');

registerPlugins();
const client = await getGraphClient();

console.log('VOYAGE_API_KEY set:', !!process.env.VOYAGE_API_KEY);
console.log('CODEGRAPH_EMBEDDING_PROVIDER:', process.env.CODEGRAPH_EMBEDDING_PROVIDER || 'not set');

console.log('\n═══ TEST 1: "parseCode" — callers, callees, test refs, depth ═══');
const r1 = await enrichedSearchV2('parseCode', client, { limit: 3 });
console.log(`  → ${r1.hits.length} hits, ${r1.meta.vectorHits} vector candidates, ${r1.meta.durationMs}ms`);
for (const hit of r1.hits) {
  console.log(`  ${hit.nodeType}: ${hit.name}`);
  console.log(`    callerCount=${hit.callerCount ?? '-'} callees=${JSON.stringify(hit.callees ?? [])} importerCount=${hit.importerCount ?? '-'}`);
  console.log(`    testReferenceCount=${hit.testReferenceCount ?? '-'} dependencyDepth=${hit.dependencyDepth ?? '-'}`);
}

console.log('\n═══ TEST 2: "calculateComplexity" — should have testReferenceCount ═══');
const r2 = await enrichedSearchV2('calculateComplexity', client, { limit: 3 });
for (const hit of r2.hits) {
  console.log(`  ${hit.nodeType}: ${hit.name}`);
  console.log(`    testReferenceCount=${hit.testReferenceCount ?? '-'} dependencyDepth=${hit.dependencyDepth ?? '-'} callerCount=${hit.callerCount ?? '-'}`);
}

console.log('\n═══ TEST 3: "enrichedSearchV2" — should be shallow depth ═══');
const r3 = await enrichedSearchV2('enrichedSearchV2', client, { limit: 3 });
for (const hit of r3.hits) {
  console.log(`  ${hit.nodeType}: ${hit.name}`);
  console.log(`    dependencyDepth=${hit.dependencyDepth ?? '-'} callerCount=${hit.callerCount ?? '-'} importerCount=${hit.importerCount ?? '-'}`);
}

console.log('\n═══ TEST 4: Graph state — test files and CALLS edges ═══');
const testFiles = await client.roQuery(
  "MATCH (f:File) WHERE f.filePath CONTAINS 'test' OR f.filePath CONTAINS 'spec' RETURN count(f) AS cnt"
);
console.log(`  Test files in graph: ${testFiles.data[0]?.cnt ?? 0}`);

const testCalls = await client.roQuery(
  "MATCH (tf:File)-[:CONTAINS]->(fn)-[:CALLS]->(target) WHERE tf.filePath CONTAINS 'test' OR tf.filePath CONTAINS 'spec' RETURN count(*) AS cnt"
);
console.log(`  Test→target CALLS edges: ${testCalls.data[0]?.cnt ?? 0}`);

const entryPoints = await client.roQuery(
  "MATCH (f:File) WHERE NOT ()-[:IMPORTS]->(f) RETURN count(f) AS cnt"
);
console.log(`  Entry point files (no importers): ${entryPoints.data[0]?.cnt ?? 0}`);

// Test 5: Show a specific test CALLS chain
console.log('\n═══ TEST 5: Sample test→target CALLS chains ═══');
const sampleCalls = await client.roQuery(
  `MATCH (tf:File)-[:CONTAINS]->(fn)-[:CALLS]->(target)
   WHERE tf.filePath CONTAINS 'test' OR tf.filePath CONTAINS 'spec'
   RETURN tf.filePath AS testFile, fn.name AS testFn, target.name AS targetFn
   LIMIT 10`
);
for (const row of sampleCalls.data) {
  const shortPath = String(row.testFile).replace(/.*packages\//, 'packages/');
  console.log(`  ${shortPath} :: ${row.testFn} → ${row.targetFn}`);
}

await closeGraphClient();
console.log('\n✅ All signal tests complete');
