/**
 * MCP Tool: get_complexity_report
 *
 * Generate a complexity report showing complex code hotspots.
 * Queries graph for Function nodes with high complexity.
 */

import { z } from 'zod';
import { getGraphClient } from '../graphClient';

// Input schema
export const ComplexityReportInputSchema = z.object({
  scope: z.string().default('all').describe('Scope to analyze'),
  threshold: z.number().default(10).describe('Minimum complexity threshold'),
  sortBy: z.enum(['complexity', 'cognitive', 'nesting']).default('complexity'),
});

export type ComplexityReportInput = z.infer<typeof ComplexityReportInputSchema>;

// Hotspot type
export interface ComplexityHotspot {
  name: string;
  file: string;
  complexity: number;
  cognitive: number;
  nesting: number;
  lines: number;
}

// Output type
export interface ComplexityReportOutput {
  hotspots: ComplexityHotspot[];
  summary: {
    totalFunctions: number;
    overThreshold: number;
    maxComplexity: number;
    avgComplexity: number;
  };
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
export const complexityReportToolDefinition: ToolDefinition = {
  name: 'get_complexity_report',
  description: 'Generate a complexity report showing complex code hotspots.',
  inputSchema: {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        default: 'all',
        description: 'Scope to analyze (file path prefix)',
      },
      threshold: {
        type: 'number',
        default: 10,
        description: 'Minimum complexity threshold to include in report',
      },
      sortBy: {
        type: 'string',
        enum: ['complexity', 'cognitive', 'nesting'],
        default: 'complexity',
        description: 'Sort results by this metric',
      },
    },
    required: [],
  },
};

/**
 * Handler for get_complexity_report tool
 */
export async function getComplexityReport(input: ComplexityReportInput): Promise<ComplexityReportOutput> {
  try {
    const client = await getGraphClient();
    const threshold = input.threshold ?? 10;
    const scope = input.scope === 'all' ? '' : input.scope;

    // Query for functions with complexity data
    const scopeFilter = scope ? 'AND f.filePath STARTS WITH $scope' : '';
    const query = `
      MATCH (f:Function)
      WHERE f.complexity >= $threshold ${scopeFilter}
      RETURN f.name as name, 
             f.filePath as file, 
             f.complexity as complexity,
             coalesce(f.cognitive, 0) as cognitive,
             coalesce(f.nestingDepth, 0) as nesting,
             coalesce(f.endLine - f.startLine + 1, 0) as lines
      ORDER BY f.complexity DESC
      LIMIT 50
    `;

    type HotspotRow = {
      name: string;
      file: string;
      complexity: number;
      cognitive: number;
      nesting: number;
      lines: number;
    };

    const result = await client.roQuery<HotspotRow>(
      query,
      { params: { threshold, scope } }
    );

    // Get total function count for summary
    const countQuery = scope
      ? 'MATCH (f:Function) WHERE f.filePath STARTS WITH $scope RETURN count(f) as total, max(f.complexity) as maxC, avg(f.complexity) as avgC'
      : 'MATCH (f:Function) RETURN count(f) as total, max(f.complexity) as maxC, avg(f.complexity) as avgC';

    const countResult = await client.roQuery<{ total: number; maxC: number; avgC: number }>(
      countQuery,
      scope ? { params: { scope } } : undefined
    );

    const hotspots: ComplexityHotspot[] = result.data.map(row => ({
      name: row.name ?? 'unknown',
      file: row.file ?? '',
      complexity: row.complexity ?? 0,
      cognitive: row.cognitive ?? 0,
      nesting: row.nesting ?? 0,
      lines: row.lines ?? 0,
    }));

    return {
      hotspots,
      summary: {
        totalFunctions: countResult.data[0]?.total ?? 0,
        overThreshold: hotspots.length,
        maxComplexity: countResult.data[0]?.maxC ?? 0,
        avgComplexity: Math.round((countResult.data[0]?.avgC ?? 0) * 10) / 10,
      },
    };
  } catch (error) {
    return {
      hotspots: [],
      summary: {
        totalFunctions: 0,
        overThreshold: 0,
        maxComplexity: 0,
        avgComplexity: 0,
      },
      error: error instanceof Error ? error.message : 'Unknown error generating complexity report',
    };
  }
}
