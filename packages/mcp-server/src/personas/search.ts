/**
 * Search Persona — Unified search across code, symbols, and knowledge
 *
 * Consolidates: search, find_symbol, search_code, ask_code, query_cypher,
 *               get_context, explain_code, get_repo_map
 */

import type { ToolDefinition } from '../tools/consolidated';
import { search, type SearchInput } from '../tools/search';
import { searchCode, type SearchCodeInput } from '../tools/searchCode';
import { askCode, type AskCodeInput } from '../tools/askCode';
import { queryCypher, type QueryCypherInput } from '../tools/queryCypher';
import { getContext, type GetContextInput } from '../tools/getContext';
import { explainCode, type ExplainCodeInput } from '../tools/explainCode';
import { getRepoMap, type RepoMapInput } from '../tools/repoMap';
import { checkSetupRequired } from '../tools/configureProjects';
import { validateFilePath, validateQueryLength, clampLimit } from './validation';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'MCP:Persona:Search' });

export interface SearchPersonaInput {
  action: 'find' | 'context' | 'ask' | 'cypher' | 'explain' | 'map';
  query?: string;
  file?: string;
  symbol?: string;
  type?: string;
  strategy?: string;
  scope?: string;
  language?: string;
  limit?: number;
  maxDepth?: number;
  startLine?: number;
  endLine?: number;
  maxTokens?: number;
  focusFiles?: string[];
  focusSymbols?: string[];
  includeRelationships?: boolean;
  kind?: string;
}

export const searchPersonaDefinition: ToolDefinition = {
  name: 'search',
  description: `Search, find, and understand code in the indexed codebase.

**Actions:**
- **find**: Search for files, functions, classes, symbols by name or semantics.
  Params: query (required), type (all|file|function|class|interface|component), strategy (SMART_SEARCH|HYBRID|GRAPH_ANSWER|NL_TO_CYPHER|CONTEXT_WALK), scope, language, limit
- **context**: Get detailed context for a file or symbol including relationships.
  Params: file and/or symbol (one required), includeRelationships, maxDepth
- **ask**: Ask natural language questions about the code. Returns an LLM-generated answer with sources.
  Params: query (required), scope, limit
- **cypher**: Translate natural language to Cypher and execute against the graph.
  Params: query (required), scope
- **explain**: Get code with dependencies, dependents, tests, and complexity.
  Params: file (required), startLine, endLine
- **map**: Get a ranked symbol map for LLM context (condensed codebase overview).
  Params: maxTokens, focusFiles, focusSymbols

**Examples:**
- Find a function: { action: "find", query: "parseProject", type: "function" }
- Ask about architecture: { action: "ask", query: "how does the search pipeline work?" }
- Get file context: { action: "context", file: "src/service.ts" }
- Explain code: { action: "explain", file: "src/pipeline.ts", startLine: 100, endLine: 200 }`,
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['find', 'context', 'ask', 'cypher', 'explain', 'map'],
        description: 'What kind of search to perform',
      },
      query: {
        type: 'string',
        description: 'Search query or question (required for find/ask/cypher)',
      },
      file: {
        type: 'string',
        description: 'File path (for context/explain)',
      },
      symbol: {
        type: 'string',
        description: 'Symbol name (for context/find)',
      },
      type: {
        type: 'string',
        description: 'Filter: all|file|function|class|interface|component|variable',
      },
      strategy: {
        type: 'string',
        description: 'Search strategy: SMART_SEARCH|HYBRID|GRAPH_ANSWER|NL_TO_CYPHER|CONTEXT_WALK',
      },
      scope: {
        type: 'string',
        description: 'Path prefix to scope search',
      },
      language: {
        type: 'string',
        description: 'Language filter',
      },
      limit: {
        type: 'number',
        description: 'Max results (default: 20)',
      },
      maxDepth: {
        type: 'number',
        description: 'Relationship traversal depth (default: 2)',
      },
      startLine: {
        type: 'number',
        description: 'Start line for explain (1-indexed)',
      },
      endLine: {
        type: 'number',
        description: 'End line for explain',
      },
      maxTokens: {
        type: 'number',
        description: 'Max tokens for repo map (default: 2048)',
      },
      focusFiles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Focus files for repo map',
      },
      focusSymbols: {
        type: 'array',
        items: { type: 'string' },
        description: 'Focus symbols for repo map',
      },
      includeRelationships: {
        type: 'boolean',
        description: 'Include relationships in context (default: true)',
      },
      kind: {
        type: 'string',
        description: 'Symbol kind filter: function|class|interface|variable|any',
      },
    },
    required: ['action'],
  },
};

export async function handleSearch(args: Record<string, unknown>): Promise<unknown> {
  const input = args as unknown as SearchPersonaInput;
  const start = Date.now();

  // Infer action: if no action specified, default to 'find' (backward compat with raw search tool)
  const action = input.action || 'find';

  // Check setup for actions that need indexed data
  if (['find', 'context', 'ask', 'cypher'].includes(action)) {
    const setupPrompt = await checkSetupRequired();
    if (setupPrompt) return setupPrompt;
  }

  let result: unknown;
  let toolUsed: string;

  switch (action) {
    case 'find': {
      if (!input.query) return { error: 'query is required for find action' };
      const queryCheck = validateQueryLength(input.query);
      if (!queryCheck.valid) return { error: queryCheck.error };

      // If strategy is specified, use search_code (supports all strategies)
      if (input.strategy) {
        const searchInput: SearchCodeInput = {
          query: input.query,
          type: (input.type as SearchCodeInput['type']) || 'name',
          scope: input.scope || 'all',
        };
        if (input.strategy) searchInput.strategy = input.strategy as NonNullable<SearchCodeInput['strategy']>;
        if (input.language) searchInput.language = input.language;
        result = await searchCode(searchInput);
        toolUsed = 'search_code';
      }
      // Default: use generic search (backward compatible with raw search tool)
      else {
        const searchInput: SearchInput = {
          query: input.query,
          type: (input.type as SearchInput['type']) || 'all',
          limit: clampLimit(input.limit),
        };
        result = await search(searchInput);
        toolUsed = 'search';
      }
      break;
    }

    case 'context': {
      if (!input.file && !input.symbol) {
        return { error: 'file or symbol is required for context action' };
      }
      const contextInput: GetContextInput = {
        includeRelationships: input.includeRelationships !== false,
        maxDepth: input.maxDepth || 2,
      };
      if (input.file) {
        const pathCheck = await validateFilePath(input.file);
        if (!pathCheck.valid) return { error: pathCheck.error };
        contextInput.file = input.file;
      }
      if (input.symbol) contextInput.symbol = input.symbol;
      result = await getContext(contextInput);
      toolUsed = 'get_context';
      break;
    }

    case 'ask': {
      if (!input.query) return { error: 'query is required for ask action' };
      const queryCheck = validateQueryLength(input.query);
      if (!queryCheck.valid) return { error: queryCheck.error };
      const askInput: AskCodeInput = {
        question: input.query,
      };
      if (input.scope) askInput.scope = input.scope;
      if (input.limit) askInput.limit = input.limit;
      result = await askCode(askInput);
      toolUsed = 'ask_code';
      break;
    }

    case 'cypher': {
      if (!input.query) return { error: 'query is required for cypher action' };
      const queryCheck = validateQueryLength(input.query);
      if (!queryCheck.valid) return { error: queryCheck.error };
      const cypherInput: QueryCypherInput = {
        question: input.query,
      };
      if (input.scope) cypherInput.scope = input.scope;
      result = await queryCypher(cypherInput);
      toolUsed = 'query_cypher';
      break;
    }

    case 'explain': {
      if (!input.file) return { error: 'file is required for explain action' };
      const pathCheck = await validateFilePath(input.file);
      if (!pathCheck.valid) return { error: pathCheck.error };
      const explainInput: ExplainCodeInput = {
        file: input.file,
      };
      if (input.startLine != null) explainInput.start_line = input.startLine;
      if (input.endLine != null) explainInput.end_line = input.endLine;
      result = await explainCode(explainInput);
      toolUsed = 'explain_code';
      break;
    }

    case 'map': {
      const mapInput: RepoMapInput = {
        maxTokens: input.maxTokens || 2048,
      };
      if (input.focusFiles) mapInput.focusFiles = input.focusFiles;
      if (input.focusSymbols) mapInput.focusSymbols = input.focusSymbols;
      result = await getRepoMap(mapInput);
      toolUsed = 'repo_map';
      break;
    }

    default:
      return { error: `Unknown search action: ${action}. Use: find, context, ask, cypher, explain, map` };
  }

  const durationMs = Date.now() - start;
  logger.debug('Search persona completed', { action, toolUsed, durationMs });

  return {
    ...(result as object),
    _meta: { action, toolUsed, durationMs },
  };
}
