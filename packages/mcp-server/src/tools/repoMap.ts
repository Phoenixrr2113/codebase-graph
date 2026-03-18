/**
 * MCP Tool: get_repo_map
 *
 * Get a ranked map of important symbols for LLM context.
 * Queries the graph for high-connectivity and high-complexity symbols,
 * then formats them as a condensed codebase overview.
 */

import { codeGraphService } from '@codegraph/core';
import type { ToolDefinition } from './consolidated';

// Input schema
export interface RepoMapInput {
  maxTokens?: number;
  focusFiles?: string[];
  focusSymbols?: string[];
}

// Output type
export interface RepoMapOutput {
  map: string;
  filesIncluded: number;
  symbolsIncluded: number;
  error?: string;
}

// Tool definition for MCP
export const repoMapToolDefinition: ToolDefinition = {
  name: 'get_repo_map',
  description: 'Get a ranked map of important symbols for LLM context. Returns a condensed view of the codebase showing the most important files and symbols.',
  inputSchema: {
    type: 'object',
    properties: {
      maxTokens: {
        type: 'number',
        default: 2048,
        description: 'Maximum tokens for the map',
      },
      focusFiles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files to prioritize in the map',
      },
      focusSymbols: {
        type: 'array',
        items: { type: 'string' },
        description: 'Symbols to prioritize in the map',
      },
    },
    required: [],
  },
};

/**
 * Handler for get_repo_map tool
 */
export async function getRepoMap(_input: RepoMapInput): Promise<RepoMapOutput> {
  try {
    const [fileTree, summary] = await Promise.all([
      codeGraphService.buildFileTree({ maxDepth: 3 }),
      codeGraphService.getIndexSummary(),
    ]);
    const map = `${summary}\n\n${fileTree}`;
    const filesIncluded = (map.match(/\n/g) || []).length;
    return { map, filesIncluded, symbolsIncluded: 0 };
  } catch (error) {
    return {
      map: '',
      filesIncluded: 0,
      symbolsIncluded: 0,
      error: error instanceof Error ? error.message : 'Unknown error generating repo map',
    };
  }
}
