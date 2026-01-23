/**
 * MCP Tool: get_symbol_history
 *
 * Get git commit history for a specific symbol.
 * Queries graph for Commit nodes connected via temporal edges.
 */

import { z } from 'zod';
import { getGraphClient } from '../graphClient.js';

// Input schema
export const SymbolHistoryInputSchema = z.object({
  symbol: z.string().describe('Symbol name to get history for'),
  file: z.string().optional().describe('File path to disambiguate symbol'),
  limit: z.number().default(20).describe('Maximum number of commits to return'),
});

export type SymbolHistoryInput = z.infer<typeof SymbolHistoryInputSchema>;

// Change info type
export interface ChangeInfo {
  date: string;
  author: string;
  message: string;
  commitHash: string;
  linesAdded?: number | undefined;
  linesRemoved?: number | undefined;
}

// Output type
export interface SymbolHistoryOutput {
  symbol: string;
  file?: string | undefined;
  changes: ChangeInfo[];
  authors: string[];
  ageDays: number;
  changeFrequency: number;
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
export const symbolHistoryToolDefinition: ToolDefinition = {
  name: 'get_symbol_history',
  description: 'Get git commit history for a specific symbol.',
  inputSchema: {
    type: 'object',
    properties: {
      symbol: {
        type: 'string',
        description: 'Symbol name to get history for (required)',
      },
      file: {
        type: 'string',
        description: 'File path to disambiguate symbol (optional)',
      },
      limit: {
        type: 'number',
        default: 20,
        description: 'Maximum number of commits to return',
      },
    },
    required: ['symbol'],
  },
};

/**
 * Handler for get_symbol_history tool
 */
export async function getSymbolHistory(input: SymbolHistoryInput): Promise<SymbolHistoryOutput> {
  try {
    if (!input.symbol || input.symbol.trim() === '') {
      return {
        symbol: '',
        changes: [],
        authors: [],
        ageDays: 0,
        changeFrequency: 0,
        error: 'Symbol name is required',
      };
    }

    const client = await getGraphClient();
    const limit = input.limit ?? 20;

    // First find the symbol's file
    let filePath: string | undefined = input.file;

    if (!filePath) {
      const symbolQuery = `
        MATCH (n)
        WHERE (n:Function OR n:Class OR n:Interface OR n:Variable)
          AND n.name = $symbol
        RETURN n.filePath as file
        LIMIT 1
      `;
      const symbolResult = await client.roQuery<{ file: string }>(
        symbolQuery,
        { params: { symbol: input.symbol } }
      );
      filePath = symbolResult.data[0]?.file;
    }

    if (!filePath) {
      return {
        symbol: input.symbol,
        changes: [],
        authors: [],
        ageDays: 0,
        changeFrequency: 0,
        error: `Symbol "${input.symbol}" not found in graph`,
      };
    }

    // Query commits that modified the file containing this symbol
    const historyQuery = `
      MATCH (f:File {path: $filePath})-[r:MODIFIED_IN]->(c:Commit)
      RETURN c.hash as commitHash,
             c.message as message,
             c.author as author,
             c.date as date,
             r.linesAdded as linesAdded,
             r.linesRemoved as linesRemoved
      ORDER BY c.date DESC
      LIMIT $limit
    `;

    type HistoryRow = {
      commitHash: string;
      message: string;
      author: string;
      date: string;
      linesAdded?: number;
      linesRemoved?: number;
    };

    const result = await client.roQuery<HistoryRow>(
      historyQuery,
      { params: { filePath, limit } }
    );

    const changes: ChangeInfo[] = result.data.map(row => ({
      date: row.date ?? '',
      author: row.author ?? 'unknown',
      message: row.message ?? '',
      commitHash: row.commitHash ?? '',
      linesAdded: row.linesAdded,
      linesRemoved: row.linesRemoved,
    }));

    // Calculate unique authors
    const authors = [...new Set(changes.map(c => c.author))];

    // Calculate age in days (from oldest commit to now)
    let ageDays = 0;
    if (changes.length > 0) {
      const oldestDate = changes[changes.length - 1]?.date;
      if (oldestDate) {
        const date = new Date(oldestDate);
        ageDays = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
      }
    }

    // Calculate change frequency (commits per month)
    const changeFrequency = ageDays > 0 ? Math.round((changes.length / ageDays) * 30 * 10) / 10 : 0;

    return {
      symbol: input.symbol,
      file: filePath,
      changes,
      authors,
      ageDays,
      changeFrequency,
    };
  } catch (error) {
    return {
      symbol: input.symbol,
      changes: [],
      authors: [],
      ageDays: 0,
      changeFrequency: 0,
      error: error instanceof Error ? error.message : 'Unknown error getting symbol history',
    };
  }
}
