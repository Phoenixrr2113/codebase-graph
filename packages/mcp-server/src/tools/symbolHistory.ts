/**
 * MCP Tool: get_symbol_history
 *
 * Get git commit history for a specific symbol.
 * Queries graph for Commit nodes connected via temporal edges.
 */

import { codeGraphService } from '@codegraph/core';
import type { ToolDefinition } from './consolidated';

// Input schema
export interface SymbolHistoryInput {
  symbol: string;
  file?: string;
  limit?: number;
}

// Change info type
export interface ChangeInfo {
  date: string;
  author: string;
  message: string;
  commitHash: string;
  linesAdded?: number | undefined;
  linesRemoved?: number | undefined;
}

// Output type
export interface SymbolHistoryOutput {
  symbol: string;
  file?: string | undefined;
  changes: ChangeInfo[];
  authors: string[];
  ageDays: number;
  changeFrequency: number;
  error?: string | undefined;
}

// Tool definition for MCP
export const symbolHistoryToolDefinition: ToolDefinition = {
  name: 'get_symbol_history',
  description: 'Get git commit history for a specific symbol.',
  inputSchema: {
    type: 'object',
    properties: {
      symbol: {
        type: 'string',
        description: 'Symbol name to get history for (required)',
      },
      file: {
        type: 'string',
        description: 'File path to disambiguate symbol (optional)',
      },
      limit: {
        type: 'number',
        default: 20,
        description: 'Maximum number of commits to return',
      },
    },
    required: ['symbol'],
  },
};

/**
 * Handler for get_symbol_history tool
 */
export async function getSymbolHistory(input: SymbolHistoryInput): Promise<SymbolHistoryOutput> {
  try {
    if (!input.symbol || input.symbol.trim() === '') {
      return { symbol: '', changes: [], authors: [], ageDays: 0, changeFrequency: 0, error: 'Symbol name is required' };
    }

    const opts: { file?: string; limit?: number } = {};
    if (input.limit != null) opts.limit = input.limit;
    if (input.file) opts.file = input.file;
    const result = await codeGraphService.getSymbolHistory(input.symbol, opts);

    if (result.changes.length === 0 && !result.file) {
      return {
        symbol: input.symbol,
        changes: [],
        authors: [],
        ageDays: 0,
        changeFrequency: 0,
        error: `Symbol "${input.symbol}" not found in graph`,
      };
    }

    return {
      symbol: input.symbol,
      file: result.file,
      changes: result.changes,
      authors: result.authors,
      ageDays: result.ageDays,
      changeFrequency: result.changeFrequency,
    };
  } catch (error) {
    return {
      symbol: input.symbol,
      changes: [],
      authors: [],
      ageDays: 0,
      changeFrequency: 0,
      error: error instanceof Error ? error.message : 'Unknown error getting symbol history',
    };
  }
}
