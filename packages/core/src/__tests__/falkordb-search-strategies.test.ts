/**
 * Search Strategies — FalkorDB Integration Tests
 *
 * Tests the search strategy system against a real FalkorDB Docker instance.
 *
 * Coverage:
 *   1. HYBRID strategy — text + vector search via registry dispatch
 *   2. createDefaultSearchRegistry factory — strategy registration
 *   3. Data verification — seeded graph integrity
 *
 * Prerequisites:
 *   - docker compose up -d falkordb
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';

// Load .env BEFORE any imports that check env vars
const envPath = path.resolve(__dirname, '../../../../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (key && val && !process.env[key]) {
      process.env[key] = val;
    }
  }
}

import {
  createClient,
  type GraphClient,
  createOperations,
  type GraphOperations,
  createKnowledgeOperations,
  type KnowledgeOperations,
} from '@codegraph/graph';

// Mock the plugin-nlp embedding functions (used by hybridSearch internally)
vi.mock('@codegraph/plugin-nlp', async () => {
  const actual = await vi.importActual('@codegraph/plugin-nlp');
  return {
    ...actual,
    isEmbeddingAvailable: vi.fn(() => false),
    generateEmbedding: vi.fn(),
  };
});

import { isEmbeddingAvailable, generateEmbedding } from '@codegraph/plugin-nlp';
import {
  SearchRegistry,
  createDefaultSearchRegistry,
  HybridSearchStrategy,
} from '../search';
import type { SearchRequest, SearchContext } from '../search';

// ============================================================================
// Test Data
// ============================================================================

const DIM = 768;
const GRAPH_NAME = `test_search_strats_${Date.now()}`;

/** Create a synthetic vector with weight on specific dimensions */
function makeVec(weights: Record<number, number>): number[] {
  const vec = new Array(DIM).fill(0);
  for (const [idx, val] of Object.entries(weights)) {
    vec[Number(idx)] = val;
  }
  return vec;
}

// Predefined embeddings for test data (payment-themed scenario)
const AUTH_VEC = makeVec({ 0: 0.0, 1: 1.0, 2: 0.1 });
const LOGIN_VEC = makeVec({ 0: 0.0, 1: 0.9, 2: 0.2 });
const VALIDATE_VEC = makeVec({ 0: 0.1, 1: 0.8, 2: 0.3 });
const HANDLER_VEC = makeVec({ 0: 0.3, 1: 0.3, 2: 0.7 });
const DB_VEC = makeVec({ 0: 0.5, 1: 0.0, 2: 0.8 });

// ============================================================================
// Tests
// ============================================================================

describe('Search Strategies (FalkorDB Integration)', () => {
  let client: GraphClient;
  let ops: GraphOperations;
  let kgOps: KnowledgeOperations;

  beforeAll(async () => {
    // Connect to FalkorDB
    try {
      client = await createClient({
        driver: 'falkordb',
        host: 'localhost',
        port: 6379,
        graphName: GRAPH_NAME,
      });
    } catch (error) {
      console.error('FalkorDB not available — skipping tests. Run: docker compose up -d falkordb');
      throw error;
    }

    await client.ensureIndexes();
    ops = createOperations(client);
    kgOps = createKnowledgeOperations(client);

    // ---- Seed test data: Authentication module scenario ----

    // Files
    await ops.upsertFile({
      path: '/src/auth/login.ts', name: 'login.ts', extension: 'ts',
      loc: 80, lastModified: '2025-01-01T00:00:00Z', hash: 'auth1',
    });
    await ops.upsertFile({
      path: '/src/auth/validate.ts', name: 'validate.ts', extension: 'ts',
      loc: 60, lastModified: '2025-01-01T00:00:00Z', hash: 'auth2',
    });
    await ops.upsertFile({
      path: '/src/api/handler.ts', name: 'handler.ts', extension: 'ts',
      loc: 120, lastModified: '2025-01-01T00:00:00Z', hash: 'api1',
    });
    await ops.upsertFile({
      path: '/src/db/users.ts', name: 'users.ts', extension: 'ts',
      loc: 90, lastModified: '2025-01-01T00:00:00Z', hash: 'db1',
    });

    // Functions
    await ops.upsertFunction({
      name: 'authenticateUser', filePath: '/src/auth/login.ts',
      startLine: 1, endLine: 20, isExported: true, isAsync: true,
      isArrow: false, params: [{ name: 'credentials', type: 'Credentials' }],
      docstring: 'Authenticates a user by validating credentials and issuing a JWT token',
    });
    await ops.upsertFunction({
      name: 'validateToken', filePath: '/src/auth/validate.ts',
      startLine: 1, endLine: 15, isExported: true, isAsync: true,
      isArrow: false, params: [{ name: 'token', type: 'string' }],
      docstring: 'Validates a JWT token and returns the decoded payload',
    });
    await ops.upsertFunction({
      name: 'handleLoginRequest', filePath: '/src/api/handler.ts',
      startLine: 10, endLine: 30, isExported: true, isAsync: true,
      isArrow: false, params: [{ name: 'req', type: 'Request' }],
      docstring: 'HTTP handler for the login endpoint, delegates to authenticateUser',
    });
    await ops.upsertFunction({
      name: 'findUserByEmail', filePath: '/src/db/users.ts',
      startLine: 5, endLine: 20, isExported: true, isAsync: true,
      isArrow: false, params: [{ name: 'email', type: 'string' }],
      docstring: 'Queries the database to find a user by email address',
    });

    // Classes
    await ops.upsertClass({
      name: 'AuthService', filePath: '/src/auth/login.ts',
      startLine: 25, endLine: 75, isExported: true, isAbstract: false,
      docstring: 'Service class that manages user authentication, token issuance, and session handling',
    });

    // Interfaces
    await ops.upsertInterface({
      name: 'Credentials', filePath: '/src/auth/login.ts',
      startLine: 1, endLine: 5, isExported: true,
    });

    // Call edges: handleLoginRequest → authenticateUser → findUserByEmail
    await ops.createCallEdge('handleLoginRequest', '/src/api/handler.ts', 'authenticateUser', '/src/auth/login.ts', 15);
    await ops.createCallEdge('authenticateUser', '/src/auth/login.ts', 'findUserByEmail', '/src/db/users.ts', 8);
    await ops.createCallEdge('authenticateUser', '/src/auth/login.ts', 'validateToken', '/src/auth/validate.ts', 12);

    // Import edges
    await ops.createImportsEdge('/src/api/handler.ts', '/src/auth/login.ts', ['authenticateUser']);
    await ops.createImportsEdge('/src/auth/login.ts', '/src/db/users.ts', ['findUserByEmail']);
    await ops.createImportsEdge('/src/auth/login.ts', '/src/auth/validate.ts', ['validateToken']);

    // Set embeddings on code nodes
    await ops.updateEmbedding(
      'Function', { name: 'authenticateUser', filePath: '/src/auth/login.ts', startLine: 1 },
      AUTH_VEC, 'hash-auth',
    );
    await ops.updateEmbedding(
      'Function', { name: 'handleLoginRequest', filePath: '/src/api/handler.ts', startLine: 10 },
      LOGIN_VEC, 'hash-login',
    );
    await ops.updateEmbedding(
      'Function', { name: 'validateToken', filePath: '/src/auth/validate.ts', startLine: 1 },
      VALIDATE_VEC, 'hash-validate',
    );
    await ops.updateEmbedding(
      'Function', { name: 'findUserByEmail', filePath: '/src/db/users.ts', startLine: 5 },
      DB_VEC, 'hash-db',
    );
    await ops.updateEmbedding(
      'Class', { name: 'AuthService', filePath: '/src/auth/login.ts', startLine: 25 },
      HANDLER_VEC, 'hash-authservice',
    );

    // Knowledge graph entities
    await kgOps.createEntity({
      text: 'Use JWT for authentication',
      type: 'Decision',
      confidence: 0.95,
      embedding: AUTH_VEC,
    });
    await kgOps.createEntity({
      text: 'Token expiry set to 24 hours',
      type: 'Decision',
      confidence: 0.9,
    });

    // ABOUT edges (bridge knowledge → code)
    await kgOps.createAboutEdge({
      entityText: 'Use JWT for authentication',
      entityType: 'Decision',
      targetLabel: 'Function',
      targetKey: 'name',
      targetValue: 'authenticateUser',
      confidence: 0.95,
      method: 'exact_match',
    });
    await kgOps.createAboutEdge({
      entityText: 'Token expiry set to 24 hours',
      entityType: 'Decision',
      targetLabel: 'Function',
      targetKey: 'name',
      targetValue: 'validateToken',
      confidence: 0.85,
      method: 'exact_match',
    });
  }, 60_000);

  afterAll(async () => {
    try { await client.query('MATCH (n) DETACH DELETE n', { params: {} }); } catch { /* best effort */ }
    try { await client.close(); } catch { /* best effort */ }
  });

  // ==========================================================================
  // HYBRID Strategy Tests
  // ==========================================================================

  describe('HYBRID strategy via registry', () => {
    let registry: SearchRegistry;

    beforeAll(() => {
      registry = new SearchRegistry();
      registry.register(new HybridSearchStrategy());
    });

    it('finds functions via text search', async () => {
      vi.mocked(isEmbeddingAvailable).mockReturnValue(false);

      const request: SearchRequest = {
        query: 'authenticateUser',
        type: 'HYBRID',
      };
      const context: SearchContext = { client };

      const response = await registry.search(request, context);

      expect(response.total).toBeGreaterThan(0);
      expect(response.meta.searchType).toBe('HYBRID');
      expect(response.meta.durationMs).toBeGreaterThanOrEqual(0);

      const names = response.results.map(r => r.name);
      expect(names).toContain('authenticateUser');
    });

    it('finds results via vector search when embeddings are available', async () => {
      vi.mocked(isEmbeddingAvailable).mockReturnValue(true);
      vi.mocked(generateEmbedding).mockResolvedValue({
        embedding: makeVec({ 0: 0.0, 1: 0.95, 2: 0.15 }),
        dimensions: DIM,
        provider: 'test',
      });

      const request: SearchRequest = {
        query: 'authentication',
        type: 'HYBRID',
      };
      const context: SearchContext = { client };

      const response = await registry.search(request, context);

      expect(response.total).toBeGreaterThan(0);

      const names = response.results.map(r => r.name);
      expect(names).toContain('authenticateUser');
    });

    it('returns related nodes with graph traversal', async () => {
      vi.mocked(isEmbeddingAvailable).mockReturnValue(false);

      const request: SearchRequest = {
        query: 'authenticateUser',
        type: 'HYBRID',
        options: { expandGraph: true, maxHops: 1 },
      };
      const context: SearchContext = { client };

      const response = await registry.search(request, context);

      expect(response.total).toBeGreaterThan(0);

      if (response.related && response.related.length > 0) {
        const relatedNames = response.related.map(r => r.name);
        const hasCallRelationship =
          relatedNames.includes('findUserByEmail') ||
          relatedNames.includes('validateToken');
        expect(hasCallRelationship).toBe(true);
      }
    });
  });

  // ==========================================================================
  // createDefaultSearchRegistry — Full Stack Test
  // ==========================================================================

  describe('createDefaultSearchRegistry', () => {
    it('registers HYBRID and ENRICHED_V2 strategies', () => {
      const registry = createDefaultSearchRegistry();
      const types = registry.listTypes();

      expect(types).toContain('HYBRID');
      expect(types).toContain('ENRICHED_V2');
      expect(types).toHaveLength(2);
    });

    it('no strategies require LLM', () => {
      const registry = createDefaultSearchRegistry();
      const strategies = registry.listStrategies();
      for (const s of strategies) {
        expect(s.requiresLLM).toBe(false);
      }
    });
  });

  // ==========================================================================
  // Verify seeded data integrity
  // ==========================================================================

  describe('data verification', () => {
    it('has correct number of code nodes', async () => {
      const result = await client.roQuery<{ count: number }>(
        'MATCH (f:Function) RETURN count(f) as count',
      );
      expect(result.data[0]?.count).toBeGreaterThanOrEqual(4);
    });

    it('has call edges in the graph', async () => {
      const result = await client.roQuery<{ count: number }>(
        'MATCH ()-[r:CALLS]->() RETURN count(r) as count',
      );
      expect(result.data[0]?.count).toBeGreaterThanOrEqual(3);
    });

    it('has knowledge entities', async () => {
      const result = await client.roQuery<{ count: number }>(
        'MATCH (e:Entity) RETURN count(e) as count',
      );
      expect(result.data[0]?.count).toBeGreaterThanOrEqual(2);
    });

    it('has ABOUT edges bridging knowledge and code', async () => {
      const result = await client.roQuery<{ count: number }>(
        'MATCH ()-[r:ABOUT]->() RETURN count(r) as count',
      );
      expect(result.data[0]?.count).toBeGreaterThanOrEqual(2);
    });
  });
});
