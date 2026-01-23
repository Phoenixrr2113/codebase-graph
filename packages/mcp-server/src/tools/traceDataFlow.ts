/**
 * MCP Tool: trace_data_flow
 *
 * Track how data flows from source to sink.
 * Uses @codegraph/parser dataflow analysis with tree-sitter.
 */

import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import {
  initParser,
  parseCode,
  analyzeDataflow,
  type DataflowAnalysisResult,
} from '@codegraph/parser';

// Input schema
export const TraceDataFlowInputSchema = z.object({
  source: z.string().describe('Starting point (e.g. request.body)'),
  sink: z.string().optional().describe('Ending point (optional)'),
  file: z.string().optional().describe('File to analyze'),
});

export type TraceDataFlowInput = z.infer<typeof TraceDataFlowInputSchema>;

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

    // Read file content
    let code: string;
    try {
      code = await readFile(input.file, 'utf-8');
    } catch (err) {
      return {
        paths: [],
        vulnerabilities: [],
        sanitizersFound: [],
        error: `Failed to read file: ${err instanceof Error ? err.message : 'Unknown error'}`,
      };
    }

    // Initialize parser
    await initParser();

    // Parse the file
    const ext = input.file.split('.').pop() ?? 'ts';
    const langMap: Record<string, 'typescript' | 'javascript' | 'tsx' | 'jsx'> = {
      ts: 'typescript',
      tsx: 'tsx',
      js: 'javascript',
      jsx: 'jsx',
    };
    const language = langMap[ext] ?? 'typescript';
    const tree = parseCode(code, language);

    // Run dataflow analysis
    const result: DataflowAnalysisResult = analyzeDataflow(
      tree.rootNode,
      input.file,
      { maxDepth: 10, includeSteps: true }
    );

    // Filter sources matching the input
    const matchingSources = result.sources.filter(
      s => s.pattern.includes(input.source) || s.taintedVariable.includes(input.source)
    );

    // Filter sinks if specified (for future use)
    // const matchingSinks = input.sink
    //   ? result.sinks.filter(s => s.pattern.includes(input.sink!))
    //   : result.sinks;

    // Build paths from matching sources
    const paths: DataFlowPath[] = result.paths
      .filter(p => matchingSources.some(s => s.taintedVariable === p.source.taintedVariable))
      .map(p => ({
        source: `${p.source.pattern} (${p.source.taintedVariable})`,
        transformations: p.steps.map(s => `${s.name} [${s.transformation}]`),
        sink: p.sink ? `${p.sink.pattern} (${p.sink.category})` : 'unknown',
      }));

    // Get vulnerabilities as strings
    const vulnerabilities = result.vulnerabilities.map(
      v => `${v.category} [${v.severity}]: ${v.source.pattern} → ${v.sink.pattern}`
    );

    // Get sanitizers from paths
    const sanitizersFound = [...new Set(result.paths.flatMap(p => p.sanitizers))];

    return {
      paths,
      vulnerabilities,
      sanitizersFound,
      summary: `Found ${result.sources.length} sources, ${result.sinks.length} sinks, ${result.vulnerabilities.length} potential vulnerabilities`,
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
