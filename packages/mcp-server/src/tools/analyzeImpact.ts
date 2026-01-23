/**
 * MCP Tool: analyze_impact
 *
 * Find all code affected by changing a symbol.
 * Uses @codegraph/parser analysis module and graph queries.
 */

import { z } from 'zod';
import { getGraphClient } from '../graphClient.js';
import {
  analyzeImpact as runImpactAnalysis,
  getDirectCallersQuery,
  getTransitiveCallersQuery,
  getAffectedTestsQuery,
  getImpactSummary,
  type ImpactAnalysisInput,
} from '@codegraph/parser';

// Input schema
export const AnalyzeImpactInputSchema = z.object({
  symbol: z.string().describe('Symbol name to analyze'),
  file: z.string().optional().describe('Disambiguate if multiple matches'),
  depth: z.number().default(5).describe('Traversal depth'),
});

export type AnalyzeImpactInput = z.infer<typeof AnalyzeImpactInputSchema>;

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
        directCallers: [],
        transitiveCallers: [],
        affectedFiles: [],
        affectedTests: [],
        riskScore: 0,
        riskLevel: 'low',
        recommendation: '',
        error: 'Symbol name is required',
      };
    }

    const client = await getGraphClient();
    const depth = input.depth ?? 5;

    // Get direct callers using generated Cypher
    const directCallersQuery = getDirectCallersQuery(input.symbol);
    const directResult = await client.roQuery<{ name: string; file: string }>(directCallersQuery);

    // Get transitive callers
    const transitiveCallersQuery = getTransitiveCallersQuery(input.symbol, depth);
    const transitiveResult = await client.roQuery<{ name: string; file: string; depth: number }>(transitiveCallersQuery);

    // Get affected tests
    const testsQuery = getAffectedTestsQuery(input.symbol);
    const testsResult = await client.roQuery<{ name: string; file: string }>(testsQuery);

    // Get target symbol info (for complexity)
    const targetQuery = `MATCH (f:Function) WHERE f.name = $name RETURN f.name as name, f.filePath as file, f.complexity as complexity LIMIT 1`;
    const targetResult = await client.roQuery<{ name: string; file: string; complexity?: number }>(
      targetQuery,
      { params: { name: input.symbol } }
    );

    // Build input for analysis module
    const targetComplexity = targetResult.data[0]?.complexity;
    const analysisInput: ImpactAnalysisInput = {
      target: {
        name: input.symbol,
        file: targetResult.data[0]?.file ?? '',
        ...(targetComplexity !== undefined && { complexity: targetComplexity }),
      },
      callers: [
        ...directResult.data.map(c => ({ ...c, depth: 1 })),
        ...transitiveResult.data,
      ],
      tests: testsResult.data,
    };

    // Run analysis
    const result = runImpactAnalysis(analysisInput, { maxDepth: depth });

    // Get affected files
    const affectedFiles = [...new Set([
      ...directResult.data.map(c => c.file),
      ...transitiveResult.data.map(c => c.file),
    ])].filter(Boolean);

    return {
      directCallers: directResult.data,
      transitiveCallers: transitiveResult.data,
      affectedFiles,
      affectedTests: testsResult.data,
      riskScore: result.riskScore,
      riskLevel: result.riskLevel,
      recommendation: getImpactSummary(result),
    };
  } catch (error) {
    return {
      directCallers: [],
      transitiveCallers: [],
      affectedFiles: [],
      affectedTests: [],
      riskScore: 0,
      riskLevel: 'low',
      recommendation: '',
      error: error instanceof Error ? error.message : 'Unknown error analyzing impact',
    };
  }
}
