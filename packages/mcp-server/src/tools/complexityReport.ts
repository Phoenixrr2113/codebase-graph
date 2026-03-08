/**
 * MCP Tool: get_complexity_report
 *
 * Generate a complexity report showing complex code hotspots.
 * Queries graph for Function nodes with high complexity.
 */

import { codeGraphService } from '@codegraph/core';
import type { ToolDefinition } from './consolidated';

// Input schema
export interface ComplexityReportInput {
  scope?: string;
  threshold?: number;
  sortBy?: 'complexity' | 'cognitive' | 'nesting';
}

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
    const hotspotOpts: { threshold?: number; scope?: string; sortBy?: 'complexity' | 'cognitive' | 'nesting' } = {};
    if (input.threshold != null) hotspotOpts.threshold = input.threshold;
    if (input.scope != null) hotspotOpts.scope = input.scope;
    if (input.sortBy != null) hotspotOpts.sortBy = input.sortBy;
    const result = await codeGraphService.getComplexityHotspots(hotspotOpts);

    return { hotspots: result.hotspots, summary: result.summary };
  } catch (error) {
    return {
      hotspots: [],
      summary: { totalFunctions: 0, overThreshold: 0, maxComplexity: 0, avgComplexity: 0 },
      error: error instanceof Error ? error.message : 'Unknown error generating complexity report',
    };
  }
}
