#!/usr/bin/env npx tsx
const { getGraphClient, closeGraphClient } = await import('../packages/core/dist/index.js');
const client = await getGraphClient();

// 1. What do IMPORTS edges look like?
console.log('\n═══ IMPORTS edge structure ═══');
const imports = await client.roQuery(
  `MATCH (a)-[:IMPORTS]->(b)
   RETURN labels(a)[0] AS srcType, labels(b)[0] AS tgtType, a.name AS src, b.name AS tgt
   LIMIT 5`
);
for (const row of imports.data) {
  console.log(`  ${row.srcType}:${row.src} -IMPORTS-> ${row.tgtType}:${row.tgt}`);
}

// 2. What nodes exist in test files?
console.log('\n═══ Test file contents (CONTAINS) ═══');
const testContents = await client.roQuery(
  `MATCH (f:File)-[:CONTAINS]->(n)
   WHERE f.filePath CONTAINS 'test' OR f.filePath CONTAINS 'spec'
   RETURN f.filePath AS file, labels(n)[0] AS nodeType, n.name AS name
   LIMIT 15`
);
for (const row of testContents.data) {
  const shortPath = String(row.file).replace(/.*packages\//, '');
  console.log(`  ${shortPath} → ${row.nodeType}:${row.name}`);
}

// 3. Do test files import anything?
console.log('\n═══ Test file IMPORTS ═══');
const testImports = await client.roQuery(
  `MATCH (f:File)-[:IMPORTS]->(target)
   WHERE f.filePath CONTAINS 'test' OR f.filePath CONTAINS 'spec'
   RETURN f.filePath AS file, labels(target)[0] AS tgtType, target.name AS tgt
   LIMIT 10`
);
console.log(`  Found ${testImports.data.length} IMPORTS from test files`);
for (const row of testImports.data) {
  const shortPath = String(row.file).replace(/.*packages\//, '');
  console.log(`  ${shortPath} -IMPORTS-> ${row.tgtType}:${row.tgt}`);
}

// 4. What CALLS edges exist from test files?
console.log('\n═══ Test file CALLS (via CONTAINS) ═══');
const testCalls = await client.roQuery(
  `MATCH (f:File)-[:CONTAINS]->(fn)-[:CALLS]->(target)
   WHERE f.filePath CONTAINS 'test' OR f.filePath CONTAINS 'spec'
   RETURN f.filePath AS file, fn.name AS caller, target.name AS target
   LIMIT 10`
);
console.log(`  Found ${testCalls.data.length} CALLS from test files`);
for (const row of testCalls.data) {
  const shortPath = String(row.file).replace(/.*packages\//, '');
  console.log(`  ${shortPath} :: ${row.caller} → ${row.target}`);
}

// 5. Where does calculateComplexity live?
console.log('\n═══ calculateComplexity location ═══');
const cc = await client.roQuery(
  `MATCH (f:File)-[:CONTAINS]->(n {name: 'calculateComplexity'})
   RETURN f.filePath AS file, labels(n)[0] AS nodeType`
);
for (const row of cc.data) {
  console.log(`  ${row.file} (${row.nodeType})`);
}

// 6. Is that file imported by any test file?
if (cc.data.length > 0) {
  const filePath = cc.data[0].file;
  console.log(`\n═══ Who imports the file containing calculateComplexity? ═══`);
  const importers = await client.roQuery(
    `MATCH (f:File)-[:IMPORTS]->(target:File {filePath: $fp})
     RETURN f.filePath AS importer`,
    { params: { fp: filePath } }
  );
  console.log(`  Found ${importers.data.length} importers of ${filePath}`);
  for (const row of importers.data) {
    console.log(`  ${row.importer}`);
  }
}

await closeGraphClient();
console.log('\nDone');
