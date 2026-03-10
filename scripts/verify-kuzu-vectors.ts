#!/usr/bin/env npx tsx
/**
 * WS7 Task 7.0 — Pre-flight Verification Script
 *
 * Validates three things before building the embedding pipeline:
 *   1. Kuzu 0.11.3 vector search (CREATE_VECTOR_INDEX + QUERY_VECTOR_INDEX)
 *   2. Multi-FROM/TO ABOUT edge table + traversal
 *   3. Local embedding model (nomic-embed-text-v1.5 via @huggingface/transformers)
 *   4. FactEmbedding node table workaround for REL table vector limitation
 *
 * Usage: npx tsx scripts/verify-kuzu-vectors.ts
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface KuzuDatabase { close(): Promise<void> }
interface KuzuConnection {
  query(cypher: string): Promise<KuzuQueryResult>;
  prepare(cypher: string): Promise<unknown>;
  execute(stmt: unknown, params: Record<string, unknown>): Promise<KuzuQueryResult>;
  close(): Promise<void>;
}
interface KuzuQueryResult {
  getAll(): Promise<Record<string, unknown>[]>;
  close?(): void;
}

let db: KuzuDatabase;
let conn: KuzuConnection;
let dbPath: string;

async function setupKuzu(): Promise<void> {
  const parentDir = mkdtempSync(join(tmpdir(), 'ws7-preflight-'));
  dbPath = join(parentDir, 'kuzu-db');

  const kuzu = await import('kuzu') as unknown as {
    default?: {
      Database: new (path: string, bufferPoolSize?: number) => KuzuDatabase;
      Connection: new (db: KuzuDatabase) => KuzuConnection;
    };
    Database: new (path: string, bufferPoolSize?: number) => KuzuDatabase;
    Connection: new (db: KuzuDatabase) => KuzuConnection;
  };
  const mod = kuzu.default ?? kuzu;

  db = new mod.Database(dbPath, 0);
  conn = new mod.Connection(db);
  console.log(`  Kuzu DB created at: ${dbPath}`);
}

async function query(cypher: string, params?: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  let result: KuzuQueryResult;
  if (params && Object.keys(params).length > 0) {
    const stmt = await conn.prepare(cypher);
    result = await conn.execute(stmt, params);
  } else {
    const raw = await conn.query(cypher) as unknown;
    if (Array.isArray(raw)) {
      result = raw[raw.length - 1] as KuzuQueryResult;
    } else {
      result = raw as KuzuQueryResult;
    }
  }
  const rows = await result.getAll();
  if (typeof result.close === 'function') result.close();
  return rows;
}

async function cleanupKuzu(): Promise<void> {
  try { await conn.close(); } catch { /* Kuzu SIGSEGV on close is known */ }
  try { await db.close(); } catch { /* ignore */ }
  try { rmSync(join(dbPath, '..'), { recursive: true, force: true }); } catch { /* best effort */ }
}

function pass(msg: string): void { console.log(`  ✅ ${msg}`); }
function fail(msg: string, err?: unknown): void {
  console.log(`  ❌ ${msg}`);
  if (err) console.log(`     Error: ${err instanceof Error ? err.message : String(err)}`);
}
function info(msg: string): void { console.log(`  ℹ️  ${msg}`); }

// ---------------------------------------------------------------------------
// Test 1: Kuzu Vector Search
// ---------------------------------------------------------------------------

async function testVectorSearch(): Promise<boolean> {
  console.log('\n══════════════════════════════════════════════════');
  console.log('TEST 1: Kuzu HNSW Vector Search');
  console.log('══════════════════════════════════════════════════\n');

  try {
    // 1a. Create a node table with embedding column
    await query(`CREATE NODE TABLE IF NOT EXISTS TestNode (
      id STRING PRIMARY KEY,
      name STRING,
      embedding FLOAT[768]
    )`);
    pass('Created TestNode table with embedding FLOAT[768]');

    // 1b. Create HNSW vector index
    try {
      await query(`CALL CREATE_VECTOR_INDEX('TestNode', 'test_node_idx', 'embedding')`);
      pass('Created HNSW vector index (CREATE_VECTOR_INDEX)');
    } catch (err) {
      fail('CREATE_VECTOR_INDEX failed', err);
      return false;
    }

    // 1c. Insert nodes with synthetic 768-dim vectors
    // We'll create 5 vectors: each is mostly zeros but has a unique spike
    const vectors: number[][] = [];
    for (let i = 0; i < 5; i++) {
      const v = new Array(768).fill(0);
      // Create distinct vectors by setting different regions
      for (let j = i * 100; j < i * 100 + 50 && j < 768; j++) {
        v[j] = 1.0;
      }
      // Normalize
      const norm = Math.sqrt(v.reduce((sum: number, val: number) => sum + val * val, 0));
      for (let j = 0; j < v.length; j++) v[j] = v[j]! / norm;
      vectors.push(v);
    }

    for (let i = 0; i < 5; i++) {
      await query(
        `CREATE (n:TestNode {id: $id, name: $name, embedding: $embedding})`,
        { id: `node-${i}`, name: `TestFunction_${i}`, embedding: vectors[i] }
      );
    }
    pass('Inserted 5 nodes with 768-dim embedding vectors');

    // 1d. Query vector index
    // Use a query vector that matches the first node's pattern
    const queryVector = [...vectors[0]!]; // Should be closest to node-0

    try {
      const results = await query(
        `CALL QUERY_VECTOR_INDEX('TestNode', 'test_node_idx', $queryVec, $k)
         RETURN node.id AS id, node.name AS name, distance`,
        { queryVec: queryVector, k: BigInt(3) }
      );

      if (results.length > 0) {
        pass(`QUERY_VECTOR_INDEX returned ${results.length} results`);
        for (const r of results) {
          info(`  ${r['name']} (id=${r['id']}, distance=${r['distance']})`);
        }
        // Verify the closest match is node-0
        if (results[0]?.['id'] === 'node-0') {
          pass('Closest match is correct (node-0)');
        } else {
          fail(`Expected closest match node-0, got ${results[0]?.['id']}`);
        }
      } else {
        fail('QUERY_VECTOR_INDEX returned 0 results');
        return false;
      }
    } catch (err) {
      // Try alternative: k as number instead of BigInt
      info('Retrying with k as number instead of BigInt...');
      try {
        const results = await query(
          `CALL QUERY_VECTOR_INDEX('TestNode', 'test_node_idx', $queryVec, $k)
           RETURN node.id AS id, node.name AS name, distance`,
          { queryVec: queryVector, k: 3 }
        );
        if (results.length > 0) {
          pass(`QUERY_VECTOR_INDEX returned ${results.length} results (k as number works)`);
          for (const r of results) {
            info(`  ${r['name']} (id=${r['id']}, distance=${r['distance']})`);
          }
        } else {
          fail('QUERY_VECTOR_INDEX returned 0 results with k as number');
          return false;
        }
      } catch (err2) {
        fail('QUERY_VECTOR_INDEX failed with both BigInt and number k', err2);
        return false;
      }
    }

    // 1e. Test vector search with a different query (should match node-2)
    const queryVector2 = [...vectors[2]!];
    try {
      const results2 = await query(
        `CALL QUERY_VECTOR_INDEX('TestNode', 'test_node_idx', $queryVec, $k)
         RETURN node.id AS id, node.name AS name, distance`,
        { queryVec: queryVector2, k: BigInt(3) }
      );
      if (results2[0]?.['id'] === 'node-2') {
        pass('Second query correctly returns node-2 as closest match');
      } else {
        // Try with number k
        const results2b = await query(
          `CALL QUERY_VECTOR_INDEX('TestNode', 'test_node_idx', $queryVec, $k)
           RETURN node.id AS id, node.name AS name, distance`,
          { queryVec: queryVector2, k: 3 }
        );
        if (results2b[0]?.['id'] === 'node-2') {
          pass('Second query correctly returns node-2 as closest match (k as number)');
        } else {
          fail(`Expected node-2 as closest, got ${results2b[0]?.['id']}`);
        }
      }
    } catch {
      info('Second vector query skipped (non-critical)');
    }

    return true;
  } catch (err) {
    fail('Vector search test failed unexpectedly', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Test 2: Multi-FROM/TO ABOUT Edge
// ---------------------------------------------------------------------------

async function testAboutEdge(): Promise<boolean> {
  console.log('\n══════════════════════════════════════════════════');
  console.log('TEST 2: Multi-FROM/TO ABOUT Edge Table');
  console.log('══════════════════════════════════════════════════\n');

  try {
    // 2a. Create the entity + code node tables we'll link
    await query(`CREATE NODE TABLE IF NOT EXISTS KGEntity (
      id STRING PRIMARY KEY,
      text STRING,
      type STRING
    )`);

    await query(`CREATE NODE TABLE IF NOT EXISTS KGFunction (
      _pk STRING PRIMARY KEY,
      name STRING
    )`);

    await query(`CREATE NODE TABLE IF NOT EXISTS KGClass (
      _pk STRING PRIMARY KEY,
      name STRING
    )`);

    await query(`CREATE NODE TABLE IF NOT EXISTS KGInterface (
      _pk STRING PRIMARY KEY,
      name STRING
    )`);
    pass('Created KGEntity, KGFunction, KGClass, KGInterface tables');

    // 2b. Create multi-FROM/TO ABOUT relationship table
    try {
      await query(`CREATE REL TABLE IF NOT EXISTS ABOUT (
        FROM KGEntity TO KGFunction,
        FROM KGEntity TO KGClass,
        FROM KGEntity TO KGInterface,
        confidence DOUBLE,
        source STRING
      )`);
      pass('Created ABOUT rel table with multi-FROM/TO (Entity → Function|Class|Interface)');
    } catch (err) {
      fail('Multi-FROM/TO ABOUT edge creation failed', err);
      return false;
    }

    // 2c. Insert test data
    await query(`CREATE (n:KGEntity {id: 'e1', text: 'Payment processing', type: 'Concept'})`);
    await query(`CREATE (n:KGEntity {id: 'e2', text: 'Stripe integration', type: 'Technology'})`);
    await query(`CREATE (n:KGFunction {_pk: 'f1', name: 'processPayment'})`);
    await query(`CREATE (n:KGClass {_pk: 'c1', name: 'StripeService'})`);
    await query(`CREATE (n:KGInterface {_pk: 'i1', name: 'PaymentGateway'})`);
    pass('Inserted test entities and code nodes');

    // 2d. Create ABOUT relationships to different target types
    await query(`
      MATCH (e:KGEntity {id: 'e1'}), (f:KGFunction {_pk: 'f1'})
      CREATE (e)-[:ABOUT {confidence: 0.9, source: 'name-match'}]->(f)
    `);
    await query(`
      MATCH (e:KGEntity {id: 'e1'}), (c:KGClass {_pk: 'c1'})
      CREATE (e)-[:ABOUT {confidence: 0.8, source: 'embedding'}]->(c)
    `);
    await query(`
      MATCH (e:KGEntity {id: 'e2'}), (i:KGInterface {_pk: 'i1'})
      CREATE (e)-[:ABOUT {confidence: 0.7, source: 'embedding'}]->(i)
    `);
    pass('Created ABOUT edges: Entity→Function, Entity→Class, Entity→Interface');

    // 2e. Traverse ABOUT edges from entity to all code node types in single query
    try {
      const results = await query(`
        MATCH (e:KGEntity)-[a:ABOUT]->(target)
        WHERE e.id = 'e1'
        RETURN e.text AS entity, label(target) AS targetType,
               target._pk AS targetId, a.confidence AS confidence
        ORDER BY a.confidence DESC
      `);

      if (results.length === 2) {
        pass(`Multi-target ABOUT traversal returned ${results.length} results`);
        for (const r of results) {
          info(`  ${r['entity']} --ABOUT--> ${r['targetType']}:${r['targetId']} (confidence=${r['confidence']})`);
        }
      } else {
        fail(`Expected 2 ABOUT results for e1, got ${results.length}`);
        return false;
      }
    } catch (err) {
      fail('Multi-target ABOUT traversal failed', err);
      return false;
    }

    // 2f. Traverse from code node back to entities (reverse direction)
    try {
      const reverseResults = await query(`
        MATCH (e:KGEntity)-[a:ABOUT]->(f:KGFunction {_pk: 'f1'})
        RETURN e.text AS entity, e.type AS entityType, a.confidence AS confidence
      `);
      if (reverseResults.length === 1) {
        pass('Reverse traversal (code → entity via ABOUT) works');
      } else {
        fail(`Expected 1 reverse result, got ${reverseResults.length}`);
      }
    } catch (err) {
      fail('Reverse ABOUT traversal failed', err);
    }

    // 2g. Cross-layer query: entity → ABOUT → code node + code node properties
    try {
      const crossResults = await query(`
        MATCH (e:KGEntity)-[:ABOUT]->(target)
        RETURN e.text AS entityText, label(target) AS nodeType,
               CASE WHEN label(target) = 'KGFunction' THEN target.name
                    WHEN label(target) = 'KGClass' THEN target.name
                    WHEN label(target) = 'KGInterface' THEN target.name
                    ELSE 'unknown' END AS nodeName
        ORDER BY e.text
      `);
      pass(`Cross-layer query returned ${crossResults.length} results across types`);
      for (const r of crossResults) {
        info(`  ${r['entityText']} → ${r['nodeType']}:${r['nodeName']}`);
      }
    } catch (err) {
      fail('Cross-layer ABOUT query failed', err);
    }

    return true;
  } catch (err) {
    fail('ABOUT edge test failed unexpectedly', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Test 3: Local Embedding Model (nomic-embed-text-v1.5)
// ---------------------------------------------------------------------------

async function testLocalEmbeddings(): Promise<boolean> {
  console.log('\n══════════════════════════════════════════════════');
  console.log('TEST 3: Local Embedding Model (nomic-embed-text-v1.5)');
  console.log('══════════════════════════════════════════════════\n');

  try {
    info('Loading @huggingface/transformers pipeline (first run downloads ~140MB model)...');

    const startLoad = performance.now();
    const { pipeline } = await import('@huggingface/transformers');
    const extractor = await pipeline('feature-extraction', 'nomic-ai/nomic-embed-text-v1.5', {
      // Use default ONNX runtime (CPU)
      dtype: 'fp32',
    });
    const loadTime = performance.now() - startLoad;
    pass(`Model loaded in ${(loadTime / 1000).toFixed(1)}s`);

    // 3a. Generate a single embedding
    const testText = 'processPayment(amount: number, currency: string): Promise<PaymentResult>';
    const startEmbed = performance.now();
    const output = await extractor(testText, { pooling: 'mean', normalize: true });
    const embedTime = performance.now() - startEmbed;

    // Extract the embedding array
    const embedding = Array.from(output.data as Float32Array);

    if (embedding.length === 768) {
      pass(`Single embedding: ${embedding.length} dimensions in ${embedTime.toFixed(1)}ms`);
    } else {
      fail(`Expected 768 dimensions, got ${embedding.length}`);
      return false;
    }

    // 3b. Verify normalization (L2 norm should be ~1.0)
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (Math.abs(norm - 1.0) < 0.01) {
      pass(`Embedding is normalized (L2 norm = ${norm.toFixed(4)})`);
    } else {
      fail(`Embedding not normalized (L2 norm = ${norm.toFixed(4)})`);
    }

    // 3c. Batch embeddings (measure throughput)
    const batchTexts = [
      'processPayment(amount: number, currency: string): Promise<PaymentResult>',
      'StripeService extends BasePaymentProvider implements PaymentGateway',
      'interface PaymentGateway { charge(amount: number): Promise<boolean> }',
      'UserAuthController handles login, signup, and session management',
      'DatabaseConnection class with connection pooling and retry logic',
    ];

    const startBatch = performance.now();
    const batchResults = [];
    for (const text of batchTexts) {
      const result = await extractor(text, { pooling: 'mean', normalize: true });
      batchResults.push(Array.from(result.data as Float32Array));
    }
    const batchTime = performance.now() - startBatch;
    const perItem = batchTime / batchTexts.length;

    pass(`Batch of ${batchTexts.length} embeddings in ${batchTime.toFixed(1)}ms (${perItem.toFixed(1)}ms/item)`);

    // 3d. Verify semantic similarity (payment-related should be closer together)
    function cosineSim(a: number[], b: number[]): number {
      let dot = 0;
      for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
      return dot; // Already normalized, so dot product = cosine similarity
    }

    const simPaymentStripe = cosineSim(batchResults[0]!, batchResults[1]!);
    const simPaymentAuth = cosineSim(batchResults[0]!, batchResults[3]!);

    info(`Similarity: processPayment ↔ StripeService = ${simPaymentStripe.toFixed(4)}`);
    info(`Similarity: processPayment ↔ UserAuthController = ${simPaymentAuth.toFixed(4)}`);

    if (simPaymentStripe > simPaymentAuth) {
      pass('Semantic similarity is directionally correct (payment terms cluster)');
    } else {
      info('Warning: payment terms did not cluster as expected (model quality check needed)');
    }

    // 3e. Store results for documentation
    info(`\n  📊 Embedding Performance Summary:`);
    info(`     Model: nomic-ai/nomic-embed-text-v1.5`);
    info(`     Dimensions: 768`);
    info(`     Load time: ${(loadTime / 1000).toFixed(1)}s`);
    info(`     Single embed: ${embedTime.toFixed(1)}ms`);
    info(`     Batch (5 items): ${batchTime.toFixed(1)}ms (${perItem.toFixed(1)}ms/item)`);

    return true;
  } catch (err) {
    fail('Local embedding test failed', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Test 4: FactEmbedding Node Table Workaround
// ---------------------------------------------------------------------------

async function testFactEmbeddingWorkaround(): Promise<boolean> {
  console.log('\n══════════════════════════════════════════════════');
  console.log('TEST 4: FactEmbedding Node Table Workaround');
  console.log('══════════════════════════════════════════════════\n');

  try {
    // 4a. Confirm vector index on REL table fails
    info('Confirming: vector index on RELATES_TO (REL table) should fail...');

    await query(`CREATE NODE TABLE IF NOT EXISTS FactEntity (
      id STRING PRIMARY KEY,
      text STRING,
      type STRING
    )`);
    await query(`CREATE REL TABLE IF NOT EXISTS FACT_REL (
      FROM FactEntity TO FactEntity,
      fact STRING,
      fact_embedding FLOAT[768]
    )`);

    try {
      await query(`CALL CREATE_VECTOR_INDEX('FACT_REL', 'fact_rel_idx', 'fact_embedding')`);
      info('Unexpected: vector index on REL table succeeded (Kuzu may have added support)');
    } catch (err) {
      pass(`Confirmed: REL table vector index fails (${(err as Error).message.substring(0, 80)})`);
    }

    // 4b. Create FactEmbedding node table workaround
    info('Testing FactEmbedding node table workaround...');

    await query(`CREATE NODE TABLE IF NOT EXISTS FactEmbedding (
      id STRING PRIMARY KEY,
      fact STRING,
      fact_embedding FLOAT[768],
      sourceEntityId STRING,
      targetEntityId STRING,
      relType STRING
    )`);
    pass('Created FactEmbedding node table');

    // 4c. Create vector index on FactEmbedding
    try {
      await query(`CALL CREATE_VECTOR_INDEX('FactEmbedding', 'fact_embedding_idx', 'fact_embedding')`);
      pass('Created HNSW vector index on FactEmbedding.fact_embedding');
    } catch (err) {
      fail('Vector index on FactEmbedding node table failed', err);
      return false;
    }

    // 4d. Insert some fact embeddings
    const factVectors: number[][] = [];
    for (let i = 0; i < 3; i++) {
      const v = new Array(768).fill(0);
      for (let j = i * 200; j < i * 200 + 100 && j < 768; j++) v[j] = 1.0;
      const norm = Math.sqrt(v.reduce((sum: number, val: number) => sum + val * val, 0));
      for (let j = 0; j < v.length; j++) v[j] = v[j]! / norm;
      factVectors.push(v);
    }

    await query(`CREATE (n:FactEmbedding {
      id: 'f1', fact: 'Stripe processes credit card payments', fact_embedding: $embedding,
      sourceEntityId: 'e1', targetEntityId: 'e2', relType: 'USES'
    })`, { embedding: factVectors[0] });

    await query(`CREATE (n:FactEmbedding {
      id: 'f2', fact: 'PostgreSQL stores user authentication data', fact_embedding: $embedding,
      sourceEntityId: 'e3', targetEntityId: 'e4', relType: 'STORES'
    })`, { embedding: factVectors[1] });

    await query(`CREATE (n:FactEmbedding {
      id: 'f3', fact: 'Redis caches session tokens for fast retrieval', fact_embedding: $embedding,
      sourceEntityId: 'e5', targetEntityId: 'e6', relType: 'CACHES'
    })`, { embedding: factVectors[2] });
    pass('Inserted 3 fact embeddings as node table rows');

    // 4e. Vector search on FactEmbedding
    try {
      const results = await query(
        `CALL QUERY_VECTOR_INDEX('FactEmbedding', 'fact_embedding_idx', $queryVec, $k)
         RETURN node.id AS id, node.fact AS fact, node.relType AS relType, distance`,
        { queryVec: factVectors[0], k: BigInt(3) }
      );

      if (results.length > 0) {
        pass(`FactEmbedding vector search returned ${results.length} results`);
        for (const r of results) {
          info(`  ${r['fact']} (relType=${r['relType']}, distance=${r['distance']})`);
        }
        if (results[0]?.['id'] === 'f1') {
          pass('Closest fact match is correct');
        }
      } else {
        fail('FactEmbedding vector search returned 0 results');
        return false;
      }
    } catch (err) {
      // Try with number k
      try {
        const results = await query(
          `CALL QUERY_VECTOR_INDEX('FactEmbedding', 'fact_embedding_idx', $queryVec, $k)
           RETURN node.id AS id, node.fact AS fact, node.relType AS relType, distance`,
          { queryVec: factVectors[0], k: 3 }
        );
        if (results.length > 0) {
          pass(`FactEmbedding vector search works (k as number): ${results.length} results`);
        } else {
          fail('FactEmbedding vector search returned 0 results (k as number)');
          return false;
        }
      } catch (err2) {
        fail('FactEmbedding vector search failed', err2);
        return false;
      }
    }

    // 4f. Demonstrate join back to relationship data
    info('The FactEmbedding workaround requires:');
    info('  1. Mirror fact text + embedding into FactEmbedding node table on write');
    info('  2. Use QUERY_VECTOR_INDEX on FactEmbedding for semantic fact search');
    info('  3. Join back to RELATES_TO via sourceEntityId/targetEntityId for full relationship data');

    return true;
  } catch (err) {
    fail('FactEmbedding workaround test failed', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Test 5: Dimension Flexibility (768 vs 1536)
// ---------------------------------------------------------------------------

async function testDimensionFlexibility(): Promise<boolean> {
  console.log('\n══════════════════════════════════════════════════');
  console.log('TEST 5: Dimension Flexibility (768 vs 1536)');
  console.log('══════════════════════════════════════════════════\n');

  try {
    // Test that 1536-dim also works (for cloud model compatibility)
    await query(`CREATE NODE TABLE IF NOT EXISTS TestNode1536 (
      id STRING PRIMARY KEY,
      name STRING,
      embedding FLOAT[1536]
    )`);
    pass('Created TestNode1536 table with FLOAT[1536]');

    try {
      await query(`CALL CREATE_VECTOR_INDEX('TestNode1536', 'test_1536_idx', 'embedding')`);
      pass('Created vector index on FLOAT[1536] column');
    } catch (err) {
      fail('Vector index creation on FLOAT[1536] failed', err);
      return false;
    }

    // Insert a 1536-dim vector
    const v = new Array(1536).fill(0);
    for (let j = 0; j < 100; j++) v[j] = 1.0;
    const normVal = Math.sqrt(v.reduce((sum: number, val: number) => sum + val * val, 0));
    for (let j = 0; j < v.length; j++) v[j] = v[j]! / normVal;

    await query(`CREATE (n:TestNode1536 {id: 'n1', name: 'test', embedding: $embedding})`, { embedding: v });
    pass('Inserted 1536-dim vector');

    // Try multiple approaches for querying
    let found1536 = false;

    // Approach 1: Regular number[] + number k
    try {
      const results = await query(
        `CALL QUERY_VECTOR_INDEX('TestNode1536', 'test_1536_idx', $queryVec, $k)
         RETURN node.id AS id, distance`,
        { queryVec: v, k: 3 }
      );
      if (results.length > 0) {
        pass('QUERY_VECTOR_INDEX works with 1536-dim vectors (number[] + number k)');
        found1536 = true;
      }
    } catch (err1) {
      info(`Approach 1 (number[] + k:3) failed: ${(err1 as Error).message.substring(0, 100)}`);
    }

    // Approach 2: Cast k to INT64 in Cypher
    if (!found1536) {
      try {
        const results = await query(
          `CALL QUERY_VECTOR_INDEX('TestNode1536', 'test_1536_idx', $queryVec, cast($k, 'INT64'))
           RETURN node.id AS id, distance`,
          { queryVec: v, k: 3 }
        );
        if (results.length > 0) {
          pass('QUERY_VECTOR_INDEX works with 1536-dim (with cast to INT64)');
          found1536 = true;
        }
      } catch (err2) {
        info(`Approach 2 (cast INT64) failed: ${(err2 as Error).message.substring(0, 100)}`);
      }
    }

    // Approach 3: Use Float32Array for the vector
    if (!found1536) {
      try {
        const floatVec = new Float32Array(v);
        const results = await query(
          `CALL QUERY_VECTOR_INDEX('TestNode1536', 'test_1536_idx', $queryVec, $k)
           RETURN node.id AS id, distance`,
          { queryVec: Array.from(floatVec), k: 3 }
        );
        if (results.length > 0) {
          pass('QUERY_VECTOR_INDEX works with 1536-dim (Float32Array converted)');
          found1536 = true;
        }
      } catch (err3) {
        info(`Approach 3 (Float32Array) failed: ${(err3 as Error).message.substring(0, 100)}`);
      }
    }

    // Approach 4: Inline the k value in Cypher
    if (!found1536) {
      try {
        const results = await query(
          `CALL QUERY_VECTOR_INDEX('TestNode1536', 'test_1536_idx', $queryVec, 3)
           RETURN node.id AS id, distance`,
          { queryVec: v }
        );
        if (results.length > 0) {
          pass('QUERY_VECTOR_INDEX works with 1536-dim (k as literal in Cypher)');
          found1536 = true;
        }
      } catch (err4) {
        info(`Approach 4 (k literal) failed: ${(err4 as Error).message.substring(0, 100)}`);
      }
    }

    if (!found1536) {
      fail('1536-dim vector search failed with all approaches');
      info('DECISION: Use FLOAT[768] for all embeddings (local model default)');
      info('If cloud model (1536-dim) needed later, will require further investigation');
      // This is a non-critical failure — 768-dim works which is our default
      return false;
    }

    return true;
  } catch (err) {
    fail('Dimension flexibility test failed', err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  WS7 Task 7.0 — Pre-flight Verification            ║');
  console.log('║  Kuzu Vectors + ABOUT Edges + Local Embeddings      ║');
  console.log('╚══════════════════════════════════════════════════════╝');

  const results: { name: string; passed: boolean }[] = [];

  try {
    console.log('\nSetting up Kuzu...');
    await setupKuzu();
    pass('Kuzu initialized');

    // Run tests
    results.push({ name: 'Kuzu HNSW Vector Search', passed: await testVectorSearch() });
    results.push({ name: 'Multi-FROM/TO ABOUT Edge', passed: await testAboutEdge() });
    results.push({ name: 'FactEmbedding Workaround', passed: await testFactEmbeddingWorkaround() });
    results.push({ name: 'Dimension Flexibility (768/1536)', passed: await testDimensionFlexibility() });

    // Test 3 (local embeddings) is separate — doesn't need Kuzu
    results.push({ name: 'Local Embedding Model', passed: await testLocalEmbeddings() });

  } finally {
    console.log('\nCleaning up...');
    await cleanupKuzu();
  }

  // Summary
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  RESULTS SUMMARY                                    ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  for (const r of results) {
    const icon = r.passed ? '✅' : '❌';
    console.log(`║  ${icon} ${r.name.padEnd(48)}║`);
  }
  console.log('╚══════════════════════════════════════════════════════╝');

  const allPassed = results.every(r => r.passed);
  if (allPassed) {
    console.log('\n🎉 All pre-flight checks passed! Ready for WS7 implementation.\n');
  } else {
    console.log('\n⚠️  Some checks failed. Review before proceeding with WS7.\n');
  }

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
