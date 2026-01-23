/**
 * MCP Tool: get_index_status
 *
 * Returns current indexing status including file counts and last update time.
 */

import { z } from 'zod';
import { getGraphClient } from '../graphClient';

// Input schema
export const IndexStatusInputSchema = z.object({
  repo: z.string().optional().describe('Repository path to check status for'),
});

export type IndexStatusInput = z.infer<typeof IndexStatusInputSchema>;

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
    const client = await getGraphClient();

    // Query counts from the graph
    const [fileResult, funcResult, classResult, projectResult] = await Promise.all([
      client.roQuery<{ count: number }>('MATCH (f:File) RETURN count(f) as count'),
      client.roQuery<{ count: number }>('MATCH (f:Function) RETURN count(f) as count'),
      client.roQuery<{ count: number }>('MATCH (c:Class) RETURN count(c) as count'),
      client.roQuery<{ name: string; path: string; fileCount: number; lastParsed: string }>(
        input.repo
          ? 'MATCH (p:Project) WHERE p.rootPath CONTAINS $repo RETURN p.name as name, p.rootPath as path, p.fileCount as fileCount, p.lastParsed as lastParsed'
          : 'MATCH (p:Project) RETURN p.name as name, p.rootPath as path, p.fileCount as fileCount, p.lastParsed as lastParsed',
        input.repo ? { params: { repo: input.repo } } : undefined
      ),
    ]);

    // Get edge count separately
    const edgeResult = await client.roQuery<{ count: number }>(
      'MATCH ()-[r]->() RETURN count(r) as count'
    );

    const totalFiles = fileResult.data[0]?.count ?? 0;
    const totalFunctions = funcResult.data[0]?.count ?? 0;
    const totalClasses = classResult.data[0]?.count ?? 0;
    const totalEdges = edgeResult.data[0]?.count ?? 0;

    const projects = projectResult.data.map(p => ({
      name: p.name ?? 'unknown',
      path: p.path ?? '',
      fileCount: p.fileCount ?? 0,
      lastParsed: p.lastParsed,
    }));

    // Determine status
    let status: 'ready' | 'indexing' | 'error' | 'empty' = 'ready';
    if (totalFiles === 0) {
      status = 'empty';
    }

    // Find most recent indexed time
    const lastIndexed = projects.length > 0
      ? projects.reduce((latest, p) =>
        p.lastParsed && (!latest || p.lastParsed > latest) ? p.lastParsed : latest,
        '' as string
      )
      : undefined;

    return {
      status,
      totalFiles,
      totalFunctions,
      totalClasses,
      totalEdges,
      lastIndexed: lastIndexed || undefined,
      projects,
    };
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
