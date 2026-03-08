/**
 * MCP Tool: analyze_file_for_refactoring
 *
 * Analyze a file for refactoring opportunities.
 * Uses @codegraph/core refactoring analysis module.
 */

import { codeGraphService } from '@codegraph/core';
import type { ToolDefinition } from './consolidated';

// Input schema
export interface AnalyzeRefactoringInput {
  file: string;
  threshold?: number;
}

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
        file: '', totalFunctions: 0, extractionCandidates: [], responsibilities: [],
        averageCouplingScore: 0, couplingLevel: 'low', summary: '', error: 'File path is required',
      };
    }

    const refactoringOpts: { threshold?: number } = {};
    if (input.threshold != null) refactoringOpts.threshold = input.threshold;
    const result = await codeGraphService.analyzeRefactoring(input.file, refactoringOpts);

    return {
      file: result.file,
      totalFunctions: result.totalFunctions,
      extractionCandidates: result.extractionCandidates,
      responsibilities: result.responsibilities,
      averageCouplingScore: result.averageCouplingScore,
      couplingLevel: result.couplingLevel,
      summary: result.summary,
    };
  } catch (error) {
    return {
      file: input.file, totalFunctions: 0, extractionCandidates: [], responsibilities: [],
      averageCouplingScore: 0, couplingLevel: 'low', summary: '',
      error: error instanceof Error ? error.message : 'Unknown error analyzing file for refactoring',
    };
  }
}
