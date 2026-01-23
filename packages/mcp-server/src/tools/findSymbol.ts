/**
 * MCP Tool: find_symbol
 *
 * Find a symbol by name and return its definition with source code.
 */

import { z } from 'zod';
import { createClient, type GraphClient } from '@codegraph/graph';

// Input schema
export const FindSymbolInputSchema = z.object({
  name: z.string().describe('Symbol name to search for'),
  kind: z.enum(['function', 'class', 'interface', 'variable', 'any']).default('any')
    .describe('Type of symbol to search for'),
  file: z.string().optional().describe('Limit search to a specific file'),
});

export type FindSymbolInput = z.infer<typeof FindSymbolInputSchema>;

// Symbol result type
export interface SymbolResult {
  name: string;
  kind: string;
  file: string;
  line: number;
  endLine?: number | undefined;
  signature?: string | undefined;
  complexity?: number | undefined;
}

// Output type
export interface FindSymbolOutput {
  found: boolean;
  symbol: SymbolResult | null;
  alternatives?: SymbolResult[] | undefined;
  error?: string | undefined;
}

// Internal ToolDefinition type
interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// Tool definition for MCP
export const findSymbolToolDefinition: ToolDefinition = {
  name: 'find_symbol',
  description: 'Find a symbol by name and return its definition with source code.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Symbol name to search for (required)',
      },
      kind: {
        type: 'string',
        enum: ['function', 'class', 'interface', 'variable', 'any'],
        default: 'any',
        description: 'Type of symbol to search for',
      },
      file: {
        type: 'string',
        description: 'Limit search to a specific file (optional)',
      },
    },
    required: ['name'],
  },
};

// Singleton graph client
let graphClient: GraphClient | null = null;

async function getGraphClient(): Promise<GraphClient> {
  if (!graphClient) {
    graphClient = await createClient();
  }
  return graphClient;
}

/**
 * Handler for find_symbol tool
 */
export async function findSymbol(input: FindSymbolInput): Promise<FindSymbolOutput> {
  try {
    if (!input.name || input.name.trim() === '') {
      return {
        found: false,
        symbol: null,
        error: 'Symbol name is required',
      };
    }

    const client = await getGraphClient();

    // Map kind to graph node labels
    const kindToLabel: Record<string, string> = {
      'function': 'Function',
      'class': 'Class',
      'interface': 'Interface',
      'variable': 'Variable',
      'any': '',
    };

    const label = kindToLabel[input.kind] || '';

    // Build Cypher query
    let cypher: string;
    const params: Record<string, string | number | boolean | null | Array<unknown>> = { name: input.name };

    if (label && input.file) {
      cypher = `MATCH (n:${label}) WHERE n.name = $name AND n.filePath CONTAINS $file RETURN n, labels(n) as labels LIMIT 10`;
      params.file = input.file;
    } else if (label) {
      cypher = `MATCH (n:${label}) WHERE n.name = $name RETURN n, labels(n) as labels LIMIT 10`;
    } else if (input.file) {
      cypher = `MATCH (n) WHERE n.name = $name AND n.filePath CONTAINS $file AND (n:Function OR n:Class OR n:Interface OR n:Variable) RETURN n, labels(n) as labels LIMIT 10`;
      params.file = input.file;
    } else {
      cypher = `MATCH (n) WHERE n.name = $name AND (n:Function OR n:Class OR n:Interface OR n:Variable) RETURN n, labels(n) as labels LIMIT 10`;
    }

    const result = await client.roQuery<{ n: Record<string, unknown>; labels: string[] }>(
      cypher,
      { params }
    );

    if (result.data.length === 0) {
      return {
        found: false,
        symbol: null,
        error: `No symbol found matching "${input.name}"`,
      };
    }

    // Map results to SymbolResult
    const symbols: SymbolResult[] = result.data.map(row => ({
      name: row.n['name'] as string || 'unknown',
      kind: (row.labels[0] || 'unknown').toLowerCase(),
      file: row.n['filePath'] as string || '',
      line: row.n['startLine'] as number || row.n['line'] as number || 0,
      endLine: row.n['endLine'] as number | undefined,
      signature: row.n['signature'] as string | undefined,
      complexity: row.n['complexity'] as number | undefined,
    }));

    return {
      found: true,
      symbol: symbols[0] ?? null,
      alternatives: symbols.length > 1 ? symbols.slice(1) : undefined,
    };
  } catch (error) {
    return {
      found: false,
      symbol: null,
      error: error instanceof Error ? error.message : 'Unknown error finding symbol',
    };
  }
}
