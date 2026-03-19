/**
 * Search Persona — Unified search across code, symbols, and knowledge
 *
 * Consolidates: search, find_symbol, search_code, ask_code, query_cypher,
 *               get_context, explain_code, get_repo_map
 */

import type { ToolDefinition } from '../tools/consolidated';
import { searchCode } from '../tools/searchCode';
import { getContext, type GetContextInput } from '../tools/getContext';
import { getRepoMap, type RepoMapInput } from '../tools/repoMap';
import { checkSetupRequired } from '../tools/configureProjects';
import { validateFilePath, validateQueryLength } from './validation';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'MCP:Persona:Search' });

export interface SearchPersonaInput {
  action: 'find' | 'context' | 'map';
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
  Params: query (required), type (name|fulltext|pattern|semantic), strategy (HYBRID|ENRICHED_V2), scope, language, limit
- **context**: Get detailed context for a file or symbol including relationships.
  Params: file and/or symbol (one required), includeRelationships, maxDepth
- **map**: Get a ranked symbol map for LLM context (condensed codebase overview).
  Params: maxTokens, focusFiles, focusSymbols

**Examples:**
- Find a function: { action: "find", query: "parseProject" }
- Get file context: { action: "context", file: "src/service.ts" }
- Get codebase overview: { action: "map", maxTokens: 4096 }`,
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['find', 'context', 'map'],
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
        description: 'Search strategy: HYBRID|ENRICHED_V2',
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
  if (['find', 'context'].includes(action)) {
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

      const searchInput: { query: string; scope?: string; limit?: number } = { query: input.query };
      if (input.scope) searchInput.scope = input.scope;
      if (input.limit) searchInput.limit = input.limit;
      result = await searchCode(searchInput);
      toolUsed = 'search_code';
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
      return { error: `Unknown search action: ${action}. Use: find, context, map` };
  }

  const durationMs = Date.now() - start;
  logger.debug('Search persona completed', { action, toolUsed, durationMs });

  return {
    ...(result as object),
    _meta: { action, toolUsed, durationMs },
  };
}
