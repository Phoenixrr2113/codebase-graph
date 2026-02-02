/**
 * MCP Tool: get_context
 * Get detailed context for a specific file or symbol
 */

import { z } from 'zod';
import { createClient, createQueries } from '@codegraph/graph';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'MCP:GetContext' });

// ============================================================================
// Schema
// ============================================================================

export const GetContextInputSchema = z.object({
  file: z.string().optional().describe('File path to get context for'),
  symbol: z.string().optional().describe('Symbol name to get context for'),
  includeRelationships: z.boolean().default(true).describe('Include related entities'),
  maxDepth: z.number().default(2).describe('Depth of relationship traversal'),
});

export type GetContextInput = z.infer<typeof GetContextInputSchema>;

export interface EntityContext {
  name: string;
  type: string;
  filePath: string;
  startLine?: number | undefined;
  endLine?: number | undefined;
  code?: string | undefined;
  docstring?: string | undefined;
  params?: Array<{ name: string; type?: string }> | undefined;
  returnType?: string | undefined;
  complexity?: number | undefined;
}

export interface RelatedEntity {
  name: string;
  type: string;
  relationship: string;
  filePath: string;
}

export interface GetContextOutput {
  entity?: EntityContext | undefined;
  file?: {
    path: string;
    entities: EntityContext[];
  };
  relationships: RelatedEntity[];
  error?: string | undefined;
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

export const getContextToolDefinition: ToolDefinition = {
  name: 'get_context',
  description: `Get detailed context for a file or symbol.

Returns:
- For files: all functions, classes, interfaces in the file
- For symbols: full definition, parameters, return type, docstring
- Related entities: what it calls, what calls it, imports, etc.

Examples:
- { "file": "src/auth/login.ts" } - get all entities in file
- { "symbol": "validateToken" } - get function details and callers
- { "symbol": "UserSession", "file": "src/auth/session.ts" } - specific symbol in file`,
  inputSchema: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'File path to get context for',
      },
      symbol: {
        type: 'string',
        description: 'Symbol name to get context for',
      },
      includeRelationships: {
        type: 'boolean',
        default: true,
        description: 'Include related entities (callers, imports, etc.)',
      },
      maxDepth: {
        type: 'number',
        default: 2,
        description: 'Depth of relationship traversal',
      },
    },
  },
};

// ============================================================================
// Handler
// ============================================================================

export async function getContext(input: GetContextInput): Promise<GetContextOutput> {
  logger.debug('GetContext called', { file: input.file, symbol: input.symbol });

  if (!input.file && !input.symbol) {
    return {
      relationships: [],
      error: 'Either file or symbol must be specified',
    };
  }

  try {
    const client = await createClient();
    const queries = createQueries(client);

    // Get file context
    if (input.file && !input.symbol) {
      const subgraph = await queries.getFileSubgraph(input.file);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const entities: EntityContext[] = subgraph.nodes
        .filter((n) => n.label !== 'File')
        .map((n) => {
          const data = (n.data ?? {}) as unknown as Record<string, unknown>;
          return {
            name: n.displayName,
            type: n.label,
            filePath: n.filePath ?? '',
            startLine: data['startLine'] as number | undefined,
            endLine: data['endLine'] as number | undefined,
            docstring: data['docstring'] as string | undefined,
            params: data['params'] as Array<{ name: string; type?: string }> | undefined,
            returnType: data['returnType'] as string | undefined,
            complexity: data['complexity'] as number | undefined,
          };
        });

      const relationships: RelatedEntity[] = [];
      if (input.includeRelationships) {
        for (const edge of subgraph.edges) {
          const targetNode = subgraph.nodes.find((n) => n.id === edge.target);
          if (targetNode && edge.label !== 'CONTAINS') {
            relationships.push({
              name: targetNode.displayName,
              type: targetNode.label,
              relationship: edge.label,
              filePath: targetNode.filePath ?? '',
            });
          }
        }
      }

      return {
        file: {
          path: input.file,
          entities,
        },
        relationships,
      };
    }

    // Get symbol context
    if (input.symbol) {
      const searchResults = await queries.search(input.symbol, undefined, 10);

      // Filter by file if specified
      const matches = input.file
        ? searchResults.filter((r) => r.filePath.includes(input.file!))
        : searchResults;

      if (matches.length === 0) {
        return {
          relationships: [],
          error: `Symbol "${input.symbol}" not found${input.file ? ` in ${input.file}` : ''}`,
        };
      }

      const match = matches[0]!;

      // Get symbol details
      const detailQuery = `
        MATCH (n {name: $name})
        WHERE n.filePath CONTAINS $filePath OR n.path CONTAINS $filePath
        RETURN n, labels(n) as labels
        LIMIT 1
      `;

      const detailResult = await client.roQuery<{
        n: Record<string, unknown>;
        labels: string[];
      }>(detailQuery, { params: { name: input.symbol, filePath: match.filePath } });

      let entity: EntityContext | undefined;
      if (detailResult.data && detailResult.data.length > 0) {
        const row = detailResult.data[0]!;
        const props = row.n['properties']
          ? (row.n['properties'] as Record<string, unknown>)
          : row.n;

        entity = {
          name: (props['name'] as string) ?? input.symbol,
          type: row.labels[0] ?? 'Unknown',
          filePath: (props['filePath'] as string) ?? (props['path'] as string) ?? '',
          startLine: props['startLine'] as number | undefined,
          endLine: props['endLine'] as number | undefined,
          docstring: props['docstring'] as string | undefined,
          returnType: props['returnType'] as string | undefined,
          complexity: props['complexity'] as number | undefined,
        };

        // Parse params if present
        if (props['params'] && entity) {
          try {
            entity.params =
              typeof props['params'] === 'string'
                ? JSON.parse(props['params'])
                : (props['params'] as Array<{ name: string; type?: string }>);
          } catch {
            // Ignore parse errors
          }
        }
      }

      // Get relationships
      const relationships: RelatedEntity[] = [];
      if (input.includeRelationships) {
        // Get callers
        const callers = await queries.getFunctionCallers(input.symbol);
        for (const caller of callers) {
          relationships.push({
            name: caller.name,
            type: 'Function',
            relationship: 'CALLED_BY',
            filePath: caller.filePath,
          });
        }

        // Get what this symbol calls
        const callsQuery = `
          MATCH (n {name: $name})-[r:CALLS]->(target)
          RETURN target.name as name, labels(target)[0] as type, target.filePath as filePath
          LIMIT 20
        `;
        const callsResult = await client.roQuery<{
          name: string;
          type: string;
          filePath: string;
        }>(callsQuery, { params: { name: input.symbol } });

        for (const row of callsResult.data ?? []) {
          relationships.push({
            name: row.name,
            type: row.type,
            relationship: 'CALLS',
            filePath: row.filePath,
          });
        }
      }

      return {
        entity,
        relationships,
      };
    }

    return { relationships: [] };
  } catch (error) {
    logger.error('GetContext failed', { error });
    return {
      relationships: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
