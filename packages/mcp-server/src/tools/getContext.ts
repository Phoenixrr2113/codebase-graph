/**
 * MCP Tool: get_context
 * Get detailed context for a specific file or symbol
 */

import { createQueries } from '@codegraph/graph';
import { codeGraphService, getGraphClient } from '@codegraph/core';
import type { ToolDefinition } from './consolidated';

// ============================================================================
// Schema
// ============================================================================

export interface GetContextInput {
  file?: string;
  symbol?: string;
  includeRelationships?: boolean;
  maxDepth?: number;
}

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
  if (!input.file && !input.symbol) {
    return { relationships: [], error: 'Either file or symbol must be specified' };
  }

  try {
    // File context — uses graph subgraph query (visualization-oriented, stays in @codegraph/graph)
    if (input.file && !input.symbol) {
      const client = await getGraphClient();
      const queries = createQueries(client);
      const subgraph = await queries.getFileSubgraph(input.file);

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

      return { file: { path: input.file, entities }, relationships };
    }

    // Symbol context — uses CodeGraphService
    if (input.symbol) {
      // Find the symbol and its file
      const findOpts: { file?: string } = {};
      if (input.file) findOpts.file = input.file;
      const findResult = await codeGraphService.findSymbol(input.symbol, findOpts);

      if (!findResult.symbol) {
        return {
          relationships: [],
          error: `Symbol "${input.symbol}" not found${input.file ? ` in ${input.file}` : ''}`,
        };
      }

      // Get detailed symbol info
      const detail = await codeGraphService.getSymbolDetail(
        input.symbol,
        findResult.symbol.file,
      );

      const entity: EntityContext | undefined = detail
        ? {
            name: detail.name,
            type: detail.type,
            filePath: detail.filePath,
            startLine: detail.startLine,
            endLine: detail.endLine,
            docstring: detail.docstring,
            params: detail.params,
            returnType: detail.returnType,
            complexity: detail.complexity,
          }
        : undefined;

      // Get relationships
      const relationships: RelatedEntity[] = [];
      if (input.includeRelationships) {
        const [callers, calls] = await Promise.all([
          codeGraphService.getFunctionCallers(input.symbol),
          codeGraphService.getSymbolCalls(input.symbol),
        ]);

        for (const caller of callers) {
          relationships.push({
            name: caller.name,
            type: 'Function',
            relationship: 'CALLED_BY',
            filePath: caller.filePath,
          });
        }

        for (const call of calls) {
          relationships.push({
            name: call.name,
            type: call.type,
            relationship: 'CALLS',
            filePath: call.filePath,
          });
        }
      }

      return { entity, relationships };
    }

    return { relationships: [] };
  } catch (error) {
    return {
      relationships: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
