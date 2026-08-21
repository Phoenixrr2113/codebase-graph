/**
 * removeFileContents() vs removeFileAndCleanup(): who is allowed to delete
 * the File node.
 *
 * removeFileAndCleanup() (REMOVE_FILE_NODE) deletes the File node itself,
 * which cascades away every edge attached to it: MODIFIED_IN, HAS_FILE,
 * EXPORTS, and so on, not just CONTAINS. That is correct when a file was
 * genuinely deleted from disk, but indexer.ts used to call it for a file
 * whose CONTENT merely changed, destroying git-history edges from commits
 * that were already synced and would never be re-synced.
 *
 * removeFileContents() is the new, narrower operation for that case: it
 * detaches CONTAINS edges (and cleans up now-orphaned child symbols, exactly
 * like removeFileAndCleanup() does) but leaves the File node, and every
 * other edge on it, untouched, so a subsequent MERGE-based file upsert
 * refreshes it in place instead of destroying and rebuilding it.
 *
 * These tests run against a real embedded FalkorDBLite graph (no Docker
 * needed) because the distinction is about actual Cypher DELETE-vs-MERGE
 * semantics, which a mocked client cannot exercise.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient, resolveEmbeddedBinaryPaths, type GraphClient } from '../index';
import { createOperations, type GraphOperations } from '../operations';

// The embedded driver ships binaries for darwin-arm64 and linux-x64 only.
const describeIfAvailable = resolveEmbeddedBinaryPaths() ? describe : describe.skip;

describeIfAvailable('removeFileContents vs removeFileAndCleanup', () => {
  let client: GraphClient;
  let ops: GraphOperations;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'codegraph-remove-file-'));
    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: `test_remove_file_${Date.now()}`,
    } as never);

    // No embeddings involved in this test, but ensureIndexes() needs a
    // dimension to build vector indexes; pass one explicitly rather than
    // relying on env vars.
    await client.ensureIndexes({ embeddingDim: 8 });
    ops = createOperations(client);
  }, 30_000);

  afterAll(async () => {
    if (client) {
      try {
        await client.query('MATCH (n) DETACH DELETE n', { params: {} });
      } catch {
        // best effort
      }
      await client.close();
    }
    try {
      await rm(dataDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }, 15_000);

  it('removeFileContents() clears CONTAINS/orphans but leaves the File node and its other edges intact', async () => {
    await client.query(`
      CREATE (p:Project {id: 'proj1', name: 'test', rootPath: '/repo', createdAt: '2025-01-01T00:00:00Z', lastParsed: '2025-01-01T00:00:00Z', fileCount: 1})
      CREATE (f:File {filePath: '/repo/foo.ts', name: 'foo.ts', extension: 'ts', loc: 10, lastModified: '2025-01-01T00:00:00Z', hash: 'oldhash'})
      CREATE (c:Commit {hash: 'commitA', message: 'a', author: 'x', email: 'x@x.com', date: '2025-01-01T00:00:00Z'})
      CREATE (p)-[:HAS_FILE]->(f)
      CREATE (f)-[:MODIFIED_IN]->(c)
      CREATE (kept:Function {name: 'kept', filePath: '/repo/foo.ts', startLine: 1, endLine: 2, isExported: true, isAsync: false, isArrow: false, params: []})
      CREATE (dropped:Function {name: 'dropped', filePath: '/repo/foo.ts', startLine: 5, endLine: 6, isExported: true, isAsync: false, isArrow: false, params: []})
      CREATE (f)-[:CONTAINS]->(kept)
      CREATE (f)-[:CONTAINS]->(dropped)
      CREATE (other:File {filePath: '/repo/other.ts', name: 'other.ts', extension: 'ts', loc: 5, lastModified: '2025-01-01T00:00:00Z', hash: 'h2'})
      CREATE (caller:Function {name: 'caller', filePath: '/repo/other.ts', startLine: 1, endLine: 2, isExported: true, isAsync: false, isArrow: false, params: []})
      CREATE (other)-[:CONTAINS]->(caller)
      CREATE (caller)-[:CALLS]->(kept)
    `);

    await ops.removeFileContents('/repo/foo.ts');

    // The File node itself must survive, unchanged.
    const fileRows = await client.roQuery<{ hash: string }>(
      `MATCH (f:File {filePath: '/repo/foo.ts'}) RETURN f.hash AS hash`,
    );
    expect(fileRows.data).toHaveLength(1);
    expect(fileRows.data[0]?.hash).toBe('oldhash');

    // Its non-CONTAINS edges must survive: MODIFIED_IN and HAS_FILE.
    const modifiedIn = await client.roQuery(
      `MATCH (:File {filePath: '/repo/foo.ts'})-[:MODIFIED_IN]->(:Commit {hash: 'commitA'}) RETURN 1`,
    );
    expect(modifiedIn.data).toHaveLength(1);

    const hasFile = await client.roQuery(
      `MATCH (:Project {id: 'proj1'})-[:HAS_FILE]->(:File {filePath: '/repo/foo.ts'}) RETURN 1`,
    );
    expect(hasFile.data).toHaveLength(1);

    // CONTAINS edges from this file must be gone.
    const contains = await client.roQuery<{ n: number }>(
      `MATCH (:File {filePath: '/repo/foo.ts'})-[:CONTAINS]->() RETURN count(*) AS n`,
    );
    expect(contains.data[0]?.n).toBe(0);

    // 'dropped' had no incoming cross-file edge, so it is genuinely orphaned
    // once CONTAINS is gone, and gets cleaned up (same as removeFileAndCleanup()).
    const droppedRows = await client.roQuery(
      `MATCH (fn:Function {name: 'dropped', filePath: '/repo/foo.ts'}) RETURN fn`,
    );
    expect(droppedRows.data).toHaveLength(0);

    // 'kept' is referenced from another file's CALLS edge, so it (and that
    // edge) must be preserved instead of leaking a dangling reference.
    const keptRows = await client.roQuery(
      `MATCH (:Function {name: 'caller', filePath: '/repo/other.ts'})-[:CALLS]->(fn:Function {name: 'kept', filePath: '/repo/foo.ts'}) RETURN fn`,
    );
    expect(keptRows.data).toHaveLength(1);
  });

  it('removeFileAndCleanup() still fully removes the File node and its symbols (true deletion path)', async () => {
    await client.query(`
      CREATE (f:File {filePath: '/repo/bar.ts', name: 'bar.ts', extension: 'ts', loc: 10, lastModified: '2025-01-01T00:00:00Z', hash: 'h'})
      CREATE (c:Commit {hash: 'commitZ', message: 'z', author: 'x', email: 'x@x.com', date: '2025-01-01T00:00:00Z'})
      CREATE (f)-[:MODIFIED_IN]->(c)
      CREATE (fn:Function {name: 'onlyFn', filePath: '/repo/bar.ts', startLine: 1, endLine: 2, isExported: true, isAsync: false, isArrow: false, params: []})
      CREATE (f)-[:CONTAINS]->(fn)
    `);

    await ops.removeFileAndCleanup('/repo/bar.ts');

    const fileRows = await client.roQuery(`MATCH (f:File {filePath: '/repo/bar.ts'}) RETURN f`);
    expect(fileRows.data).toHaveLength(0);

    const fnRows = await client.roQuery(`MATCH (fn:Function {filePath: '/repo/bar.ts'}) RETURN fn`);
    expect(fnRows.data).toHaveLength(0);
  });
});
