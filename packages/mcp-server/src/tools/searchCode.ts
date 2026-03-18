/**
 * MCP Tool: search_code
 *
 * Search for code by name, pattern, or semantic meaning.
 * Delegates to codeGraphService for all search modes:
 *   - Hybrid: codeGraphService.hybridSearchCode()
 *   - Strategy: codeGraphService.strategySearch()
 *   - Legacy text: codeGraphService.searchCode()
 *
 * Cross-layer support: traverses ABOUT edges to bridge code ↔ knowledge
 * graph layers. When a code hit has linked knowledge entities (bugs,
 * decisions, concepts), they appear in the `related` array with edge="ABOUT".
 */

import { codeGraphService } from '@codegraph/core';
import type { SearchResultItem, SearchRelatedItem } from '@codegraph/core';
import type { ToolDefinition } from './consolidated';

// Strategy type for advanced search
export type SearchStrategy = 'HYBRID' | 'ENRICHED_V2';

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
  /** LLM-generated answer (if applicable) */
  answer?: string;
  /** Answer confidence score (0-1) */
  answerConfidence?: number;
  /** Generated Cypher query (if applicable) */
  cypher?: string;
  /** Cypher query explanation (if applicable) */
  cypherExplanation?: string;
  /** Which strategy was used */
  routedTo?: string;
  /** Routing reasoning */
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
    'Set `strategy` for advanced search: HYBRID (vector+text+graph), ENRICHED_V2 (vector+reranker).',
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
        enum: ['HYBRID', 'ENRICHED_V2'],
        description:
          'Advanced search strategy (overrides type). ' +
          'HYBRID: vector + text + graph traversal. ' +
          'ENRICHED_V2: vector retrieval + cross-encoder reranking (primary).',
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

    // If a strategy is specified, use the strategy search via service
    if (input.strategy) {
      return strategySearchCode(input);
    }

    const searchType = input.type ?? 'semantic';

    // For semantic/fulltext: use hybrid search via service
    if (searchType === 'semantic' || searchType === 'fulltext') {
      return hybridSearchCode(input);
    }

    // For name/pattern: use legacy text search via service
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
 * Hybrid search — delegates to codeGraphService.hybridSearchCode()
 */
async function hybridSearchCode(input: SearchCodeInput): Promise<SearchCodeOutput> {
  const scope = input.scope && input.scope !== 'all' ? input.scope : undefined;

  const opts: Parameters<typeof codeGraphService.hybridSearchCode>[1] = { limit: 30 };
  if (scope) opts.scope = scope;

  const result = await codeGraphService.hybridSearchCode(input.query, opts);

  const results: SearchResult[] = result.hits.map((hit) => ({
    name: hit.name,
    kind: hit.nodeType.toLowerCase(),
    file: hit.filePath ?? '',
    line: hit.startLine ?? 0,
    match: hit.name,
    score: hit.score,
    sources: hit.sources,
  }));

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
 * Legacy text-only search (name/pattern mode) — uses codeGraphService.searchCode()
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
 * Strategy-based search — delegates to codeGraphService.strategySearch()
 */
async function strategySearchCode(input: SearchCodeInput): Promise<SearchCodeOutput> {
  const strategy = input.strategy!;
  const scope = input.scope && input.scope !== 'all' ? input.scope : undefined;

  const opts: Parameters<typeof codeGraphService.strategySearch>[2] = {};
  if (scope) opts.scope = scope;

  let response;
  try {
    response = await codeGraphService.strategySearch(input.query, strategy, opts);
  } catch (error) {
    return {
      results: [],
      total: 0,
      error: error instanceof Error ? error.message : `Strategy ${strategy} failed`,
    };
  }

  // Map SearchResponse → SearchCodeOutput
  const results: SearchResult[] = response.results.map((r: SearchResultItem) => ({
    name: r.name,
    kind: r.nodeType.toLowerCase(),
    file: r.filePath ?? '',
    line: r.startLine ?? 0,
    match: r.name,
    score: r.score,
    sources: r.sources,
  }));

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
