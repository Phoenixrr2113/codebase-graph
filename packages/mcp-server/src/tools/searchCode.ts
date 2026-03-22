/**
 * MCP Tool: search_code
 *
 * Search for code by name or meaning.
 * Delegates to codeGraphService.search() → enrichedSearchV2.
 */

import { codeGraphService, type EnrichedV2Hit } from '@codegraph/core';
import type { ToolDefinition } from './router';

export interface SearchCodeInput {
  query: string;
  scope?: string;
  limit?: number;
}

export interface SearchCodeOutput {
  results: EnrichedV2Hit[];
  total: number;
  durationMs: number;
  error?: string;
  notice?: string;
}

export const searchCodeToolDefinition: ToolDefinition = {
  name: 'search_code',
  description:
    'Search for code by name or meaning. Uses vector retrieval + cross-encoder reranking. ' +
    'Returns ranked functions, classes, interfaces, and other code symbols.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query — a name, keyword, or description',
      },
      scope: {
        type: 'string',
        description: 'Limit search to a path prefix (optional)',
      },
      limit: {
        type: 'number',
        description: 'Max results (default: 20)',
      },
    },
    required: ['query'],
  },
};

export async function searchCode(input: SearchCodeInput): Promise<SearchCodeOutput> {
  try {
    if (!input.query || input.query.trim() === '') {
      return { results: [], total: 0, durationMs: 0, error: 'Search query is required' };
    }

    const opts: { limit: number; scope?: string } = { limit: input.limit ?? 20 };
    if (input.scope) opts.scope = input.scope;

    const result = await codeGraphService.search(input.query, opts);

    return {
      results: result.hits,
      total: result.hits.length,
      durationMs: result.meta.durationMs,
      ...(result.meta.notice && { notice: result.meta.notice }),
    };
  } catch (error) {
    return {
      results: [],
      total: 0,
      durationMs: 0,
      error: error instanceof Error ? error.message : 'Unknown error during search',
    };
  }
}
