/**
 * MCP Tool: analyze_impact
 *
 * Find all code affected by changing a symbol.
 */

import { z } from 'zod';

// Input schema
export const AnalyzeImpactInputSchema = z.object({
  symbol: z.string().describe('Symbol name to analyze'),
  file: z.string().optional().describe('Disambiguate if multiple matches'),
  depth: z.number().default(5).describe('Traversal depth'),
});

export type AnalyzeImpactInput = z.infer<typeof AnalyzeImpactInputSchema>;

// Output type
export interface AnalyzeImpactOutput {
  directCallers: string[];
  transitiveCallers: string[];
  affectedFiles: string[];
  affectedTests: string[];
  riskScore: number;
  recommendation: string;
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
export const analyzeImpactToolDefinition: ToolDefinition = {
  name: 'analyze_impact',
  description: 'Find all code affected by changing a symbol.',
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
        directCallers: [],
        transitiveCallers: [],
        affectedFiles: [],
        affectedTests: [],
        riskScore: 0,
        recommendation: '',
        error: 'Symbol name is required',
      };
    }

    // TODO: Query graph for impact analysis when API integration is complete
    // This requires traversing CALLS edges and identifying test files
    
    return {
      directCallers: [],
      transitiveCallers: [],
      affectedFiles: [],
      affectedTests: [],
      riskScore: 0,
      recommendation: `Impact analysis for "${input.symbol}" requires API integration (coming in MCP-INT-001)`,
    };
  } catch (error) {
    return {
      directCallers: [],
      transitiveCallers: [],
      affectedFiles: [],
      affectedTests: [],
      riskScore: 0,
      recommendation: '',
      error: error instanceof Error ? error.message : 'Unknown error analyzing impact',
    };
  }
}
