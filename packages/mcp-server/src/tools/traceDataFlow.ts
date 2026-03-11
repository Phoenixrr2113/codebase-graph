/**
 * MCP Tool: trace_data_flow
 *
 * Track how data flows from source to sink.
 * Delegates to codeGraphService.analyzeDataflowForFile() for business logic.
 */

import { codeGraphService } from '@codegraph/core';
import type { ToolDefinition } from './consolidated';

// Input schema
export interface TraceDataFlowInput {
  source: string;
  sink?: string;
  file?: string;
}

// Data flow path type
export interface DataFlowPath {
  source: string;
  transformations: string[];
  sink: string;
}

// Output type
export interface TraceDataFlowOutput {
  paths: DataFlowPath[];
  vulnerabilities: string[];
  sanitizersFound: string[];
  summary?: string | undefined;
  error?: string | undefined;
}

// Tool definition for MCP
export const traceDataFlowToolDefinition: ToolDefinition = {
  name: 'trace_data_flow',
  description: 'Track how data flows from source to sink.',
  inputSchema: {
    type: 'object',
    properties: {
      source: {
        type: 'string',
        description: 'Starting point (e.g. request.body) (required)',
      },
      sink: {
        type: 'string',
        description: 'Ending point (optional)',
      },
      file: {
        type: 'string',
        description: 'File to analyze (optional)',
      },
    },
    required: ['source'],
  },
};

/**
 * Handler for trace_data_flow tool
 */
export async function traceDataFlow(input: TraceDataFlowInput): Promise<TraceDataFlowOutput> {
  try {
    if (!input.source || input.source.trim() === '') {
      return {
        paths: [],
        vulnerabilities: [],
        sanitizersFound: [],
        error: 'Source is required',
      };
    }

    if (!input.file) {
      return {
        paths: [],
        vulnerabilities: [],
        sanitizersFound: [],
        error: 'File path is required for dataflow analysis',
      };
    }

    // Delegate to service layer
    const result = await codeGraphService.analyzeDataflowForFile(input.file, input.source);

    // Map service result to MCP output format
    const paths: DataFlowPath[] = result.paths;

    const vulnerabilities = result.vulnerabilities.map(
      v => `${v.category} [${v.severity}]: ${v.source} → ${v.sink}`,
    );

    // Sanitizers are not tracked in the simplified service result
    const sanitizersFound: string[] = [];

    return {
      paths,
      vulnerabilities,
      sanitizersFound,
      summary: result.summary,
    };
  } catch (error) {
    return {
      paths: [],
      vulnerabilities: [],
      sanitizersFound: [],
      error: error instanceof Error ? error.message : 'Unknown error tracing data flow',
    };
  }
}
