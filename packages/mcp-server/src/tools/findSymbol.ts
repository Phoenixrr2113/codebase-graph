/**
 * MCP Tool: find_symbol
 *
 * Find a symbol by name and return its definition with source code.
 */

import { codeGraphService } from '@codegraph/core';
import type { ToolDefinition } from './consolidated';

// Input schema
export interface FindSymbolInput {
  name: string;
  kind?: 'function' | 'class' | 'interface' | 'variable' | 'any';
  file?: string;
}

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



/**
 * Handler for find_symbol tool
 */
export async function findSymbol(input: FindSymbolInput): Promise<FindSymbolOutput> {
  try {
    if (!input.name || input.name.trim() === '') {
      return { found: false, symbol: null, error: 'Symbol name is required' };
    }

    const opts: { kind?: 'function' | 'class' | 'interface' | 'variable' | 'any'; file?: string } = {};
    if (input.kind != null) opts.kind = input.kind;
    if (input.file) opts.file = input.file;
    const result = await codeGraphService.findSymbol(input.name, opts);

    if (!result.symbol) {
      return { found: false, symbol: null, error: `No symbol found matching "${input.name}"` };
    }

    return {
      found: true,
      symbol: result.symbol,
      alternatives: result.alternatives,
    };
  } catch (error) {
    return {
      found: false,
      symbol: null,
      error: error instanceof Error ? error.message : 'Unknown error finding symbol',
    };
  }
}
