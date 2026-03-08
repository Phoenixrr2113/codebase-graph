/**
 * End-to-End Smoke Test
 *
 * Exercises the full pipeline: real parser + Kuzu DB + indexer + service queries.
 *
 * Creates a temp directory with 3 TypeScript files, indexes them into a temp
 * Kuzu database via indexProject(), then queries results via createQueries()
 * and direct client.roQuery().
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createClient, createQueries, type GraphClient, type GraphQueries } from '@codegraph/graph';
import { indexProject } from '../indexer';
import type { IndexResult } from '../indexer';

// ============================================================================
// Source File Contents
// ============================================================================

const authCode = `\
export interface AuthConfig {
  secret: string;
  expiresIn: number;
}

export async function validateToken(token: string): Promise<boolean> {
  return token.length > 0;
}

export function login(username: string, password: string): string {
  const isValid = validateToken(username);
  return username;
}
`;

const userCode = `\
import { AuthConfig } from './auth';

export class UserService {
  private config: AuthConfig;

  constructor(config: AuthConfig) {
    this.config = config;
  }

  getUser(id: string): string {
    return id;
  }
}

export function createUser(name: string): string {
  return name;
}
`;

const utilsCode = `\
export const MAX_RETRIES = 3;

export function retry<T>(fn: () => T, times: number = MAX_RETRIES): T {
  return fn();
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
`;

// ============================================================================
// Setup / Teardown
// ============================================================================

let client: GraphClient;
let queries: GraphQueries;
let projectDir: string;
let dbPath: string;
let result: IndexResult;

beforeAll(async () => {
  // Create temp project
  const parentDir = mkdtempSync(join(tmpdir(), 'codegraph-e2e-'));
  projectDir = parentDir;
  const srcDir = join(parentDir, 'src');
  mkdirSync(srcDir, { recursive: true });

  // Write source files
  writeFileSync(join(srcDir, 'auth.ts'), authCode);
  writeFileSync(join(srcDir, 'user.ts'), userCode);
  writeFileSync(join(srcDir, 'utils.ts'), utilsCode);

  // Create Kuzu DB
  const dbParent = mkdtempSync(join(tmpdir(), 'codegraph-e2e-db-'));
  dbPath = join(dbParent, 'kuzu-db');
  client = await createClient({ driver: 'kuzu', databasePath: dbPath, graphName: 'test' });
  await client.ensureIndexes();

  // Index the project with the Kuzu client
  result = await indexProject(projectDir, { client });

  // Create queries instance
  queries = createQueries(client);
}, 60_000); // 60s timeout for indexing + parsing

afterAll(() => {
  // Don't call client.close() — Kuzu SIGSEGV on close kills the fork
  // and prevents vitest from reporting results. The fork exit handles cleanup.
  try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* best effort */ }
  try { rmSync(join(dbPath, '..'), { recursive: true, force: true }); } catch { /* best effort */ }
});

// ============================================================================
// Tests
// ============================================================================

describe('E2E Smoke Test: parser + Kuzu + indexer + queries', () => {
  // ==========================================================================
  // Indexing
  // ==========================================================================

  describe('Indexing', () => {
    it('indexProject succeeds with at least 3 files', () => {
      expect(result.success).toBe(true);
      expect(result.stats.files).toBeGreaterThanOrEqual(3);
      expect(result.stats.errors).toBe(0);
      expect(result.errorMessages).toHaveLength(0);
    });

    it('indexProject creates a project node with correct name', () => {
      expect(result.projectId).toBeTruthy();
      expect(result.projectName).toBeTruthy();
      // The project name is derived from basename of the temp dir
      expect(typeof result.projectName).toBe('string');
      expect(result.projectName.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // Graph Queries (via createQueries)
  // ==========================================================================

  describe('Graph Queries', () => {
    it('getStats returns correct totals', async () => {
      const stats = await queries.getStats();

      expect(stats.totalNodes).toBeGreaterThan(0);
      expect(stats.nodesByType.File).toBeGreaterThanOrEqual(3);
      expect(stats.nodesByType.Function).toBeGreaterThanOrEqual(3);
      expect(stats.nodesByType.Class).toBeGreaterThanOrEqual(1);
    });

    it('getFullGraph returns nodes and edges with correct shape', async () => {
      const graph = await queries.getFullGraph();

      expect(graph.nodes.length).toBeGreaterThan(0);
      expect(graph.edges.length).toBeGreaterThan(0);

      // Verify every node has the required GraphNode shape
      for (const node of graph.nodes) {
        expect(node).toHaveProperty('id');
        expect(node).toHaveProperty('label');
        expect(node).toHaveProperty('displayName');
        expect(node).toHaveProperty('data');
        expect(typeof node.id).toBe('string');
        expect(typeof node.label).toBe('string');
        expect(typeof node.displayName).toBe('string');
      }

      // Verify edges have the required GraphEdge shape
      for (const edge of graph.edges) {
        expect(edge).toHaveProperty('id');
        expect(edge).toHaveProperty('source');
        expect(edge).toHaveProperty('target');
        expect(edge).toHaveProperty('label');
      }
    });

    it('getFileSubgraph returns file contents for auth.ts', async () => {
      const authPath = join(projectDir, 'src', 'auth.ts');
      const subgraph = await queries.getFileSubgraph(authPath);

      // Should contain the file node and its children
      expect(subgraph.nodes.length).toBeGreaterThan(0);

      // Should have a centerId pointing to the file
      expect(subgraph.centerId).toBeDefined();

      // Should contain CONTAINS edges from the file to its children
      const containsEdges = subgraph.edges.filter((e) => e.label === 'CONTAINS');
      expect(containsEdges.length).toBeGreaterThan(0);

      // Should include known entities from auth.ts
      const displayNames = subgraph.nodes.map((n) => n.displayName);
      expect(displayNames).toContain('auth.ts');
    });
  });

  // ==========================================================================
  // Direct Cypher Queries (via client.roQuery)
  // ==========================================================================

  describe('Direct Cypher Queries', () => {
    it('File nodes have correct properties', async () => {
      const res = await client.roQuery<{
        path: string;
        name: string;
        extension: string;
      }>('MATCH (f:File) RETURN f.path as path, f.name as name, f.extension as extension');

      expect(res.data.length).toBeGreaterThanOrEqual(3);

      for (const row of res.data) {
        expect(typeof row.path).toBe('string');
        expect(row.path.length).toBeGreaterThan(0);
        expect(typeof row.name).toBe('string');
        expect(row.name.length).toBeGreaterThan(0);
        expect(row.extension).toBe('ts');
      }

      // Verify all 3 expected files are present
      const names = res.data.map((r) => r.name);
      expect(names).toContain('auth.ts');
      expect(names).toContain('user.ts');
      expect(names).toContain('utils.ts');
    });

    it('CONTAINS edges exist linking files to their entities', async () => {
      const res = await client.roQuery<{ count: number }>(
        'MATCH (:File)-[r:CONTAINS]->() RETURN count(r) as count',
      );

      expect(res.data.length).toBe(1);
      expect(res.data[0]!.count).toBeGreaterThan(0);
    });

    it('Functions have complexity metadata', async () => {
      const res = await client.roQuery<{ count: number }>(
        'MATCH (f:Function) WHERE f.complexity IS NOT NULL RETURN count(f) as count',
      );

      expect(res.data.length).toBe(1);
      expect(res.data[0]!.count).toBeGreaterThan(0);
    });
  });
});
