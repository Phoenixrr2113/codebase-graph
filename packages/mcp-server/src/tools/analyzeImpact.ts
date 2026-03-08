/**
 * MCP Tool: analyze_impact
 *
 * Find all code affected by changing a symbol.
 * Uses @codegraph/core analysis module and graph queries.
 */

import { codeGraphService } from '@codegraph/core';
import type { ToolDefinition } from './consolidated';

// Input schema
export interface AnalyzeImpactInput {
  symbol: string;
  file?: string;
  depth?: number;
}

// Output type
export interface AnalyzeImpactOutput {
  directCallers: Array<{ name: string; file: string }>;
  transitiveCallers: Array<{ name: string; file: string; depth: number }>;
  affectedFiles: string[];
  affectedTests: Array<{ name: string; file: string }>;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  recommendation: string;
  error?: string | undefined;
}

// Tool definition for MCP
export const analyzeImpactToolDefinition: ToolDefinition = {
  name: 'analyze_impact',
  description: 'Find all code affected by changing a symbol. Returns callers, affected files, tests, and risk assessment.',
  inputSchema: {
    type: 'object',
    properties: {
      symbol: {
        type: 'string',
        description: 'Symbol name to analyze (required)',
      },
      file: {
        type: 'string',
        description: 'Disambiguate if multiple matches (optional)',
      },
      depth: {
        type: 'number',
        default: 5,
        description: 'Traversal depth for impact analysis',
      },
    },
    required: ['symbol'],
  },
};



/**
 * Handler for analyze_impact tool
 */
export async function analyzeImpact(input: AnalyzeImpactInput): Promise<AnalyzeImpactOutput> {
  try {
    if (!input.symbol || input.symbol.trim() === '') {
      return {
        directCallers: [], transitiveCallers: [], affectedFiles: [], affectedTests: [],
        riskScore: 0, riskLevel: 'low', recommendation: '', error: 'Symbol name is required',
      };
    }

    const opts: { file?: string; depth?: number } = {};
    if (input.depth != null) opts.depth = input.depth;
    if (input.file) opts.file = input.file;
    return await codeGraphService.analyzeImpact(input.symbol, opts);
  } catch (error) {
    return {
      directCallers: [], transitiveCallers: [], affectedFiles: [], affectedTests: [],
      riskScore: 0, riskLevel: 'low', recommendation: '',
      error: error instanceof Error ? error.message : 'Unknown error analyzing impact',
    };
  }
}
