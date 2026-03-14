/**
 * MCP Tool: query_graph
 *
 * Run a raw Cypher query against the code graph.
 */

import { getGraphClient } from '@codegraph/core';
import type { ToolDefinition } from './consolidated';

// Input schema
export interface QueryGraphInput {
  cypher: string;
  params?: Record<string, unknown>;
}

// Output type
export interface QueryGraphOutput {
  success: boolean;
  data: unknown[];
  count: number;
  metadata?: string[];
  error?: string;
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

    // Read-only enforcement is handled by roQuery() at the driver level,
    // which runs the query in a read-only transaction. This is more reliable
    // than string-based mutation detection which can be bypassed.
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
