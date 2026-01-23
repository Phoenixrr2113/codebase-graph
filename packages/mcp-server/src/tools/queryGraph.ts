/**
 * MCP Tool: query_graph
 *
 * Run a raw Cypher query against the code graph.
 */

import { z } from 'zod';

// Input schema
export const QueryGraphInputSchema = z.object({
  cypher: z.string().describe('Cypher query to execute'),
  params: z.record(z.unknown()).optional().describe('Query parameters'),
});

export type QueryGraphInput = z.infer<typeof QueryGraphInputSchema>;

// Output type
export interface QueryGraphOutput {
  success: boolean;
  data: unknown[];
  count: number;
  error?: string;
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
export const queryGraphToolDefinition: ToolDefinition = {
  name: 'query_graph',
  description: 'Run a raw Cypher query against the code graph. Use with caution - read-only queries only.',
  inputSchema: {
    type: 'object',
    properties: {
      cypher: {
        type: 'string',
        description: 'Cypher query to execute (required)',
      },
      params: {
        type: 'object',
        description: 'Query parameters (optional)',
      },
    },
    required: ['cypher'],
  },
};

/**
 * Handler for query_graph tool
 * 
 * Executes raw Cypher queries. Should be read-only.
 */
export async function queryGraph(input: QueryGraphInput): Promise<QueryGraphOutput> {
  try {
    if (!input.cypher || input.cypher.trim() === '') {
      return {
        success: false,
        data: [],
        count: 0,
        error: 'Cypher query is required',
      };
    }

    // Safety check - reject mutation queries
    const lowerQuery = input.cypher.toLowerCase();
    if (lowerQuery.includes('create') || 
        lowerQuery.includes('merge') || 
        lowerQuery.includes('delete') ||
        lowerQuery.includes('set ') ||
        lowerQuery.includes('remove')) {
      return {
        success: false,
        data: [],
        count: 0,
        error: 'Mutation queries are not allowed. Use read-only MATCH queries.',
      };
    }

    // TODO: Execute query via graph client when API integration is complete
    
    return {
      success: false,
      data: [],
      count: 0,
      error: 'Graph query execution requires API integration (coming in MCP-INT-001)',
    };
  } catch (error) {
    return {
      success: false,
      data: [],
      count: 0,
      error: error instanceof Error ? error.message : 'Unknown error executing query',
    };
  }
}
