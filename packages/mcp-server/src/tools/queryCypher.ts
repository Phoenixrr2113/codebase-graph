/**
 * MCP Tool: query_cypher
 *
 * Translates natural language questions into Cypher queries, executes them
 * against the graph database, and returns structured results.
 *
 * Uses the NL_TO_CYPHER search strategy:
 *   1. LLM translates question → Cypher query
 *   2. Safety check (read-only queries only)
 *   3. Execute against FalkorDB
 *   4. Return results + generated Cypher
 *
 * Examples:
 *   "Show me all functions that call sendEmail"
 *   "Find classes that implement the Logger interface"
 *   "What files import the authentication module?"
 *   "List all entities of type Decision"
 *
 * Requires an LLM provider (OPENROUTER_API_KEY or Ollama).
 */

import {
  createDefaultSearchRegistry,
  getGraphClient,
} from '@codegraph/core';
import type { SearchContext, SearchResponse, SearchResultItem } from '@codegraph/core';
import { getLLMModel, isLLMAvailable } from '@codegraph/plugin-nlp';
import type { ToolDefinition } from './consolidated';

// ============================================================================
// Input / Output Types
// ============================================================================

export interface QueryCypherInput {
  /** Natural language question about code structure/relationships */
  question: string;
  /** File path scope filter */
  scope?: string;
}

export interface QueryCypherOutput {
  /** The generated Cypher query */
  cypher?: string;
  /** Explanation of what the Cypher query does */
  cypherExplanation?: string;
  /** Query results */
  results: Array<{
    name: string;
    kind: string;
    file?: string;
    line?: number;
    score: number;
    properties?: Record<string, unknown>;
  }>;
  /** Total results */
  total: number;
  /** Search metadata */
  meta?: {
    searchType: string;
    durationMs: number;
    generatedCypher?: string;
    cypherParams?: Record<string, unknown>;
  };
  /** Error message (if translation or execution failed) */
  error?: string;
}

// ============================================================================
// Tool Definition
// ============================================================================

export const queryCypherToolDefinition: ToolDefinition = {
  name: 'query_cypher',
  description:
    'Translate a natural language question about code structure into a Cypher graph query, ' +
    'execute it against the knowledge graph, and return results. Best for structural queries: ' +
    '"Show me all functions that call X", "Find classes implementing Y", "List files that import Z". ' +
    'Only generates read-only queries. Requires an LLM provider (OpenRouter or Ollama).',
  inputSchema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description:
          'Natural language question about code structure/relationships. ' +
          'Works best for questions about which functions call what, class hierarchies, imports, etc.',
      },
      scope: {
        type: 'string',
        description: 'Limit search to specific scope (file path prefix)',
      },
    },
    required: ['question'],
  },
};

// ============================================================================
// Handler
// ============================================================================

export async function queryCypher(input: QueryCypherInput): Promise<QueryCypherOutput> {
  try {
    if (!input.question || input.question.trim() === '') {
      return { results: [], total: 0, error: 'Question is required' };
    }

    if (!isLLMAvailable()) {
      return {
        results: [],
        total: 0,
        error:
          'LLM provider is required for query_cypher. Set OPENROUTER_API_KEY in your environment, ' +
          'or configure Ollama (LLM_PROVIDER=ollama).',
      };
    }

    const client = await getGraphClient();
    const llm = await getLLMModel();

    const registry = createDefaultSearchRegistry();
    const context: SearchContext = { client, llm };

    const request: Parameters<typeof registry.search>[0] = {
      query: input.question,
      type: 'NL_TO_CYPHER',
    };
    if (input.scope) request.scope = input.scope;
    const response: SearchResponse = await registry.search(request, context);

    const results = response.results.map((r: SearchResultItem) => {
      const item: QueryCypherOutput['results'][number] = {
        name: r.name,
        kind: r.nodeType.toLowerCase(),
        score: r.score,
      };
      if (r.filePath) item.file = r.filePath;
      if (r.startLine != null) item.line = r.startLine;
      if (r.properties) item.properties = r.properties;
      return item;
    });

    const output: QueryCypherOutput = {
      results,
      total: response.total,
      meta: {
        searchType: 'NL_TO_CYPHER',
        durationMs: response.meta.durationMs,
      },
    };

    if (response.cypher) output.cypher = response.cypher;
    if (response.cypherExplanation) output.cypherExplanation = response.cypherExplanation;
    if (response.meta['generatedCypher']) {
      output.meta!.generatedCypher = response.meta['generatedCypher'] as string;
    }
    if (response.meta['cypherParams']) {
      output.meta!.cypherParams = response.meta['cypherParams'] as Record<string, unknown>;
    }
    if (response.error) output.error = response.error;

    return output;
  } catch (error) {
    return {
      results: [],
      total: 0,
      error: error instanceof Error ? error.message : 'Unknown error during query_cypher',
    };
  }
}
