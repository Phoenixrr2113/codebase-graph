import { getGraphClient, closeGraphClient, syncGitHistory } from '../packages/core/src/index.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const client = await getGraphClient();
console.log('Syncing git history...');
const result = await syncGitHistory(ROOT, client, { maxCommits: 100 });
console.log('Git sync result:', JSON.stringify(result, null, 2));

// Verify
const commits = await client.roQuery<{cnt: number}>('MATCH (c:Commit) RETURN count(c) AS cnt');
const modifiedIn = await client.roQuery<{cnt: number}>('MATCH ()-[r:MODIFIED_IN]->() RETURN count(r) AS cnt');
console.log(`\nCommits: ${commits.data[0]?.cnt}`);
console.log(`MODIFIED_IN edges: ${modifiedIn.data[0]?.cnt}`);

await closeGraphClient();
