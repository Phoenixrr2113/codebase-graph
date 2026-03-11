/**
 * MCP Tool: search_code
 *
 * Search for code by name, pattern, or semantic meaning.
 * Uses hybrid search (vector + text + graph + knowledge) when embeddings
 * are available, falls back to text-only search otherwise.
 *
 * Supports a `strategy` parameter for advanced search:
 *   - SMART_SEARCH (default): auto-routes to the best strategy
 *   - HYBRID: vector + text + graph traversal
 *   - GRAPH_ANSWER: question answering with LLM
 *   - NL_TO_CYPHER: translates to Cypher query
 *   - CONTEXT_WALK: iterative multi-hop exploration
 *
 * Cross-layer support: traverses ABOUT edges to bridge code ↔ knowledge
 * graph layers. When a code hit has linked knowledge entities (bugs,
 * decisions, concepts), they appear in the `related` array with edge="ABOUT".
 */

import {
  codeGraphService,
  getGraphClient,
  hybridSearch,
  createDefaultSearchRegistry,
} from '@codegraph/core';
import type { SearchContext, SearchResponse, SearchType, SearchResultItem, SearchRelatedItem } from '@codegraph/core';
import { getLLMModel, isLLMAvailable } from '@codegraph/plugin-nlp';
import type { ToolDefinition } from './consolidated';

// Strategy type for advanced search
export type SearchStrategy = 'SMART_SEARCH' | 'HYBRID' | 'GRAPH_ANSWER' | 'NL_TO_CYPHER' | 'CONTEXT_WALK';

// Input schema
export interface SearchCodeInput {
  query: string;
  type?: 'name' | 'fulltext' | 'pattern' | 'semantic';
  /** Advanced search strategy (overrides type when set) */
  strategy?: SearchStrategy;
  scope?: string;
  language?: string;
}

// Search result type
export interface SearchResult {
  name: string;
  kind: string;
  file: string;
  line: number;
  match: string;
  score?: number;
  sources?: string[];
}

// Related result from graph or ABOUT traversal
export interface RelatedResult {
  name: string;
  kind: string;
  file?: string;
  edge: string;
  direction: string;
  sourceHit: string;
  /** For ABOUT-linked knowledge entities: entity type (Bug, Decision, etc.) */
  entityType?: string;
  /** For ABOUT-linked knowledge entities: confidence of the ABOUT link */
  aboutConfidence?: number;
}

// Output type
export interface SearchCodeOutput {
  results: SearchResult[];
  related?: RelatedResult[];
  total: number;
  meta?: {
    vectorHits: number;
    textHits: number;
    graphExpanded: number;
    aboutExpanded: number;
    embeddingAvailable: boolean;
    durationMs: number;
  };
  /** LLM-generated answer (GRAPH_ANSWER, CONTEXT_WALK, SMART_SEARCH→GRAPH_ANSWER) */
  answer?: string;
  /** Answer confidence score (0-1) */
  answerConfidence?: number;
  /** Generated Cypher query (NL_TO_CYPHER) */
  cypher?: string;
  /** Cypher query explanation (NL_TO_CYPHER) */
  cypherExplanation?: string;
  /** Which strategy was used (SMART_SEARCH routing info) */
  routedTo?: string;
  /** Routing reasoning (SMART_SEARCH) */
  routingReason?: string;
  error?: string | undefined;
}

// Tool definition for MCP
export const searchCodeToolDefinition: ToolDefinition = {
  name: 'search_code',
  description:
    'Search for code by name, pattern, or semantic meaning. ' +
    'Uses hybrid search (vector similarity + text matching + graph traversal + knowledge graph) ' +
    'to find functions, classes, interfaces, and other code symbols. ' +
    'Related results may include linked knowledge entities (bugs, decisions, concepts) via ABOUT edges. ' +
    'Set `strategy` for advanced AI-powered search: SMART_SEARCH (auto-routes), GRAPH_ANSWER (Q&A), ' +
    'NL_TO_CYPHER (graph queries), CONTEXT_WALK (multi-hop exploration).',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query — can be a name, keyword, or natural language description',
      },
      type: {
        type: 'string',
        enum: ['name', 'fulltext', 'pattern', 'semantic'],
        default: 'semantic',
        description:
          'Search type: semantic (hybrid vector+text, default), ' +
          'name (exact name match), fulltext (text search), pattern (AST pattern). ' +
          'Ignored when strategy is set.',
      },
      strategy: {
        type: 'string',
        enum: ['SMART_SEARCH', 'HYBRID', 'GRAPH_ANSWER', 'NL_TO_CYPHER', 'CONTEXT_WALK'],
        description:
          'Advanced search strategy (overrides type). ' +
          'SMART_SEARCH: auto-routes to best strategy based on query analysis. ' +
          'HYBRID: vector + text + graph traversal. ' +
          'GRAPH_ANSWER: answers questions using graph context + LLM (requires LLM). ' +
          'NL_TO_CYPHER: translates question to Cypher and executes (requires LLM). ' +
          'CONTEXT_WALK: iterative multi-hop graph exploration (requires LLM).',
      },
      scope: {
        type: 'string',
        default: 'all',
        description: 'Limit search to specific scope (file path prefix)',
      },
      language: {
        type: 'string',
        description: 'Filter by programming language (optional)',
      },
    },
    required: ['query'],
  },
};

/**
 * Handler for search_code tool
 */
export async function searchCode(input: SearchCodeInput): Promise<SearchCodeOutput> {
  try {
    if (!input.query || input.query.trim() === '') {
      return { results: [], total: 0, error: 'Search query is required' };
    }

    // If a strategy is specified, use the search registry
    if (input.strategy) {
      return strategySearchCode(input);
    }

    const searchType = input.type ?? 'semantic';

    // For semantic/fulltext: use hybrid search
    if (searchType === 'semantic' || searchType === 'fulltext') {
      return hybridSearchCode(input);
    }

    // For name/pattern: use legacy text search
    return legacySearchCode(input);
  } catch (error) {
    return {
      results: [],
      total: 0,
      error: error instanceof Error ? error.message : 'Unknown error during search',
    };
  }
}

/**
 * Hybrid search — vector + text + graph traversal
 */
async function hybridSearchCode(input: SearchCodeInput): Promise<SearchCodeOutput> {
  const client = await getGraphClient();
  const scope = input.scope && input.scope !== 'all' ? input.scope : undefined;

  const opts: Parameters<typeof hybridSearch>[2] = {
    limit: 30,
    includeKnowledge: true,    // include knowledge entities in results
    expandGraph: true,
    maxHops: 1,
    includeAboutEdges: true,   // traverse ABOUT edges (code ↔ knowledge)
  };
  if (scope) opts.scope = scope;

  const result = await hybridSearch(input.query, client, opts);

  const results: SearchResult[] = result.hits.map((hit) => {
    const r: SearchResult = {
      name: hit.name,
      kind: hit.nodeType.toLowerCase(),
      file: hit.filePath ?? '',
      line: hit.startLine ?? 0,
      match: hit.name,
      score: hit.score,
      sources: hit.sources,
    };
    return r;
  });

  const output: SearchCodeOutput = {
    results,
    total: results.length,
    meta: {
      vectorHits: result.meta.vectorHits,
      textHits: result.meta.textHits,
      graphExpanded: result.meta.graphExpanded,
      aboutExpanded: result.meta.aboutExpanded,
      embeddingAvailable: result.meta.embeddingAvailable,
      durationMs: result.meta.durationMs,
    },
  };

  if (result.related.length > 0) {
    output.related = result.related.map((r) => {
      const rel: RelatedResult = {
        name: r.name,
        kind: r.nodeType.toLowerCase(),
        edge: r.edgeLabel,
        direction: r.direction,
        sourceHit: r.sourceKey,
      };
      if (r.filePath != null) rel.file = r.filePath;
      if (r.entityType != null) rel.entityType = r.entityType;
      if (r.aboutConfidence != null) rel.aboutConfidence = r.aboutConfidence;
      return rel;
    });
  }

  return output;
}

/**
 * Legacy text-only search (name/pattern mode)
 */
async function legacySearchCode(input: SearchCodeInput): Promise<SearchCodeOutput> {
  const serviceResults = await codeGraphService.searchCode(input.query, {
    ...(input.type != null && input.type !== 'semantic' && { type: input.type }),
    ...(input.scope != null && { scope: input.scope }),
  });

  const results: SearchResult[] = serviceResults.map(r => ({
    ...r,
    match: r.name,
  }));

  return { results, total: results.length };
}

/**
 * Strategy-based search using the SearchRegistry.
 * Dispatches to SMART_SEARCH, GRAPH_ANSWER, NL_TO_CYPHER, CONTEXT_WALK, or HYBRID.
 */
async function strategySearchCode(input: SearchCodeInput): Promise<SearchCodeOutput> {
  const strategy = input.strategy!;

  // Build search context
  const client = await getGraphClient();
  const context: SearchContext = { client };

  // Add LLM if available (required for GRAPH_ANSWER, NL_TO_CYPHER, CONTEXT_WALK)
  if (isLLMAvailable()) {
    try {
      context.llm = await getLLMModel();
    } catch {
      // LLM init failed — strategies that require LLM will fail gracefully
    }
  }

  const registry = createDefaultSearchRegistry();
  const searchType = strategy as SearchType;

  const request: Parameters<typeof registry.search>[0] = {
    query: input.query,
    type: searchType,
  };
  const scope = input.scope && input.scope !== 'all' ? input.scope : undefined;
  if (scope) request.scope = scope;

  let response: SearchResponse;
  try {
    response = await registry.search(request, context);
  } catch (error) {
    return {
      results: [],
      total: 0,
      error: error instanceof Error ? error.message : `Strategy ${strategy} failed`,
    };
  }

  // Map SearchResponse → SearchCodeOutput
  const results: SearchResult[] = response.results.map((r: SearchResultItem) => {
    const item: SearchResult = {
      name: r.name,
      kind: r.nodeType.toLowerCase(),
      file: r.filePath ?? '',
      line: r.startLine ?? 0,
      match: r.name,
      score: r.score,
      sources: r.sources,
    };
    return item;
  });

  const output: SearchCodeOutput = {
    results,
    total: response.total,
    meta: {
      vectorHits: (response.meta['vectorHits'] as number) ?? 0,
      textHits: (response.meta['textHits'] as number) ?? 0,
      graphExpanded: (response.meta['graphExpanded'] as number) ?? 0,
      aboutExpanded: (response.meta['aboutExpanded'] as number) ?? 0,
      embeddingAvailable: (response.meta['embeddingAvailable'] as boolean) ?? false,
      durationMs: response.meta.durationMs,
    },
  };

  // Add strategy-specific fields
  if (response.answer) output.answer = response.answer;
  if (response.answerConfidence != null) output.answerConfidence = response.answerConfidence;
  if (response.cypher) output.cypher = response.cypher;
  if (response.cypherExplanation) output.cypherExplanation = response.cypherExplanation;
  if (response.routedTo) output.routedTo = response.routedTo;
  if (response.routingReason) output.routingReason = response.routingReason;
  if (response.error) output.error = response.error;

  // Map related items if present
  if (response.related && response.related.length > 0) {
    output.related = response.related.map((r: SearchRelatedItem) => {
      const rel: RelatedResult = {
        name: r.name,
        kind: r.nodeType.toLowerCase(),
        edge: r.edgeLabel,
        direction: r.direction,
        sourceHit: r.sourceHit,
      };
      if (r.filePath) rel.file = r.filePath;
      return rel;
    });
  }

  return output;
}
