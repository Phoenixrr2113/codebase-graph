/**
 * MCP Tool: analyze_file_for_refactoring
 *
 * Analyze a file for refactoring opportunities.
 * Uses @codegraph/parser refactoring analysis module.
 */

import { z } from 'zod';
import { getGraphClient } from '../graphClient';
import {
  analyzeRefactoring,
  getExtractionCandidatesQuery,
  getInternalCallsQuery,
  getRefactoringSummary,
  type RefactoringAnalysisInput,
} from '@codegraph/parser';

// Input schema
export const AnalyzeRefactoringInputSchema = z.object({
  file: z.string().describe('File path to analyze'),
  threshold: z.number().default(3).describe('Coupling score threshold for extraction'),
});

export type AnalyzeRefactoringInput = z.infer<typeof AnalyzeRefactoringInputSchema>;

// Extraction candidate type
export interface ExtractionCandidate {
  name: string;
  couplingScore: number;
  internalCalls: number;
  stateReads: number;
  startLine: number;
  endLine: number;
}

// Responsibility type
export interface DetectedResponsibility {
  name: string;
  functions: string[];
  extractionOrder: number;
}

// Output type
export interface AnalyzeRefactoringOutput {
  file: string;
  totalFunctions: number;
  extractionCandidates: ExtractionCandidate[];
  responsibilities: DetectedResponsibility[];
  averageCouplingScore: number;
  couplingLevel: 'low' | 'medium' | 'high';
  summary: string;
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
export const analyzeRefactoringToolDefinition: ToolDefinition = {
  name: 'analyze_file_for_refactoring',
  description: 'Analyze a file for refactoring opportunities, identifying extraction candidates and responsibilities.',
  inputSchema: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'File path to analyze (required)',
      },
      threshold: {
        type: 'number',
        default: 3,
        description: 'Coupling score threshold for extraction candidates',
      },
    },
    required: ['file'],
  },
};

/**
 * Handler for analyze_file_for_refactoring tool
 */
export async function analyzeFileForRefactoring(input: AnalyzeRefactoringInput): Promise<AnalyzeRefactoringOutput> {
  try {
    if (!input.file || input.file.trim() === '') {
      return {
        file: '',
        totalFunctions: 0,
        extractionCandidates: [],
        responsibilities: [],
        averageCouplingScore: 0,
        couplingLevel: 'low',
        summary: '',
        error: 'File path is required',
      };
    }

    const client = await getGraphClient();
    const threshold = input.threshold ?? 3;

    // Query graph for function coupling data
    const candidatesQuery = getExtractionCandidatesQuery(input.file);
    const callsQuery = getInternalCallsQuery(input.file);

    type FunctionRow = {
      name: string;
      startLine: number;
      endLine: number;
      internalCalls: number;
      stateReads: number;
    };

    type CallRow = {
      caller: string;
      callee: string;
    };

    const [functionsResult, callsResult] = await Promise.all([
      client.roQuery<FunctionRow>(candidatesQuery),
      client.roQuery<CallRow>(callsQuery),
    ]);

    // Build input for analysis
    const analysisInput: RefactoringAnalysisInput = {
      file: input.file,
      functions: functionsResult.data.map(f => ({
        name: f.name ?? 'unknown',
        startLine: f.startLine ?? 0,
        endLine: f.endLine ?? 0,
        internalCalls: f.internalCalls ?? 0,
        stateReads: f.stateReads ?? 0,
      })),
      callRelationships: callsResult.data.map(c => ({
        caller: c.caller ?? '',
        callee: c.callee ?? '',
      })),
    };

    // Run analysis
    const result = analyzeRefactoring(analysisInput, {
      extractionThreshold: threshold,
      detectResponsibilities: true,
    });

    // Map results to output format
    const extractionCandidates: ExtractionCandidate[] = result.extractionCandidates.map(c => ({
      name: c.name,
      couplingScore: c.couplingScore,
      internalCalls: c.internalCalls,
      stateReads: c.stateReads,
      startLine: c.startLine,
      endLine: c.endLine,
    }));

    const responsibilities: DetectedResponsibility[] = result.responsibilities.map(r => ({
      name: r.name,
      functions: r.functions,
      extractionOrder: r.extractionOrder,
    }));

    return {
      file: input.file,
      totalFunctions: result.totalFunctions,
      extractionCandidates,
      responsibilities,
      averageCouplingScore: Math.round(result.averageCouplingScore * 10) / 10,
      couplingLevel: result.couplingLevel,
      summary: getRefactoringSummary(result),
    };
  } catch (error) {
    return {
      file: input.file,
      totalFunctions: 0,
      extractionCandidates: [],
      responsibilities: [],
      averageCouplingScore: 0,
      couplingLevel: 'low',
      summary: '',
      error: error instanceof Error ? error.message : 'Unknown error analyzing file for refactoring',
    };
  }
}
