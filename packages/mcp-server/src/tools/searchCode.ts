/**
 * MCP Tool: search_code
 *
 * Search for code by name, pattern, or text content.
 * Queries graph for matching symbols.
 */

import { z } from 'zod';
import { getGraphClient } from '@codegraph/core';
import type { ToolDefinition } from './consolidated';

// Input schema
export const SearchCodeInputSchema = z.object({
  query: z.string().describe('Search query'),
  type: z.enum(['name', 'fulltext', 'pattern']).default('name')
    .describe('Search type: name (exact match), fulltext (text search), pattern (AST pattern)'),
  scope: z.string().default('all').describe('Limit search to specific scope'),
  language: z.string().optional().describe('Filter by programming language'),
});

export type SearchCodeInput = z.infer<typeof SearchCodeInputSchema>;

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
      return {
        results: [],
        total: 0,
        error: 'Search query is required',
      };
    }

    const client = await getGraphClient();
    const dialect = client.dialect;
    const lc = dialect.labelCheckExpr.bind(dialect);
    const firstLabel = dialect.firstLabelExpr('n');
    const scope = input.scope === 'all' ? '' : input.scope;

    // Build Cypher query based on search type — use dialect-aware expressions
    let cypher: string;
    const scopeFilter = scope ? 'AND n.filePath STARTS WITH $scope' : '';
    const labelFilter = `(${['Function', 'Class', 'Interface', 'Variable', 'Component'].map(l => lc('n', l)).join(' OR ')})`;

    if (input.type === 'name') {
      // Exact or contains match on name
      cypher = `
        MATCH (n)
        WHERE ${labelFilter}
          AND n.name CONTAINS $query ${scopeFilter}
        RETURN n.name as name, ${firstLabel} as kind, n.filePath as file, n.startLine as line
        ORDER BY n.name
        LIMIT 50
      `;
    } else {
      // For fulltext and pattern, fall back to name search for now
      // TODO: Implement fulltext index search when available
      cypher = `
        MATCH (n)
        WHERE ${labelFilter}
          AND toLower(n.name) CONTAINS toLower($query) ${scopeFilter}
        RETURN n.name as name, ${firstLabel} as kind, n.filePath as file, n.startLine as line
        ORDER BY n.name
        LIMIT 50
      `;
    }

    type ResultRow = { name: string; kind: string; file: string; line: number };

    // Only pass params that are actually referenced in the query
    const params: Record<string, string | number | boolean | null | Array<unknown>> = { query: input.query };
    if (scope) params.scope = scope;

    const result = await client.roQuery<ResultRow>(
      cypher,
      { params }
    );

    const results: SearchResult[] = result.data.map(row => ({
      name: row.name ?? 'unknown',
      kind: (row.kind ?? 'unknown').toLowerCase(),
      file: row.file ?? '',
      line: row.line ?? 0,
      match: row.name ?? '',
    }));

    return {
      results,
      total: results.length,
    };
  } catch (error) {
    return {
      results: [],
      total: 0,
      error: error instanceof Error ? error.message : 'Unknown error during search',
    };
  }
}
