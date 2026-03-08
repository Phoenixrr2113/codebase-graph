/**
 * MCP Tool: get_index_status
 *
 * Returns current indexing status including file counts and last update time.
 */

import { codeGraphService } from '@codegraph/core';
import type { ToolDefinition } from './consolidated';

// Input schema
export interface IndexStatusInput {
  repo?: string;
}

// Output type
export interface IndexStatusOutput {
  status: 'ready' | 'indexing' | 'error' | 'empty';
  totalFiles: number;
  totalFunctions: number;
  totalClasses: number;
  totalEdges: number;
  lastIndexed?: string | undefined;
  projects: Array<{
    name: string;
    path: string;
    fileCount: number;
    lastParsed?: string | undefined;
  }>;
  error?: string | undefined;
}

// Tool definition for MCP
export const indexStatusToolDefinition: ToolDefinition = {
  name: 'get_index_status',
  description: 'Get the current status of the code index, including file counts and last update time.',
  inputSchema: {
    type: 'object',
    properties: {
      repo: {
        type: 'string',
        description: 'Repository path to check status for (optional)',
      },
    },
    required: [],
  },
};



/**
 * Handler for get_index_status tool
 */
export async function getIndexStatus(input: IndexStatusInput): Promise<IndexStatusOutput> {
  try {
    return await codeGraphService.getIndexStatus(input.repo);
  } catch (error) {
    return {
      status: 'error',
      totalFiles: 0,
      totalFunctions: 0,
      totalClasses: 0,
      totalEdges: 0,
      projects: [],
      error: error instanceof Error ? error.message : 'Unknown error checking index status',
    };
  }
}
