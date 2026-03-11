/**
 * Search Registry — Unit Tests
 *
 * Tests the SearchRegistry dispatch, strategy registration,
 * and the SmartSearch heuristic routing (no LLM, no DB required).
 */

import { describe, it, expect, vi } from 'vitest';
import { SearchRegistry, createSearchRegistry } from '../search/registry';
import { SmartSearchStrategy } from '../search/strategies/smartSearch';
import type {
  SearchStrategy,
  SearchRequest,
  SearchResponse,
  SearchContext,
  SearchType,
} from '../search/types';
import type { GraphClient } from '@codegraph/graph';

// ============================================================================
// Helpers
// ============================================================================

/** Create a mock strategy */
function mockStrategy(type: SearchType, requiresLLM = false): SearchStrategy {
  return {
    type,
    description: `Mock ${type}`,
    requiresLLM,
    search: vi.fn(async () => ({
      results: [{ name: 'test', nodeType: 'Function', score: 1.0, sources: ['test'] }],
      total: 1,
      meta: { searchType: type, durationMs: 0 },
    })),
  };
}

/** Create a mock search context */
function mockContext(withLLM = false): SearchContext {
  return {
    client: {} as GraphClient,
    llm: withLLM ? ({} as never) : undefined,
  };
}

// ============================================================================
// SearchRegistry Tests
// ============================================================================

describe('SearchRegistry', () => {
  it('should register and retrieve strategies', () => {
    const registry = new SearchRegistry();
    const strategy = mockStrategy('HYBRID');

    registry.register(strategy);

    expect(registry.has('HYBRID')).toBe(true);
    expect(registry.get('HYBRID')).toBe(strategy);
    expect(registry.has('GRAPH_ANSWER')).toBe(false);
  });

  it('should list registered types and strategies', () => {
    const registry = new SearchRegistry();
    registry.register(mockStrategy('HYBRID'));
    registry.register(mockStrategy('GRAPH_ANSWER', true));

    expect(registry.listTypes()).toEqual(['HYBRID', 'GRAPH_ANSWER']);
    expect(registry.listStrategies()).toEqual([
      { type: 'HYBRID', description: 'Mock HYBRID', requiresLLM: false },
      { type: 'GRAPH_ANSWER', description: 'Mock GRAPH_ANSWER', requiresLLM: true },
    ]);
  });

  it('should replace an existing strategy when re-registered', () => {
    const registry = new SearchRegistry();
    const strategy1 = mockStrategy('HYBRID');
    const strategy2 = mockStrategy('HYBRID');

    registry.register(strategy1);
    registry.register(strategy2);

    expect(registry.get('HYBRID')).toBe(strategy2);
  });

  it('should dispatch search to the correct strategy', async () => {
    const registry = new SearchRegistry();
    const strategy = mockStrategy('HYBRID');
    registry.register(strategy);

    const request: SearchRequest = { query: 'test', type: 'HYBRID' };
    const response = await registry.search(request, mockContext());

    expect(strategy.search).toHaveBeenCalledOnce();
    expect(response.total).toBe(1);
    expect(response.meta.searchType).toBe('HYBRID');
    expect(response.meta.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should throw when strategy is not registered', async () => {
    const registry = new SearchRegistry();
    const request: SearchRequest = { query: 'test', type: 'HYBRID' };

    await expect(registry.search(request, mockContext())).rejects.toThrow(
      'Search strategy "HYBRID" is not registered',
    );
  });

  it('should throw when LLM is required but not provided', async () => {
    const registry = new SearchRegistry();
    registry.register(mockStrategy('GRAPH_ANSWER', true));

    const request: SearchRequest = { query: 'test', type: 'GRAPH_ANSWER' };

    await expect(registry.search(request, mockContext(false))).rejects.toThrow(
      'requires an LLM',
    );
  });

  it('should allow LLM strategy when LLM is provided', async () => {
    const registry = new SearchRegistry();
    registry.register(mockStrategy('GRAPH_ANSWER', true));

    const request: SearchRequest = { query: 'test', type: 'GRAPH_ANSWER' };
    const response = await registry.search(request, mockContext(true));

    expect(response.total).toBe(1);
  });

  it('should measure duration in meta', async () => {
    const registry = new SearchRegistry();
    const slowStrategy: SearchStrategy = {
      type: 'HYBRID',
      description: 'Slow strategy',
      requiresLLM: false,
      search: async () => {
        await new Promise((r) => setTimeout(r, 50));
        return { results: [], total: 0, meta: { searchType: 'HYBRID', durationMs: 0 } };
      },
    };
    registry.register(slowStrategy);

    const request: SearchRequest = { query: 'test', type: 'HYBRID' };
    const response = await registry.search(request, mockContext());

    expect(response.meta.durationMs).toBeGreaterThanOrEqual(40);
  });
});

// ============================================================================
// SmartSearch Heuristic Tests (no LLM)
// ============================================================================

describe('SmartSearchStrategy — heuristic routing', () => {
  let registry: SearchRegistry;
  let smartSearch: SmartSearchStrategy;

  const strategies = {
    HYBRID: mockStrategy('HYBRID'),
    GRAPH_ANSWER: mockStrategy('GRAPH_ANSWER'),
    NL_TO_CYPHER: mockStrategy('NL_TO_CYPHER'),
    CONTEXT_WALK: mockStrategy('CONTEXT_WALK'),
  };

  // Fresh mocks for each test
  function setup() {
    registry = new SearchRegistry();
    for (const s of Object.values(strategies)) {
      registry.register(s);
      (s.search as ReturnType<typeof vi.fn>).mockClear();
    }
    smartSearch = new SmartSearchStrategy(registry);
    registry.register(smartSearch);
  }

  it('should route simple keyword queries to HYBRID', async () => {
    setup();
    const request: SearchRequest = { query: 'sendEmail', type: 'SMART_SEARCH' };
    const response = await registry.search(request, mockContext());

    expect(response.routedTo).toBe('HYBRID');
    expect(strategies.HYBRID.search).toHaveBeenCalledOnce();
  });

  it('should route "what does X" questions to GRAPH_ANSWER', async () => {
    setup();
    const request: SearchRequest = {
      query: 'What does the authentication module do?',
      type: 'SMART_SEARCH',
    };
    const response = await registry.search(request, mockContext());

    expect(response.routedTo).toBe('GRAPH_ANSWER');
  });

  it('should route "?" questions to GRAPH_ANSWER', async () => {
    setup();
    const request: SearchRequest = {
      query: 'who created the payment service?',
      type: 'SMART_SEARCH',
    };
    const response = await registry.search(request, mockContext());

    expect(response.routedTo).toBe('GRAPH_ANSWER');
  });

  it('should route "show me all X that Y" to NL_TO_CYPHER', async () => {
    setup();
    const request: SearchRequest = {
      query: 'Show me all functions that call sendEmail',
      type: 'SMART_SEARCH',
    };
    const response = await registry.search(request, mockContext());

    expect(response.routedTo).toBe('NL_TO_CYPHER');
  });

  it('should route "find classes that implement X" to NL_TO_CYPHER', async () => {
    setup();
    const request: SearchRequest = {
      query: 'Find every class that implements Logger',
      type: 'SMART_SEARCH',
    };
    const response = await registry.search(request, mockContext());

    expect(response.routedTo).toBe('NL_TO_CYPHER');
  });

  it('should route flow/trace queries to CONTEXT_WALK', async () => {
    setup();
    const request: SearchRequest = {
      query: 'trace the data flow from API handler to database',
      type: 'SMART_SEARCH',
    };
    const response = await registry.search(request, mockContext());

    expect(response.routedTo).toBe('CONTEXT_WALK');
  });

  it('should include routing metadata in response', async () => {
    setup();
    const request: SearchRequest = { query: 'test query', type: 'SMART_SEARCH' };
    const response = await registry.search(request, mockContext());

    expect(response.routedTo).toBeDefined();
    expect(response.routingReason).toBeDefined();
    expect(response.meta.searchType).toBe('SMART_SEARCH');
    expect(response.meta.routedTo).toBeDefined();
  });

  it('should fall back to HYBRID when routed strategy requires LLM but none available', async () => {
    setup();
    // Make GRAPH_ANSWER require LLM
    const graphAnswerWithLLM = mockStrategy('GRAPH_ANSWER', true);
    registry.register(graphAnswerWithLLM);

    const request: SearchRequest = {
      query: 'What does the auth module do?',
      type: 'SMART_SEARCH',
    };
    // No LLM context
    const response = await registry.search(request, mockContext(false));

    // Should fall back to HYBRID since GRAPH_ANSWER requires LLM
    expect(response.routedTo).toBe('HYBRID');
  });
});

// ============================================================================
// createSearchRegistry factory
// ============================================================================

describe('createSearchRegistry', () => {
  it('should create an empty registry', () => {
    const registry = createSearchRegistry();
    expect(registry.listTypes()).toEqual([]);
  });
});
