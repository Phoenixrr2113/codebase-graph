import { indexProject } from './src/index.js';

const target = process.argv[2] || '/tmp/large-ts-repo';

console.log(`Indexing: ${target}`);
console.log(`Driver: ${process.env.CODEGRAPH_DRIVER || '(auto-detect)'}`);

const start = Date.now();
const result = await indexProject(target, {
  force: true,
  deepAnalysis: true,
  deferEmbeddings: true,
});
const elapsed = Date.now() - start;

console.log(`\n=== Results ===`);
console.log(`Wall time: ${elapsed}ms (${(elapsed / 1000).toFixed(1)}s)`);
console.log(`Stats:`, JSON.stringify(result.stats, null, 2));
console.log(`Files/sec: ${(result.stats.files / (elapsed / 1000)).toFixed(1)}`);
console.log(`Errors: ${result.errorMessages?.length || 0}`);
if (result.errorMessages && result.errorMessages.length > 0) {
  console.log(`First 5 errors:`, result.errorMessages.slice(0, 5));
}
