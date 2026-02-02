/**
 * MCP Tool: search
 * Unified search across the codebase graph
 */

import { z } from 'zod';
import { createClient } from '@codegraph/graph';
import { createLogger } from '@codegraph/logger';
import { getActiveProjectPaths } from '../config';

const logger = createLogger({ namespace: 'MCP:Search' });

// ============================================================================
// Schema
// ============================================================================

export const SearchInputSchema = z.object({
  query: z.string().describe('Search term (file name, symbol name, or keyword)'),
  type: z
    .enum(['all', 'file', 'function', 'class', 'interface', 'component'])
    .default('all')
    .describe('Filter by entity type'),
  limit: z.number().default(20).describe('Maximum results to return'),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;

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
}

// ============================================================================
// Tool Definition
// ============================================================================

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

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
  logger.debug('Search called', { query: input.query, type: input.type });

  try {
    const client = await createClient();
    const activePaths = await getActiveProjectPaths();

    // Build type filter
    const typeFilter =
      input.type === 'all'
        ? '(n:File OR n:Function OR n:Class OR n:Interface OR n:Component OR n:Variable OR n:Type)'
        : `n:${input.type.charAt(0).toUpperCase() + input.type.slice(1)}`;

    // Build project path filter
    let pathFilter = '';
    if (activePaths.length > 0) {
      // Filter to only include files within active project paths
      const pathConditions = activePaths.map((p) => `n.filePath STARTS WITH '${p}' OR n.path STARTS WITH '${p}'`);
      pathFilter = `AND (${pathConditions.join(' OR ')})`;
    }

    // Search by name (case-insensitive)
    const query = `
      MATCH (n)
      WHERE ${typeFilter}
        AND (
          toLower(n.name) CONTAINS toLower($term)
          OR toLower(n.path) CONTAINS toLower($term)
        )
        ${pathFilter}
      RETURN n, labels(n) as labels
      LIMIT $limit
    `;

    const result = await client.roQuery<{
      n: Record<string, unknown>;
      labels: string[];
    }>(query, { params: { term: input.query, limit: input.limit } });

    const results: SearchResult[] = (result.data ?? []).map((row) => {
      const props = row.n['properties']
        ? (row.n['properties'] as Record<string, unknown>)
        : row.n;
      const type = row.labels[0] ?? 'Unknown';

      return {
        name: (props['name'] as string) ?? (props['path'] as string) ?? 'unknown',
        type,
        filePath: (props['filePath'] as string) ?? (props['path'] as string) ?? '',
        line: props['startLine'] as number | undefined,
      };
    });

    return {
      results,
      total: results.length,
      query: input.query,
      project: activePaths.length === 1 ? activePaths[0]?.split('/').pop() : undefined,
    };
  } catch (error) {
    logger.error('Search failed', { error });
    return {
      results: [],
      total: 0,
      query: input.query,
    };
  }
}
