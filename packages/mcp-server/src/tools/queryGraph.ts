/**
 * MCP Tool: query_graph
 *
 * Run a raw Cypher query against the code graph.
 */

import { z } from 'zod';
import { createClient, type GraphClient } from '@codegraph/graph';

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
  metadata?: string[];
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

// Singleton graph client
let graphClient: GraphClient | null = null;

async function getGraphClient(): Promise<GraphClient> {
  if (!graphClient) {
    graphClient = await createClient();
  }
  return graphClient;
}

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

    // Execute query via graph client
    const client = await getGraphClient();
    const result = await client.roQuery<Record<string, unknown>>(
      input.cypher,
      input.params ? { params: input.params as Record<string, string | number | boolean | null | Array<unknown>> } : undefined
    );

    return {
      success: true,
      data: result.data,
      count: result.data.length,
      metadata: result.metadata,
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
