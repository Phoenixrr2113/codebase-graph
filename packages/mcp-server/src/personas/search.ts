/**
 * Search Persona — Find and understand code
 *
 * find: Search by name or meaning (enrichedSearchV2)
 * context: Get relationships and structure for a file or symbol
 */

import type { ToolDefinition } from '../tools/router';
import { searchCode } from '../tools/searchCode';
import { getContext, type GetContextInput } from '../tools/getContext';
import { checkSetupRequired } from '../tools/configureProjects';
import { validateFilePath, validateQueryLength } from './validation';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'MCP:Persona:Search' });

export interface SearchPersonaInput {
  action: 'find' | 'context';
  query?: string;
  file?: string;
  symbol?: string;
  scope?: string;
  limit?: number;
  maxDepth?: number;
  includeRelationships?: boolean;
}

export const searchPersonaDefinition: ToolDefinition = {
  name: 'search',
  description: `Search, find, and understand code in the indexed codebase.

**Actions:**
- **find**: Search for files, functions, classes, symbols by name or meaning.
  Params: query (required), scope (path prefix), limit
- **context**: Get detailed context for a file or symbol including callers, imports, relationships.
  Params: file and/or symbol (one required), includeRelationships, maxDepth

**Examples:**
- Find a function: { action: "find", query: "parseProject" }
- Explore a topic: { action: "find", query: "error handling" }
- Get file context: { action: "context", file: "src/service.ts" }
- Get symbol context: { action: "context", symbol: "hybridSearch" }`,
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['find', 'context'],
        description: 'find = search for code, context = understand a file or symbol',
      },
      query: {
        type: 'string',
        description: 'Search query (required for find)',
      },
      file: {
        type: 'string',
        description: 'File path (for context)',
      },
      symbol: {
        type: 'string',
        description: 'Symbol name (for context)',
      },
      scope: {
        type: 'string',
        description: 'Path prefix to scope search',
      },
      limit: {
        type: 'number',
        description: 'Max results (default: 20)',
      },
      maxDepth: {
        type: 'number',
        description: 'Relationship traversal depth (default: 2)',
      },
      includeRelationships: {
        type: 'boolean',
        description: 'Include relationships in context (default: true)',
      },
    },
    required: ['action'],
  },
};

export async function handleSearch(args: Record<string, unknown>): Promise<unknown> {
  const input = args as unknown as SearchPersonaInput;
  const start = Date.now();
  const action = input.action || 'find';

  const setupPrompt = await checkSetupRequired();
  if (setupPrompt) return setupPrompt;

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

    default:
      return { error: `Unknown search action: ${action}. Use: find, context` };
  }

  const durationMs = Date.now() - start;
  logger.debug('Search persona completed', { action, toolUsed, durationMs });

  return {
    ...(result as object),
    _meta: { action, toolUsed, durationMs },
  };
}
