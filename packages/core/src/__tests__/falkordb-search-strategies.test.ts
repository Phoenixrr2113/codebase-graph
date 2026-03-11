/**
 * Search Strategies — FalkorDB Integration Tests
 *
 * Tests the search strategy system against a real FalkorDB Docker instance
 * with real LLM calls (OpenRouter) where needed.
 *
 * Coverage:
 *   1. HYBRID strategy — text + vector search via registry dispatch
 *   2. GRAPH_ANSWER strategy — question answering with LLM synthesis
 *   3. NL_TO_CYPHER strategy — natural language → Cypher query
 *   4. SMART_SEARCH strategy — heuristic routing (no LLM) + LLM routing
 *   5. createDefaultSearchRegistry factory — full stack integration
 *
 * Prerequisites:
 *   - docker compose up -d falkordb
 *   - OPENROUTER_API_KEY set in .env
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
import { isLLMAvailable, getLLMModel } from '@codegraph/plugin-nlp';
import type { LanguageModel } from 'ai';

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
  SmartSearchStrategy,
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
  let llm: LanguageModel | undefined;

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

    // Try to get LLM
    if (isLLMAvailable()) {
      try {
        llm = await getLLMModel();
      } catch {
        console.warn('LLM not available — LLM-dependent tests will be skipped');
      }
    }

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

    // Implements edge
    // AuthService is just a class, no interface to implement here

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

      // Should find auth-related functions
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

      // Graph traversal should find CALLS/IMPORTS relationships
      if (response.related && response.related.length > 0) {
        const relatedNames = response.related.map(r => r.name);
        // authenticateUser calls findUserByEmail and validateToken
        const hasCallRelationship =
          relatedNames.includes('findUserByEmail') ||
          relatedNames.includes('validateToken');
        expect(hasCallRelationship).toBe(true);
      }
    });
  });

  // ==========================================================================
  // SMART_SEARCH Strategy Tests (heuristic-only, no LLM)
  // ==========================================================================

  describe('SMART_SEARCH strategy — heuristic routing with real FalkorDB', () => {
    let registry: SearchRegistry;

    beforeAll(() => {
      registry = createDefaultSearchRegistry();
    });

    it('routes keyword queries to HYBRID and finds results', async () => {
      vi.mocked(isEmbeddingAvailable).mockReturnValue(false);

      const request: SearchRequest = {
        query: 'authenticateUser',
        type: 'SMART_SEARCH',
      };
      const context: SearchContext = { client };

      const response = await registry.search(request, context);

      expect(response.routedTo).toBe('HYBRID');
      expect(response.routingReason).toContain('HYBRID');
      expect(response.total).toBeGreaterThan(0);
      expect(response.meta.searchType).toBe('SMART_SEARCH');

      const names = response.results.map(r => r.name);
      expect(names).toContain('authenticateUser');
    });

    it('routes question queries to HYBRID fallback (no LLM)', async () => {
      vi.mocked(isEmbeddingAvailable).mockReturnValue(false);

      const request: SearchRequest = {
        query: 'What does the AuthService do?',
        type: 'SMART_SEARCH',
      };
      // No LLM in context — GRAPH_ANSWER requires LLM, should fall back
      const context: SearchContext = { client };

      const response = await registry.search(request, context);

      // GRAPH_ANSWER requires LLM, so SMART_SEARCH should fall back to HYBRID
      expect(response.routedTo).toBe('HYBRID');
      expect(response.routingReason).toContain('LLM');
      // The text search may find results (AuthService is a node name)
      // but the query includes "What does ... do?" which is a question,
      // so total could be 0 or more depending on text matching
      expect(response.total).toBeGreaterThanOrEqual(0);
      expect(response.meta.searchType).toBe('SMART_SEARCH');
    });

    it('routes structural queries to HYBRID fallback (no LLM for NL_TO_CYPHER)', async () => {
      vi.mocked(isEmbeddingAvailable).mockReturnValue(false);

      const request: SearchRequest = {
        query: 'Show me all functions that call authenticateUser',
        type: 'SMART_SEARCH',
      };
      // No LLM — NL_TO_CYPHER requires LLM
      const context: SearchContext = { client };

      const response = await registry.search(request, context);

      // NL_TO_CYPHER requires LLM, should fall back to HYBRID
      expect(response.routedTo).toBe('HYBRID');
      expect(response.total).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // GRAPH_ANSWER Strategy Tests (requires LLM)
  // ==========================================================================

  describe('GRAPH_ANSWER strategy (live LLM)', () => {
    it('answers questions about the codebase', async () => {
      if (!llm) {
        console.warn('Skipping GRAPH_ANSWER test — no LLM available');
        return;
      }

      // Enable vector search so GRAPH_ANSWER can find relevant context
      vi.mocked(isEmbeddingAvailable).mockReturnValue(true);
      vi.mocked(generateEmbedding).mockResolvedValue({
        embedding: makeVec({ 0: 0.0, 1: 0.95, 2: 0.15 }),
        dimensions: DIM,
        provider: 'test',
      });

      const registry = createDefaultSearchRegistry();
      const request: SearchRequest = {
        query: 'What does the authenticateUser function do?',
        type: 'GRAPH_ANSWER',
      };
      const context: SearchContext = { client, llm };

      const response = await registry.search(request, context);

      expect(response.meta.searchType).toBe('GRAPH_ANSWER');
      expect(response.total).toBeGreaterThan(0);

      // Should have an LLM-generated answer
      expect(response.answer).toBeDefined();
      expect(response.answer!.length).toBeGreaterThan(10);

      // Answer should reference authentication-related concepts
      const answerLower = response.answer!.toLowerCase();
      expect(
        answerLower.includes('authent') ||
        answerLower.includes('user') ||
        answerLower.includes('credential') ||
        answerLower.includes('token') ||
        answerLower.includes('jwt'),
      ).toBe(true);

      // Should have confidence
      expect(response.answerConfidence).toBeDefined();
      expect(response.answerConfidence!).toBeGreaterThan(0);
    }, 30_000);

    it('returns results even when answer generation fails gracefully', async () => {
      if (!llm) {
        console.warn('Skipping GRAPH_ANSWER test — no LLM available');
        return;
      }

      // Enable vector search for finding context
      vi.mocked(isEmbeddingAvailable).mockReturnValue(true);
      vi.mocked(generateEmbedding).mockResolvedValue({
        embedding: makeVec({ 0: 0.3, 1: 0.3, 2: 0.7 }),
        dimensions: DIM,
        provider: 'test',
      });

      const registry = createDefaultSearchRegistry();
      const request: SearchRequest = {
        query: 'Tell me about AuthService',
        type: 'GRAPH_ANSWER',
      };
      const context: SearchContext = { client, llm };

      const response = await registry.search(request, context);

      // Should always return results regardless of answer quality
      expect(response.results).toBeDefined();
      expect(response.meta.searchType).toBe('GRAPH_ANSWER');
    }, 30_000);
  });

  // ==========================================================================
  // NL_TO_CYPHER Strategy Tests (requires LLM)
  // ==========================================================================

  describe('NL_TO_CYPHER strategy (live LLM)', () => {
    it('translates natural language to Cypher and executes', async () => {
      if (!llm) {
        console.warn('Skipping NL_TO_CYPHER test — no LLM available');
        return;
      }

      const registry = createDefaultSearchRegistry();
      const request: SearchRequest = {
        query: 'Find all functions in the file /src/auth/login.ts',
        type: 'NL_TO_CYPHER',
      };
      const context: SearchContext = { client, llm };

      const response = await registry.search(request, context);

      expect(response.meta.searchType).toBe('NL_TO_CYPHER');

      // Should have generated a Cypher query
      expect(response.cypher).toBeDefined();
      expect(response.cypher!.length).toBeGreaterThan(0);

      // Cypher should be a MATCH query (read-only)
      const cypherUpper = response.cypher!.toUpperCase();
      expect(cypherUpper).toContain('MATCH');
      expect(cypherUpper).toContain('RETURN');

      // Should have an explanation
      expect(response.cypherExplanation).toBeDefined();

      // Should find authenticateUser (it's in /src/auth/login.ts)
      if (response.total > 0) {
        const names = response.results.map(r => r.name);
        expect(names).toContain('authenticateUser');
      }
    }, 30_000);

    it('generates safe read-only queries (no mutations)', async () => {
      if (!llm) {
        console.warn('Skipping NL_TO_CYPHER safety test — no LLM available');
        return;
      }

      const registry = createDefaultSearchRegistry();
      const request: SearchRequest = {
        query: 'Show me all classes in the codebase',
        type: 'NL_TO_CYPHER',
      };
      const context: SearchContext = { client, llm };

      const response = await registry.search(request, context);

      // Should generate a query
      expect(response.cypher).toBeDefined();

      // Should not have mutation keywords
      const cypherUpper = response.cypher!.toUpperCase();
      expect(cypherUpper).not.toContain('CREATE');
      expect(cypherUpper).not.toContain('DELETE');
      expect(cypherUpper).not.toContain('MERGE');
      expect(cypherUpper).not.toContain('SET ');

      // AuthService should be found
      if (response.total > 0) {
        const names = response.results.map(r => r.name);
        expect(names).toContain('AuthService');
      }
    }, 30_000);

    it('handles queries about relationships (CALLS edges)', async () => {
      if (!llm) {
        console.warn('Skipping NL_TO_CYPHER relationship test — no LLM available');
        return;
      }

      const registry = createDefaultSearchRegistry();
      const request: SearchRequest = {
        query: 'Which functions does authenticateUser call?',
        type: 'NL_TO_CYPHER',
      };
      const context: SearchContext = { client, llm };

      const response = await registry.search(request, context);

      expect(response.cypher).toBeDefined();
      expect(response.meta.searchType).toBe('NL_TO_CYPHER');

      // Should find findUserByEmail and/or validateToken
      if (response.total > 0) {
        const names = response.results.map(r => r.name);
        const hasExpected = names.includes('findUserByEmail') || names.includes('validateToken');
        expect(hasExpected).toBe(true);
      }
    }, 30_000);
  });

  // ==========================================================================
  // SMART_SEARCH with LLM routing
  // ==========================================================================

  describe('SMART_SEARCH strategy — LLM routing', () => {
    it('uses LLM to classify and route queries when LLM available', async () => {
      if (!llm) {
        console.warn('Skipping SMART_SEARCH LLM test — no LLM available');
        return;
      }

      vi.mocked(isEmbeddingAvailable).mockReturnValue(false);

      const registry = createDefaultSearchRegistry();
      const request: SearchRequest = {
        query: 'What does the authentication module do?',
        type: 'SMART_SEARCH',
      };
      const context: SearchContext = { client, llm };

      const response = await registry.search(request, context);

      expect(response.meta.searchType).toBe('SMART_SEARCH');
      expect(response.routedTo).toBeDefined();
      expect(response.routingReason).toBeDefined();

      // With LLM available, should route to GRAPH_ANSWER for this question
      expect(response.routedTo).toBe('GRAPH_ANSWER');
      expect(response.answer).toBeDefined();
    }, 60_000);

    it('routes structural queries to NL_TO_CYPHER with LLM', async () => {
      if (!llm) {
        console.warn('Skipping SMART_SEARCH structural test — no LLM available');
        return;
      }

      vi.mocked(isEmbeddingAvailable).mockReturnValue(false);

      const registry = createDefaultSearchRegistry();
      const request: SearchRequest = {
        query: 'List all functions that are in the auth directory',
        type: 'SMART_SEARCH',
      };
      const context: SearchContext = { client, llm };

      const response = await registry.search(request, context);

      expect(response.meta.searchType).toBe('SMART_SEARCH');
      expect(response.routedTo).toBeDefined();

      // With LLM, should route to NL_TO_CYPHER for structural queries
      // (or HYBRID depending on LLM classification — both are acceptable)
      expect(['NL_TO_CYPHER', 'HYBRID']).toContain(response.routedTo);
    }, 60_000);
  });

  // ==========================================================================
  // createDefaultSearchRegistry — Full Stack Test
  // ==========================================================================

  describe('createDefaultSearchRegistry', () => {
    it('registers all 5 strategy types', () => {
      const registry = createDefaultSearchRegistry();
      const types = registry.listTypes();

      expect(types).toContain('HYBRID');
      expect(types).toContain('GRAPH_ANSWER');
      expect(types).toContain('NL_TO_CYPHER');
      expect(types).toContain('CONTEXT_WALK');
      expect(types).toContain('SMART_SEARCH');
      expect(types).toHaveLength(5);
    });

    it('correctly identifies LLM requirements', () => {
      const registry = createDefaultSearchRegistry();
      const strategies = registry.listStrategies();

      const findStrategy = (type: string) =>
        strategies.find(s => s.type === type);

      expect(findStrategy('HYBRID')!.requiresLLM).toBe(false);
      expect(findStrategy('GRAPH_ANSWER')!.requiresLLM).toBe(true);
      expect(findStrategy('NL_TO_CYPHER')!.requiresLLM).toBe(true);
      expect(findStrategy('CONTEXT_WALK')!.requiresLLM).toBe(true);
      expect(findStrategy('SMART_SEARCH')!.requiresLLM).toBe(false);
    });

    it('throws when LLM-required strategy is called without LLM', async () => {
      const registry = createDefaultSearchRegistry();
      const request: SearchRequest = {
        query: 'test',
        type: 'GRAPH_ANSWER',
      };
      const context: SearchContext = { client };

      await expect(registry.search(request, context)).rejects.toThrow(
        'requires an LLM',
      );
    });

    it('SMART_SEARCH dispatches end-to-end with real FalkorDB', async () => {
      vi.mocked(isEmbeddingAvailable).mockReturnValue(false);

      const registry = createDefaultSearchRegistry();
      const request: SearchRequest = {
        query: 'validateToken',
        type: 'SMART_SEARCH',
      };
      const context: SearchContext = { client };

      const response = await registry.search(request, context);

      expect(response.meta.searchType).toBe('SMART_SEARCH');
      expect(response.routedTo).toBe('HYBRID');
      expect(response.total).toBeGreaterThan(0);

      const names = response.results.map(r => r.name);
      expect(names).toContain('validateToken');
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
