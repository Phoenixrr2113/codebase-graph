/**
 * MCP Tool: trigger_reindex
 *
 * Triggers a reindex of the codebase, either incrementally or full.
 */

import { z } from 'zod';
import { stat } from 'node:fs/promises';

// Input schema
export const ReindexInputSchema = z.object({
  mode: z.enum(['incremental', 'full']).default('incremental'),
  scope: z.string().optional().describe('Specific file or directory path to reindex'),
});

export type ReindexInput = z.infer<typeof ReindexInputSchema>;

// Output type
export interface ReindexOutput {
  success: boolean;
  filesProcessed: number;
  symbolsUpdated: number;
  duration: number;
  errors: string[];
}

// Internal ToolDefinition type to avoid SDK type issues
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
export const reindexToolDefinition: ToolDefinition = {
  name: 'trigger_reindex',
  description: 'Trigger a reindex of the codebase. Supports incremental (changed files only) or full mode.',
  inputSchema: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['incremental', 'full'],
        default: 'incremental',
        description: 'Reindex mode: incremental (default) processes only changed files, full reprocesses everything',
      },
      scope: {
        type: 'string',
        description: 'Specific file or directory path to reindex (optional)',
      },
    },
    required: [],
  },
};

/**
 * Handler for trigger_reindex tool
 * 
 * In the full implementation, this calls parseProject/parseSingleFile from @codegraph/api.
 * The actual integration will be completed when MCP server connects to the API via HTTP or IPC.
 */
export async function triggerReindex(input: ReindexInput): Promise<ReindexOutput> {
  const startTime = Date.now();
  const errors: string[] = [];

  try {
    // If scope is provided, determine if it's a file or directory
    if (input.scope) {
      const scopeStat = await stat(input.scope);
      const duration = Date.now() - startTime;

      if (scopeStat.isFile()) {
        // TODO: In full implementation, call parseSingleFile via API
        return {
          success: true,
          filesProcessed: 1,
          symbolsUpdated: 0,
          duration,
          errors: ['Reindex functionality requires API integration (coming in MCP-INT-001)'],
        };
      } else if (scopeStat.isDirectory()) {
        // TODO: In full implementation, call parseProject via API
        return {
          success: true,
          filesProcessed: 0,
          symbolsUpdated: 0,
          duration,
          errors: ['Reindex functionality requires API integration (coming in MCP-INT-001)'],
        };
      } else {
        errors.push(`Scope path is neither a file nor directory: ${input.scope}`);
        return {
          success: false,
          filesProcessed: 0,
          symbolsUpdated: 0,
          duration,
          errors,
        };
      }
    } else {
      // No scope provided
      errors.push('No scope provided. Please specify a file or directory path to reindex.');
      return {
        success: false,
        filesProcessed: 0,
        symbolsUpdated: 0,
        duration: Date.now() - startTime,
        errors,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error during reindex';
    errors.push(errorMessage);

    return {
      success: false,
      filesProcessed: 0,
      symbolsUpdated: 0,
      duration: Date.now() - startTime,
      errors,
    };
  }
}
