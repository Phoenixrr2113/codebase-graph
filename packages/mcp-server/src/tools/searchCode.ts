/**
 * MCP Tool: search_code
 *
 * Search for code by name, pattern, or semantic meaning.
 * Uses hybrid search (vector + text + graph + knowledge) when embeddings
 * are available, falls back to text-only search otherwise.
 *
 * Cross-layer support: traverses ABOUT edges to bridge code ↔ knowledge
 * graph layers. When a code hit has linked knowledge entities (bugs,
 * decisions, concepts), they appear in the `related` array with edge="ABOUT".
 */

import { codeGraphService, getGraphClient, hybridSearch } from '@codegraph/core';
import type { ToolDefinition } from './consolidated';

// Input schema
export interface SearchCodeInput {
  query: string;
  type?: 'name' | 'fulltext' | 'pattern' | 'semantic';
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
  error?: string | undefined;
}

// Tool definition for MCP
export const searchCodeToolDefinition: ToolDefinition = {
  name: 'search_code',
  description:
    'Search for code by name, pattern, or semantic meaning. ' +
    'Uses hybrid search (vector similarity + text matching + graph traversal + knowledge graph) ' +
    'to find functions, classes, interfaces, and other code symbols. ' +
    'Related results may include linked knowledge entities (bugs, decisions, concepts) via ABOUT edges.',
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
          'name (exact name match), fulltext (text search), pattern (AST pattern)',
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
