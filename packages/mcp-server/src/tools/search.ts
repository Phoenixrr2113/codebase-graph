/**
 * MCP Tool: search
 * Unified search across the codebase graph
 */

import { codeGraphService } from '@codegraph/core';
import { createLogger, toErrorMessage } from '@codegraph/logger';
import type { ToolDefinition } from './consolidated';

const logger = createLogger({ namespace: 'MCP:Search' });

// ============================================================================
// Schema
// ============================================================================

export interface SearchInput {
  query: string;
  type?: 'all' | 'file' | 'function' | 'class' | 'interface' | 'component';
  limit?: number;
}

export interface SearchResult {
  name: string;
  type: string;
  filePath: string;
  line?: number | undefined;
  preview?: string | undefined;
}

export interface SearchOutput {
  results: SearchResult[];
  total: number;
  query: string;
  project?: string | undefined;
  error?: string;
}

// ============================================================================
// Tool Definition
// ============================================================================

export const searchToolDefinition: ToolDefinition = {
  name: 'search',
  description: `Search the codebase for files, functions, classes, or other symbols by name.

Use this to find:
- Files by name or path pattern
- Functions, classes, interfaces by name
- Any code entity matching a keyword

Examples:
- { "query": "auth" } - find anything with "auth" in the name
- { "query": "login.ts", "type": "file" } - find file by name
- { "query": "validate", "type": "function" } - find functions`,
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search term (file name, symbol name, or keyword)',
      },
      type: {
        type: 'string',
        enum: ['all', 'file', 'function', 'class', 'interface', 'component'],
        default: 'all',
        description: 'Filter by entity type',
      },
      limit: {
        type: 'number',
        default: 20,
        description: 'Maximum results to return',
      },
    },
    required: ['query'],
  },
};

// ============================================================================
// Handler
// ============================================================================

export async function search(input: SearchInput): Promise<SearchOutput> {
  try {
    const result = await codeGraphService.search(input.query, {
      ...(input.type != null && { type: input.type }),
      ...(input.limit != null && { limit: input.limit }),
    });

    return {
      results: result.results,
      total: result.total,
      query: input.query,
      project: result.project,
    };
  } catch (error) {
    const errorMsg = toErrorMessage(error);
    logger.error('Search failed', { query: input.query, error: errorMsg });
    return {
      results: [],
      total: 0,
      query: input.query,
      error: errorMsg,
    };
  }
}
