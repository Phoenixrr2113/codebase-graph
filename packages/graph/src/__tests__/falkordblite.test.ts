/**
 * FalkorDBLite Integration Tests
 *
 * Tests the embedded FalkorDB driver (no Docker needed).
 * Requires: redis-server installed (brew install redis) and falkordblite npm package.
 *
 * These tests verify that FalkorDBLite:
 *  1. Opens an embedded instance with a temp data directory
 *  2. Supports the same Graph API as remote FalkorDB
 *  3. Persists data across graph operations within a session
 *  4. Closes cleanly (stops Redis subprocess)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type GraphClient } from '../client';
import { createOperations, type GraphOperations } from '../operations';
import { createKnowledgeOperations, type KnowledgeOperations } from '../knowledge-operations';
import type { FileEntity, FunctionEntity } from '@codegraph/types';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Skip tests if falkordblite is not available
let falkordbliteAvailable = false;
try {
  await import('falkordblite');
  falkordbliteAvailable = true;
} catch {
  // not installed
}

const describeIfAvailable = falkordbliteAvailable ? describe : describe.skip;

// ============================================================================
// Test Fixtures
// ============================================================================

function makeFile(overrides?: Partial<FileEntity>): FileEntity {
  return {
    path: '/src/index.ts',
    name: 'index.ts',
    extension: 'ts',
    loc: 100,
    lastModified: '2025-01-01T00:00:00Z',
    hash: 'abc123',
    ...overrides,
  };
}

function makeFunction(overrides?: Partial<FunctionEntity>): FunctionEntity {
  return {
    id: 'sym:v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    scopeKey: '',
    disambiguator: '',
    name: 'myFunction',
    filePath: '/src/index.ts',
    startLine: 10,
    endLine: 20,
    isExported: true,
    isAsync: false,
    isArrow: false,
    params: [],
    ...overrides,
  };
}

// ============================================================================
// Code Graph Operations (via FalkorDBLite)
// ============================================================================

describeIfAvailable('FalkorDBLite Driver', () => {
  let client: GraphClient;
  let ops: GraphOperations;
  let dataDir: string;

  beforeAll(async () => {
    // Create a temp directory for this test run
    dataDir = await mkdtemp(join(tmpdir(), 'codegraph-lite-test-'));

    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: `test_lite_${Date.now()}`,
    });

    // Pass embeddingDim so vector indexes are created regardless of env vars.
    // The vector search test uses 768-dim embeddings.
    await client.ensureIndexes({ embeddingDim: 768 });
    ops = createOperations(client);
  }, 30_000); // FalkorDBLite startup can take a few seconds

  afterAll(async () => {
    if (client) {
      try { await client.query('MATCH (n) DETACH DELETE n', { params: {} }); } catch { /* ok */ }
      await client.close();
    }
    // Clean up temp directory
    try {
      await rm(dataDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }, 15_000);

  // ---------- Basic Connectivity ----------

  it('should connect and expose a graph', () => {
    expect(client).toBeDefined();
    expect(client.graph).not.toBeNull();
    // FalkorDBLite reuses the falkorDialect (same engine)
    expect(client.dialect.driverType).toBe('falkordb');
  });

  // ---------- File CRUD ----------

  it('should upsert and retrieve a file node', async () => {
    await ops.upsertFile(makeFile({ path: '/src/index.ts' }));

    const result = await client.roQuery<{ path: string }>(
      `MATCH (f:File {filePath: $filePath}) RETURN f.filePath AS path`,
      { params: { filePath: '/src/index.ts' } }
    );
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.path).toBe('/src/index.ts');
  });

  // ---------- Entity Upsert ----------

  it('should upsert a function node', async () => {
    await ops.upsertFile(makeFile({ path: '/src/util.ts', name: 'util.ts' }));

    await ops.upsertFunction(makeFunction({
      name: 'add',
      filePath: '/src/util.ts',
      startLine: 1,
      endLine: 5,
    }));

    const result = await client.roQuery<{ name: string }>(
      `MATCH (fn:Function {name: 'add'}) RETURN fn.name AS name`,
      { params: {} }
    );
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.name).toBe('add');
  });

  // ---------- Edge Creation ----------

  it('should create a CONTAINS edge between file and function', async () => {
    const result = await client.roQuery<{ file: string; fn: string }>(
      `MATCH (f:File {filePath: '/src/util.ts'})-[:CONTAINS]->(fn:Function {name: 'add'})
       RETURN f.filePath AS file, fn.name AS fn`,
      { params: {} }
    );
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.fn).toBe('add');
  });

  // ---------- Vector Search ----------

  it('should store and query vector embeddings', async () => {
    // Create a file with an embedding
    const embedding = new Array(768).fill(0).map((_, i) => (i === 0 ? 1.0 : 0.0));

    await client.query(
      `MERGE (f:File {filePath: '/src/vec-test.ts'})
       SET f.project = 'lite-test', f.language = 'typescript',
           f.name = 'vec-test.ts', f.extension = 'ts',
           f.loc = 10, f.lastModified = '2025-01-01', f.hash = 'vec123',
           f.embedding = vecf32($emb)`,
      { params: { emb: embedding } }
    );

    // Query with the same vector — should find it with high similarity
    const result = await client.roQuery<{ path: string; score: number }>(
      `CALL db.idx.vector.queryNodes('File', 'embedding', 1, vecf32($qvec))
       YIELD node, score
       RETURN node.filePath AS path, score`,
      { params: { qvec: embedding } }
    );

    expect(result.data.length).toBeGreaterThanOrEqual(1);
    expect(result.data[0]!.path).toBe('/src/vec-test.ts');
    // Score semantics may differ between FalkorDB versions — just verify it's defined
    expect(result.data[0]!.score).toBeDefined();
  });

  // ---------- clearAll ----------

  it('should delete all nodes with clearAll', async () => {
    await ops.clearAll();
    const result = await client.roQuery<{ count: number }>(
      'MATCH (n) RETURN count(n) AS count',
      { params: {} }
    );
    expect(result.data[0]!.count).toBe(0);
  });
});

// ============================================================================
// Knowledge Graph Operations (via FalkorDBLite)
// ============================================================================

describeIfAvailable('FalkorDBLite Knowledge Operations', () => {
  let client: GraphClient;
  let kg: KnowledgeOperations;
  let dataDir: string;

  beforeAll(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'codegraph-lite-kg-'));

    client = await createClient({
      driver: 'falkordblite',
      databasePath: dataDir,
      graphName: `test_lite_kg_${Date.now()}`,
    });

    // Pass embeddingDim so vector indexes are created regardless of env vars.
    await client.ensureIndexes({ embeddingDim: 768 });
    kg = createKnowledgeOperations(client);
  }, 30_000);

  afterAll(async () => {
    if (client) {
      try { await client.query('MATCH (n) DETACH DELETE n', { params: {} }); } catch { /* ok */ }
      await client.close();
    }
    try {
      await rm(dataDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }, 15_000);

  it('should create and search for a knowledge entity', async () => {
    const id = await kg.createEntity({
      text: 'FalkorDBLite',
      type: 'Technology',
      confidence: 0.95,
    });

    expect(id).toBeTruthy();

    const found = await kg.searchEntities({ textContains: 'FalkorDBLite' });
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found[0]!.text).toBe('FalkorDBLite');
  });

  it('should create a knowledge relationship', async () => {
    await kg.createEntity({
      text: 'Redis',
      type: 'Technology',
      confidence: 0.9,
    });

    await kg.createRelationship({
      headText: 'FalkorDBLite',
      headType: 'Technology',
      tailText: 'Redis',
      tailType: 'Technology',
      type: 'USES',
      confidence: 0.85,
      fact: 'FalkorDBLite embeds Redis as its storage engine',
    });

    const rels = await kg.getRelationships({ entityText: 'FalkorDBLite' });
    expect(rels.length).toBeGreaterThanOrEqual(1);
  });

  it('should return memory stats', async () => {
    const stats = await kg.getMemoryStats();
    expect(stats.totalEntities).toBeGreaterThanOrEqual(2);
  });
});
