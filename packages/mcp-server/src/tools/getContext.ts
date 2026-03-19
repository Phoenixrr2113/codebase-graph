/**
 * MCP Tool: get_context
 * Get detailed context for a specific file or symbol
 */

import { codeGraphService } from '@codegraph/core';
import { toErrorMessage } from '@codegraph/logger';
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
    // File context — uses core service subgraph query
    if (input.file && !input.symbol) {
      const subgraph = await codeGraphService.getFileSubgraph(input.file);

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
      // Find symbol via direct Cypher lookup
      const fileFilter = input.file ? 'AND n.filePath CONTAINS $file' : '';
      const findResult = await codeGraphService.executeReadQuery(
        `MATCH (n) WHERE n.name = $name ${fileFilter} AND (n:Function OR n:Class OR n:Interface OR n:Component OR n:Type) RETURN n.name AS name, labels(n)[0] AS kind, n.filePath AS file, n.startLine AS line, n.endLine AS endLine, n.complexity AS complexity LIMIT 1`,
        { name: input.symbol, ...(input.file ? { file: input.file } : {}) },
      );

      const sym = (findResult.results as Record<string, unknown>[])?.[0];
      if (!sym) {
        return {
          relationships: [],
          error: `Symbol "${input.symbol}" not found${input.file ? ` in ${input.file}` : ''}`,
        };
      }

      const entity: EntityContext = {
        name: sym.name as string,
        type: (sym.kind as string)?.toLowerCase() ?? 'unknown',
        filePath: sym.file as string ?? '',
        startLine: sym.line as number | undefined,
        endLine: sym.endLine as number | undefined,
        complexity: sym.complexity as number | undefined,
      };

      // Get relationships via graph queries
      const relationships: RelatedEntity[] = [];
      if (input.includeRelationships) {
        try {
          const callersResult = await codeGraphService.executeReadQuery(
            `MATCH (caller)-[:CALLS]->(target) WHERE target.name = $name RETURN caller.name AS name, labels(caller)[0] AS type, caller.filePath AS filePath LIMIT 20`,
            { name: input.symbol },
          );
          for (const row of callersResult.results as Record<string, unknown>[]) {
            relationships.push({
              name: row.name as string,
              type: (row.type as string) || 'Function',
              relationship: 'CALLED_BY',
              filePath: (row.filePath as string) || '',
            });
          }

          const callsResult = await codeGraphService.executeReadQuery(
            `MATCH (source)-[:CALLS]->(target) WHERE source.name = $name RETURN target.name AS name, labels(target)[0] AS type, target.filePath AS filePath LIMIT 20`,
            { name: input.symbol },
          );
          for (const row of callsResult.results as Record<string, unknown>[]) {
            relationships.push({
              name: row.name as string,
              type: (row.type as string) || 'Function',
              relationship: 'CALLS',
              filePath: (row.filePath as string) || '',
            });
          }
        } catch {
          // Graph queries may fail if graph is not available
        }
      }

      return { entity, relationships };
    }

    return { relationships: [] };
  } catch (error) {
    return {
      relationships: [],
      error: toErrorMessage(error),
    };
  }
}
