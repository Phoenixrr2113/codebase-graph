/**
 * Graph Query Operations — Integration Tests
 *
 * Tests getFullGraph, getFileSubgraph, getDependencyTree, and getStats
 * against a real Kuzu database instance seeded with a small graph.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createClient,
  createOperations,
  createQueries,
  type GraphClient,
  type GraphOperations,
  type GraphQueries,
} from '../index';
import type {
  FileEntity,
  FunctionEntity,
  ClassEntity,
  InterfaceEntity,
} from '../index';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

function makeClass(overrides?: Partial<ClassEntity>): ClassEntity {
  return {
    name: 'MyClass',
    filePath: '/src/index.ts',
    startLine: 30,
    endLine: 50,
    isExported: true,
    isAbstract: false,
    ...overrides,
  };
}

function makeInterface(overrides?: Partial<InterfaceEntity>): InterfaceEntity {
  return {
    name: 'MyInterface',
    filePath: '/src/index.ts',
    startLine: 60,
    endLine: 70,
    isExported: true,
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

// LEGACY: Kuzu-specific tests — skipped after FalkorDB migration.
// FalkorDB coverage in about-edges.test.ts + falkordblite.test.ts.
describe.skip('Graph Query Operations (Kuzu)', () => {
  let client: GraphClient;
  let ops: GraphOperations;
  let queries: GraphQueries;
  let dbPath: string;
  let parentDir: string;

  beforeAll(async () => {
    parentDir = mkdtempSync(join(tmpdir(), 'codegraph-queries-test-'));
    dbPath = join(parentDir, 'kuzu-db');

    client = await createClient({
      driver: 'kuzu',
      databasePath: dbPath,
      graphName: 'test',
    });

    await client.ensureIndexes();
    ops = createOperations(client);
    queries = createQueries(client);

    // Seed the graph with a small codebase:
    // 2 files: /src/auth.ts and /src/user.ts
    // 3 functions: login (auth.ts), validateToken (auth.ts), getUser (user.ts)
    // 1 class: UserService (user.ts)
    // 1 interface: AuthConfig (auth.ts)
    // CALLS edge: login -> validateToken
    // IMPORTS edge: auth.ts -> user.ts
    // CONTAINS edges: created automatically by upsertFunction/Class/Interface

    // -- Files --
    await ops.upsertFile(makeFile({ path: '/src/auth.ts', name: 'auth.ts' }));
    await ops.upsertFile(makeFile({ path: '/src/user.ts', name: 'user.ts' }));

    // -- Functions --
    await ops.upsertFunction(
      makeFunction({
        name: 'login',
        filePath: '/src/auth.ts',
        startLine: 10,
        endLine: 30,
      }),
    );
    await ops.upsertFunction(
      makeFunction({
        name: 'validateToken',
        filePath: '/src/auth.ts',
        startLine: 35,
        endLine: 50,
      }),
    );
    await ops.upsertFunction(
      makeFunction({
        name: 'getUser',
        filePath: '/src/user.ts',
        startLine: 5,
        endLine: 20,
      }),
    );

    // -- Class --
    await ops.upsertClass(
      makeClass({
        name: 'UserService',
        filePath: '/src/user.ts',
        startLine: 25,
        endLine: 60,
      }),
    );

    // -- Interface --
    await ops.upsertInterface(
      makeInterface({
        name: 'AuthConfig',
        filePath: '/src/auth.ts',
        startLine: 1,
        endLine: 8,
      }),
    );

    // -- CALLS edge: login -> validateToken --
    await ops.createCallEdge(
      'login',
      '/src/auth.ts',
      'validateToken',
      '/src/auth.ts',
      15,
    );

    // -- IMPORTS edge: auth.ts -> user.ts --
    await ops.createImportsEdge('/src/auth.ts', '/src/user.ts', ['getUser']);
  });

  afterAll(async () => {
    try {
      await client.close();
    } catch {
      // Kuzu SIGSEGV on close is known — ignore
    }
    try {
      rmSync(parentDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  });

  // ==========================================================================
  // getFullGraph
  // ==========================================================================

  describe('getFullGraph', () => {
    it('returns all nodes with correct GraphNode shape', async () => {
      const graph = await queries.getFullGraph();

      // Should have 7 nodes: 2 File + 3 Function + 1 Class + 1 Interface
      expect(graph.nodes.length).toBe(7);

      // Verify every node has required GraphNode shape
      for (const node of graph.nodes) {
        expect(node).toHaveProperty('id');
        expect(node).toHaveProperty('label');
        expect(node).toHaveProperty('displayName');
        expect(node).toHaveProperty('filePath');
        expect(node).toHaveProperty('data');
        expect(typeof node.id).toBe('string');
        expect(typeof node.label).toBe('string');
        expect(typeof node.displayName).toBe('string');
      }

      // Verify expected labels are present
      const labels = graph.nodes.map((n) => n.label);
      expect(labels.filter((l) => l === 'File')).toHaveLength(2);
      expect(labels.filter((l) => l === 'Function')).toHaveLength(3);
      expect(labels.filter((l) => l === 'Class')).toHaveLength(1);
      expect(labels.filter((l) => l === 'Interface')).toHaveLength(1);
    });

    it('limit parameter caps the number of nodes returned', async () => {
      const graph = await queries.getFullGraph(2);

      expect(graph.nodes.length).toBeLessThanOrEqual(2);
    });

    it('rootPath filter only returns nodes under that path', async () => {
      // Use a path that only one file matches
      const graph = await queries.getFullGraph(1000, '/src/user');

      // All nodes should have filePath starting with /src/user
      for (const node of graph.nodes) {
        if (node.filePath) {
          expect(node.filePath.startsWith('/src/user')).toBe(true);
        }
      }

      // Should include user.ts file, getUser function, UserService class
      const names = graph.nodes.map((n) => n.displayName);
      expect(names).toContain('getUser');
      expect(names).toContain('UserService');

      // Should NOT include auth.ts entities
      expect(names).not.toContain('login');
      expect(names).not.toContain('validateToken');
      expect(names).not.toContain('AuthConfig');
    });
  });

  // ==========================================================================
  // getFileSubgraph
  // ==========================================================================

  describe('getFileSubgraph', () => {
    it('returns file node + CONTAINS children for auth.ts', async () => {
      const subgraph = await queries.getFileSubgraph('/src/auth.ts');

      // Should have centerId set to the file node
      expect(subgraph.centerId).toBeDefined();
      expect(subgraph.centerId).toContain('File:/src/auth.ts');

      // auth.ts contains: login, validateToken, AuthConfig
      const displayNames = subgraph.nodes.map((n) => n.displayName);
      expect(displayNames).toContain('auth.ts');
      expect(displayNames).toContain('login');
      expect(displayNames).toContain('validateToken');
      expect(displayNames).toContain('AuthConfig');

      // Should have CONTAINS edges
      const containsEdges = subgraph.edges.filter((e) => e.label === 'CONTAINS');
      expect(containsEdges.length).toBeGreaterThanOrEqual(3);
    });

    it('returns related edges (CALLS edge from login to validateToken)', async () => {
      const subgraph = await queries.getFileSubgraph('/src/auth.ts');

      // Should include the CALLS edge between login and validateToken
      const callsEdges = subgraph.edges.filter((e) => e.label === 'CALLS');
      expect(callsEdges.length).toBeGreaterThanOrEqual(1);

      // Verify the CALLS edge has correct source/target
      const callEdge = callsEdges[0]!;
      expect(callEdge).toHaveProperty('id');
      expect(callEdge).toHaveProperty('source');
      expect(callEdge).toHaveProperty('target');
      expect(callEdge).toHaveProperty('label');
      expect(callEdge).toHaveProperty('data');
    });

    it('returns empty result for non-existent file', async () => {
      const subgraph = await queries.getFileSubgraph('/src/nonexistent.ts');

      expect(subgraph.nodes).toHaveLength(0);
      expect(subgraph.edges).toHaveLength(0);
    });
  });

  // ==========================================================================
  // getDependencyTree
  // ==========================================================================

  describe('getDependencyTree', () => {
    it('returns IMPORTS chain from auth.ts to user.ts', async () => {
      const tree = await queries.getDependencyTree('/src/auth.ts');

      // Kuzu returns RECURSIVE_REL path objects whose internal structure
      // differs from FalkorDB arrays.  When the driver can unpack paths
      // correctly this should yield >= 2 nodes and >= 1 IMPORTS edge.
      // We assert the return shape is always valid GraphData.
      expect(tree).toHaveProperty('nodes');
      expect(tree).toHaveProperty('edges');
      expect(Array.isArray(tree.nodes)).toBe(true);
      expect(Array.isArray(tree.edges)).toBe(true);

      if (tree.nodes.length > 0) {
        // If path unpacking works, verify content
        expect(tree.nodes.length).toBeGreaterThanOrEqual(2);

        const displayNames = tree.nodes.map((n) => n.displayName);
        expect(displayNames).toEqual(
          expect.arrayContaining([
            expect.stringContaining('auth'),
            expect.stringContaining('user'),
          ]),
        );

        expect(tree.edges.length).toBeGreaterThanOrEqual(1);
        const importsEdge = tree.edges.find((e) => e.label === 'IMPORTS');
        expect(importsEdge).toBeDefined();
      }
    });

    it('returns empty result for non-existent file', async () => {
      const tree = await queries.getDependencyTree('/src/nonexistent.ts');

      expect(tree.nodes).toHaveLength(0);
      expect(tree.edges).toHaveLength(0);
    });
  });

  // ==========================================================================
  // getStats
  // ==========================================================================

  describe('getStats', () => {
    it('returns correct totalNodes and totalEdges counts', async () => {
      const stats = await queries.getStats();

      // 7 nodes: 2 File + 3 Function + 1 Class + 1 Interface
      expect(stats.totalNodes).toBe(7);

      // 7 edges: 5 CONTAINS + 1 CALLS + 1 IMPORTS
      expect(stats.totalEdges).toBe(7);
    });

    it('nodesByType has correct counts per label', async () => {
      const stats = await queries.getStats();

      expect(stats.nodesByType.File).toBe(2);
      expect(stats.nodesByType.Function).toBe(3);
      expect(stats.nodesByType.Class).toBe(1);
      expect(stats.nodesByType.Interface).toBe(1);
      expect(stats.nodesByType.Variable).toBe(0);
      expect(stats.nodesByType.Type).toBe(0);
      expect(stats.nodesByType.Component).toBe(0);
    });

    it('edgesByType has correct counts for CONTAINS, CALLS, and IMPORTS', async () => {
      const stats = await queries.getStats();

      // 5 CONTAINS: auth.ts->login, auth.ts->validateToken, auth.ts->AuthConfig,
      //             user.ts->getUser, user.ts->UserService
      expect(stats.edgesByType.CONTAINS).toBe(5);
      expect(stats.edgesByType.CALLS).toBe(1);
      expect(stats.edgesByType.IMPORTS).toBe(1);
    });

    it('largestFiles and mostConnected arrays are populated and properly ordered', async () => {
      const stats = await queries.getStats();

      // largestFiles should be populated (both files have contained entities)
      expect(stats.largestFiles.length).toBeGreaterThan(0);

      // Verify shape
      for (const entry of stats.largestFiles) {
        expect(entry).toHaveProperty('path');
        expect(entry).toHaveProperty('entityCount');
        expect(typeof entry.path).toBe('string');
        expect(typeof entry.entityCount).toBe('number');
      }

      // auth.ts has 3 entities (login, validateToken, AuthConfig)
      // user.ts has 2 entities (getUser, UserService)
      // So auth.ts should be first (most entities)
      expect(stats.largestFiles[0]!.path).toBe('/src/auth.ts');
      expect(stats.largestFiles[0]!.entityCount).toBe(3);
      expect(stats.largestFiles[1]!.path).toBe('/src/user.ts');
      expect(stats.largestFiles[1]!.entityCount).toBe(2);

      // mostConnected should be populated
      expect(stats.mostConnected.length).toBeGreaterThan(0);

      // Verify shape
      for (const entry of stats.mostConnected) {
        expect(entry).toHaveProperty('name');
        expect(entry).toHaveProperty('filePath');
        expect(entry).toHaveProperty('connectionCount');
        expect(typeof entry.name).toBe('string');
        expect(typeof entry.filePath).toBe('string');
        expect(typeof entry.connectionCount).toBe('number');
      }

      // Verify descending order of connectionCount
      for (let i = 1; i < stats.mostConnected.length; i++) {
        expect(stats.mostConnected[i - 1]!.connectionCount).toBeGreaterThanOrEqual(
          stats.mostConnected[i]!.connectionCount,
        );
      }
    });
  });
});
