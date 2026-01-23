/**
 * MCP Tool: explain_code
 *
 * Get code with context: dependencies, dependents, tests, complexity.
 */

import { z } from 'zod';
import { readFile } from 'node:fs/promises';

// Input schema
export const ExplainCodeInputSchema = z.object({
  file: z.string().describe('File path to explain'),
  start_line: z.number().optional().describe('Starting line number'),
  end_line: z.number().optional().describe('Ending line number'),
});

export type ExplainCodeInput = z.infer<typeof ExplainCodeInputSchema>;

// Dependency info
export interface DependencyInfo {
  name: string;
  file: string;
  line: number;
  type: 'import' | 'call' | 'extends' | 'implements';
}

// Output type
export interface ExplainCodeOutput {
  code: string;
  dependencies: DependencyInfo[];
  dependents: DependencyInfo[];
  relatedTests: string[];
  complexity?: number;
  recentChanges?: string[];
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
export const explainCodeToolDefinition: ToolDefinition = {
  name: 'explain_code',
  description: 'Get code with context: dependencies, dependents, related tests, and complexity metrics.',
  inputSchema: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'File path to explain (required)',
      },
      start_line: {
        type: 'number',
        description: 'Starting line number (optional, defaults to beginning)',
      },
      end_line: {
        type: 'number',
        description: 'Ending line number (optional, defaults to end of file)',
      },
    },
    required: ['file'],
  },
};

/**
 * Handler for explain_code tool
 */
export async function explainCode(input: ExplainCodeInput): Promise<ExplainCodeOutput> {
  try {
    if (!input.file || input.file.trim() === '') {
      return {
        code: '',
        dependencies: [],
        dependents: [],
        relatedTests: [],
        error: 'File path is required',
      };
    }

    // Read the file content
    let code: string;
    try {
      code = await readFile(input.file, 'utf-8');
    } catch (err) {
      return {
        code: '',
        dependencies: [],
        dependents: [],
        relatedTests: [],
        error: `Failed to read file: ${err instanceof Error ? err.message : 'Unknown error'}`,
      };
    }

    // Apply line range if specified
    if (input.start_line !== undefined || input.end_line !== undefined) {
      const lines = code.split('\n');
      const start = (input.start_line ?? 1) - 1; // Convert to 0-indexed
      const end = input.end_line ?? lines.length;
      code = lines.slice(start, end).join('\n');
    }

    // TODO: Query graph for dependencies, dependents, tests, complexity
    // This requires API integration (MCP-INT-001)
    
    return {
      code,
      dependencies: [],
      dependents: [],
      relatedTests: [],
      error: 'Dependency/dependent analysis requires API integration (coming in MCP-INT-001)',
    };
  } catch (error) {
    return {
      code: '',
      dependencies: [],
      dependents: [],
      relatedTests: [],
      error: error instanceof Error ? error.message : 'Unknown error explaining code',
    };
  }
}
