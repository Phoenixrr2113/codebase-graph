/**
 * MCP Tool: explain_code
 *
 * Get code with context: dependencies, dependents, tests, complexity.
 * Queries graph for relationships and reads source file.
 */

import { resolve } from 'node:path';
import { codeGraphService, readSourceFile } from '@codegraph/core';
import type { ToolDefinition } from './consolidated';

// Input schema
export interface ExplainCodeInput {
  file: string;
  start_line?: number;
  end_line?: number;
}

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
  complexity?: number | undefined;
  recentChanges?: string[] | undefined;
  error?: string | undefined;
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
      return { code: '', dependencies: [], dependents: [], relatedTests: [], error: 'File path is required' };
    }

    const filePath = resolve(input.file);

    // Read the file content using readSourceFile (validates against path traversal)
    let code: string;
    try {
      const result = await readSourceFile(filePath, {
        startLine: input.start_line,
        endLine: input.end_line,
      });
      code = result.content;
    } catch (err) {
      return {
        code: '', dependencies: [], dependents: [], relatedTests: [],
        error: `Failed to read file: ${err instanceof Error ? err.message : 'Unknown error'}`,
      };
    }

    // Delegate graph queries to service
    const result = await codeGraphService.getCodeExplanation(filePath);

    return {
      code,
      dependencies: result.dependencies,
      dependents: result.dependents,
      relatedTests: result.relatedTests,
      complexity: result.complexity,
    };
  } catch (error) {
    return {
      code: '', dependencies: [], dependents: [], relatedTests: [],
      error: error instanceof Error ? error.message : 'Unknown error explaining code',
    };
  }
}
