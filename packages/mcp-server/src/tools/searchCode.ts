/**
 * MCP Tool: search_code
 *
 * Search for code by name or meaning.
 * Delegates to codeGraphService.search() → enrichedSearchV2.
 */

import { codeGraphService, unifiedSearch, getGraphClient, type EnrichedV2Hit, type UnifiedSearchResult } from '@codegraph/core';
import type { ToolDefinition } from './router';

export interface SearchCodeInput {
  query: string;
  scope?: string;
  limit?: number;
  /** Search scope: 'code' (default), 'knowledge', or 'all' */
  searchScope?: 'code' | 'knowledge' | 'all';
}

export interface SearchCodeOutput {
  results: EnrichedV2Hit[] | UnifiedSearchResult[];
  total: number;
  durationMs: number;
  error?: string;
  notice?: string;
  searchScope?: string;
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
      searchScope: {
        type: 'string',
        description: 'Search scope: "code" (default, code symbols only), "knowledge" (knowledge entities only), or "all" (both via RRF fusion)',
        enum: ['code', 'knowledge', 'all'],
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

    const searchScope = input.searchScope ?? 'code';

    // Unified search: code + knowledge or knowledge-only
    if (searchScope === 'all' || searchScope === 'knowledge') {
      const client = await getGraphClient();
      const opts: Parameters<typeof unifiedSearch>[2] = {
        limit: input.limit ?? 20,
        searchScope,
      };
      if (input.scope) opts.scope = input.scope;
      const result = await unifiedSearch(input.query, client, opts);
      return {
        results: result.results,
        total: result.results.length,
        durationMs: result.meta.durationMs,
        searchScope,
      };
    }

    // Default: code-only search
    const opts: { limit: number; scope?: string } = { limit: input.limit ?? 20 };
    if (input.scope) opts.scope = input.scope;

    const result = await codeGraphService.search(input.query, opts);

    return {
      results: result.hits,
      total: result.hits.length,
      durationMs: result.meta.durationMs,
      ...(result.meta.notice ? { notice: result.meta.notice } : {}),
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
