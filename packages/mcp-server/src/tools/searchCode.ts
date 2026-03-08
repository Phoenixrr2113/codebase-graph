/**
 * MCP Tool: search_code
 *
 * Search for code by name, pattern, or text content.
 * Queries graph for matching symbols.
 */

import { codeGraphService } from '@codegraph/core';
import type { ToolDefinition } from './consolidated';

// Input schema
export interface SearchCodeInput {
  query: string;
  type?: 'name' | 'fulltext' | 'pattern';
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
}

// Output type
export interface SearchCodeOutput {
  results: SearchResult[];
  total: number;
  error?: string | undefined;
}

// Tool definition for MCP
export const searchCodeToolDefinition: ToolDefinition = {
  name: 'search_code',
  description: 'Search for code by name, pattern, or text content.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query (required)',
      },
      type: {
        type: 'string',
        enum: ['name', 'fulltext', 'pattern'],
        default: 'name',
        description: 'Search type: name (exact match), fulltext (text search), pattern (tree-sitter AST pattern)',
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

    const serviceResults = await codeGraphService.searchCode(input.query, {
      ...(input.type != null && { type: input.type }),
      ...(input.scope != null && { scope: input.scope }),
    });

    const results: SearchResult[] = serviceResults.map(r => ({
      ...r,
      match: r.name,
    }));

    return { results, total: results.length };
  } catch (error) {
    return {
      results: [],
      total: 0,
      error: error instanceof Error ? error.message : 'Unknown error during search',
    };
  }
}
