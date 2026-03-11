/**
 * ABOUT Edge Integration Tests
 *
 * Tests ABOUT edges that bridge knowledge entities to code graph nodes.
 * Runs against FalkorDB Docker.
 *
 * ABOUT edges connect the knowledge layer (entities from conversations,
 * decisions, bug reports) to the code graph layer (functions, classes, files).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type GraphClient } from '../client';
import { createOperations, type GraphOperations } from '../operations';
import {
  createKnowledgeOperations,
  type KnowledgeOperations,
  type AboutEdgeInput,
} from '../knowledge-operations';
import type { FileEntity, FunctionEntity, ClassEntity } from '@codegraph/types';

// ============================================================================
// Test Fixtures
// ============================================================================

const TEST_GRAPH = `test_about_${Date.now()}`;

function makeFile(overrides?: Partial<FileEntity>): FileEntity {
  return {
    path: '/src/payment.ts',
    name: 'payment.ts',
    extension: 'ts',
    loc: 200,
    lastModified: '2025-01-01T00:00:00Z',
    hash: 'pay123',
    ...overrides,
  };
}

function makeFunction(overrides?: Partial<FunctionEntity>): FunctionEntity {
  return {
    name: 'processPayment',
    filePath: '/src/payment.ts',
    startLine: 10,
    endLine: 50,
    isExported: true,
    isAsync: true,
    isArrow: false,
    params: ['amount', 'currency'],
    ...overrides,
  };
}

function makeClass(overrides?: Partial<ClassEntity>): ClassEntity {
  return {
    name: 'PaymentService',
    filePath: '/src/payment.ts',
    startLine: 60,
    endLine: 150,
    isExported: true,
    isAbstract: false,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ABOUT Edges (Entity → Code Node)', () => {
  let client: GraphClient;
  let ops: GraphOperations;
  let kg: KnowledgeOperations;

  beforeAll(async () => {
    client = await createClient({
      driver: 'falkordb',
      graphName: TEST_GRAPH,
    });
    await client.ensureIndexes();
    ops = createOperations(client);
    kg = createKnowledgeOperations(client);

    // Seed code graph nodes
    await ops.upsertFile(makeFile());
    await ops.upsertFunction(makeFunction());
    await ops.upsertFunction(makeFunction({
      name: 'retryWithBackoff',
      filePath: '/src/payment.ts',
      startLine: 55,
      endLine: 75,
    }));
    await ops.upsertClass(makeClass());

    // Seed knowledge entities
    await kg.createEntity({
      text: 'Payment Bug #1234',
      type: 'Bug',
      confidence: 0.95,
    });
    await kg.createEntity({
      text: 'Retry Logic Decision',
      type: 'Decision',
      confidence: 0.90,
    });
    await kg.createEntity({
      text: 'Alice',
      type: 'Person',
      confidence: 0.99,
    });
  }, 30_000);

  afterAll(async () => {
    if (client) {
      try {
        await client.query('MATCH (n) DETACH DELETE n', { params: {} });
      } catch { /* ok */ }
      await client.close();
    }
  }, 15_000);

  // ---------- Create ABOUT edges ----------

  it('should create an ABOUT edge from entity to function', async () => {
    const input: AboutEdgeInput = {
      entityText: 'Payment Bug #1234',
      entityType: 'Bug',
      targetLabel: 'Function',
      targetKey: 'name',
      targetValue: 'processPayment',
      confidence: 1.0,
      method: 'exact_match',
    };

    const created = await kg.createAboutEdge(input);
    expect(created).toBe(true);
  });

  it('should create an ABOUT edge from entity to class', async () => {
    const created = await kg.createAboutEdge({
      entityText: 'Payment Bug #1234',
      entityType: 'Bug',
      targetLabel: 'Class',
      targetKey: 'name',
      targetValue: 'PaymentService',
      confidence: 0.85,
      method: 'embedding_similarity',
    });
    expect(created).toBe(true);
  });

  it('should create an ABOUT edge from entity to file', async () => {
    const created = await kg.createAboutEdge({
      entityText: 'Payment Bug #1234',
      entityType: 'Bug',
      targetLabel: 'File',
      targetKey: 'path',
      targetValue: '/src/payment.ts',
      confidence: 0.75,
      method: 'embedding_similarity',
    });
    expect(created).toBe(true);
  });

  it('should create a second entity→function link', async () => {
    const created = await kg.createAboutEdge({
      entityText: 'Retry Logic Decision',
      entityType: 'Decision',
      targetLabel: 'Function',
      targetKey: 'name',
      targetValue: 'retryWithBackoff',
      confidence: 0.92,
      method: 'exact_match',
    });
    expect(created).toBe(true);
  });

  // ---------- Upsert / MERGE ----------

  it('should upsert (not duplicate) on repeated create', async () => {
    // Create the same edge again with higher confidence
    await kg.createAboutEdge({
      entityText: 'Payment Bug #1234',
      entityType: 'Bug',
      targetLabel: 'Function',
      targetKey: 'name',
      targetValue: 'processPayment',
      confidence: 0.99,
      method: 'llm_verified',
    });

    // Should still be just one edge, not two
    const edges = await kg.getAboutEdgesForEntity('Payment Bug #1234', 'Bug');
    const fnEdges = edges.filter(e => e.targetLabel === 'Function' && e.targetValue === 'processPayment');
    expect(fnEdges).toHaveLength(1);
    // Confidence should be updated to the higher value
    expect(fnEdges[0]!.confidence).toBeGreaterThanOrEqual(0.99);
  });

  // ---------- Query: entity → code nodes ----------

  it('should get all ABOUT edges for an entity', async () => {
    const edges = await kg.getAboutEdgesForEntity('Payment Bug #1234', 'Bug');
    expect(edges.length).toBeGreaterThanOrEqual(3);

    // Should have links to Function, Class, and File
    const labels = edges.map(e => e.targetLabel);
    expect(labels).toContain('Function');
    expect(labels).toContain('Class');
    expect(labels).toContain('File');
  });

  // ---------- Query: code node → entities ----------

  it('should get entities linked to a function', async () => {
    const edges = await kg.getAboutEdgesForCodeNode('Function', 'processPayment');
    expect(edges.length).toBeGreaterThanOrEqual(1);
    expect(edges[0]!.entityText).toBe('Payment Bug #1234');
  });

  it('should get entities linked to a file', async () => {
    const edges = await kg.getAboutEdgesForCodeNode('File', '/src/payment.ts');
    expect(edges.length).toBeGreaterThanOrEqual(1);
    expect(edges[0]!.entityText).toBe('Payment Bug #1234');
  });

  // ---------- Count ----------

  it('should count all ABOUT edges', async () => {
    const count = await kg.countAboutEdges();
    expect(count).toBeGreaterThanOrEqual(4); // 3 for Bug + 1 for Decision
  });

  // ---------- Delete ----------

  it('should delete a specific ABOUT edge', async () => {
    const deleted = await kg.deleteAboutEdge(
      'Payment Bug #1234',
      'Bug',
      'File',
      '/src/payment.ts',
    );
    expect(deleted).toBe(true);

    // Verify it's gone
    const edges = await kg.getAboutEdgesForCodeNode('File', '/src/payment.ts');
    const bugEdges = edges.filter(e => e.entityText === 'Payment Bug #1234');
    expect(bugEdges).toHaveLength(0);
  });

  // ---------- Edge cases ----------

  it('should return false when entity or target does not exist', async () => {
    const created = await kg.createAboutEdge({
      entityText: 'NonexistentEntity',
      entityType: 'Bug',
      targetLabel: 'Function',
      targetKey: 'name',
      targetValue: 'doesNotExist',
      confidence: 0.5,
      method: 'manual',
    });
    // No matching nodes → no edge created
    expect(created).toBe(false);
  });

  it('should throw for unsupported target label', async () => {
    await expect(
      kg.createAboutEdge({
        entityText: 'Payment Bug #1234',
        entityType: 'Bug',
        targetLabel: 'UnsupportedLabel',
        targetKey: 'name',
        targetValue: 'test',
        confidence: 0.5,
        method: 'manual',
      })
    ).rejects.toThrow('unsupported target label');
  });

  it('should return empty array for entity with no ABOUT edges', async () => {
    const edges = await kg.getAboutEdgesForEntity('Alice', 'Person');
    expect(edges).toHaveLength(0);
  });
});
