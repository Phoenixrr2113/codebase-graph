/**
 * MCP Tool: explain_code
 *
 * Get code with context: dependencies, dependents, tests, complexity.
 * Queries graph for relationships and reads source file.
 */

import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { getGraphClient } from '../graphClient.js';

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
  complexity?: number | undefined;
  recentChanges?: string[] | undefined;
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

    const client = await getGraphClient();

    // Query for imports (dependencies)
    const importsQuery = `
      MATCH (f:File {path: $filePath})-[:CONTAINS]->(s)-[:IMPORTS]->(target)
      RETURN DISTINCT target.name as name, target.filePath as file, 1 as line, 'import' as type
      LIMIT 20
    `;

    // Query for callers (dependents)
    const callersQuery = `
      MATCH (f:File {path: $filePath})-[:CONTAINS]->(fn:Function)<-[:CALLS]-(caller:Function)
      RETURN DISTINCT caller.name as name, caller.filePath as file, caller.startLine as line, 'call' as type
      LIMIT 20
    `;

    // Query for related tests
    const testsQuery = `
      MATCH (f:File {path: $filePath})-[:CONTAINS]->(fn:Function)<-[:CALLS*]-(test:Function)
      WHERE test.filePath CONTAINS '.test.' OR test.filePath CONTAINS '.spec.'
      RETURN DISTINCT test.filePath as file
      LIMIT 10
    `;

    // Query for average complexity of functions in this file
    const complexityQuery = `
      MATCH (f:File {path: $filePath})-[:CONTAINS]->(fn:Function)
      RETURN avg(fn.complexity) as avgComplexity
    `;

    type DepRow = { name: string; file: string; line: number; type: string };
    type TestRow = { file: string };
    type ComplexityRow = { avgComplexity: number };

    const [importsResult, callersResult, testsResult, complexityResult] = await Promise.all([
      client.roQuery<DepRow>(importsQuery, { params: { filePath: input.file } }),
      client.roQuery<DepRow>(callersQuery, { params: { filePath: input.file } }),
      client.roQuery<TestRow>(testsQuery, { params: { filePath: input.file } }),
      client.roQuery<ComplexityRow>(complexityQuery, { params: { filePath: input.file } }),
    ]);

    const dependencies: DependencyInfo[] = importsResult.data.map(row => ({
      name: row.name ?? 'unknown',
      file: row.file ?? '',
      line: row.line ?? 0,
      type: row.type as 'import' | 'call' | 'extends' | 'implements',
    }));

    const dependents: DependencyInfo[] = callersResult.data.map(row => ({
      name: row.name ?? 'unknown',
      file: row.file ?? '',
      line: row.line ?? 0,
      type: row.type as 'import' | 'call' | 'extends' | 'implements',
    }));

    const relatedTests: string[] = testsResult.data.map(row => row.file).filter(Boolean);
    const complexity = complexityResult.data[0]?.avgComplexity;

    return {
      code,
      dependencies,
      dependents,
      relatedTests,
      complexity: complexity ? Math.round(complexity * 10) / 10 : undefined,
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
