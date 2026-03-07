/**
 * MCP Tool: get_repo_map
 *
 * Get a ranked map of important symbols for LLM context.
 * Queries the graph for high-connectivity and high-complexity symbols,
 * then formats them as a condensed codebase overview.
 */

import { z } from 'zod';
import { getGraphClient } from '@codegraph/core';
import type { ToolDefinition } from './consolidated';

// Input schema
export const RepoMapInputSchema = z.object({
  maxTokens: z.number().default(2048).describe('Maximum tokens for the map'),
  focusFiles: z.array(z.string()).optional().describe('Files to prioritize'),
  focusSymbols: z.array(z.string()).optional().describe('Symbols to prioritize'),
});

export type RepoMapInput = z.infer<typeof RepoMapInputSchema>;

// Output type
export interface RepoMapOutput {
  map: string;
  filesIncluded: number;
  symbolsIncluded: number;
  error?: string;
}

// Tool definition for MCP
export const repoMapToolDefinition: ToolDefinition = {
  name: 'get_repo_map',
  description: 'Get a ranked map of important symbols for LLM context. Returns a condensed view of the codebase showing the most important files and symbols.',
  inputSchema: {
    type: 'object',
    properties: {
      maxTokens: {
        type: 'number',
        default: 2048,
        description: 'Maximum tokens for the map',
      },
      focusFiles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files to prioritize in the map',
      },
      focusSymbols: {
        type: 'array',
        items: { type: 'string' },
        description: 'Symbols to prioritize in the map',
      },
    },
    required: [],
  },
};

// Rough token estimate: ~4 chars per token
const CHARS_PER_TOKEN = 4;

interface RankedFile {
  path: string;
  symbols: Array<{
    name: string;
    kind: string;
    connections: number;
    complexity: number;
    line: number;
  }>;
  totalConnections: number;
}

/**
 * Handler for get_repo_map tool
 *
 * Generates a ranked summary of the codebase focused on:
 * - High connectivity symbols (many callers/callees)
 * - High complexity functions
 * - User-specified focus areas
 */
export async function getRepoMap(input: RepoMapInput): Promise<RepoMapOutput> {
  try {
    const client = await getGraphClient();
    const maxChars = (input.maxTokens ?? 2048) * CHARS_PER_TOKEN;

    // Step 1: Get most connected symbols (ranked by incoming + outgoing edges)
    // Note: avoid accessing properties that may not exist on all node types (e.g. signature)
    const connectedQuery = `
      MATCH (n)-[r]-()
      WHERE n.name IS NOT NULL AND n.filePath IS NOT NULL
      RETURN n.name as name, n.filePath as file,
             labels(n)[0] as kind,
             count(r) as connections,
             coalesce(n.complexity, 0) as complexity,
             coalesce(n.startLine, n.line, 0) as line
      ORDER BY connections DESC
      LIMIT 100
    `;

    type SymbolRow = {
      name: string;
      file: string;
      kind: string;
      connections: number;
      complexity: number;
      line: number;
    };

    const result = await client.roQuery<SymbolRow>(connectedQuery);

    // Step 2: Boost focus files/symbols
    const focusFileSet = new Set(input.focusFiles ?? []);
    const focusSymbolSet = new Set(input.focusSymbols ?? []);

    const scored = result.data.map(row => {
      let score = (row.connections ?? 0) + (row.complexity ?? 0);
      if (focusFileSet.has(row.file)) score += 100;
      if (focusSymbolSet.has(row.name)) score += 100;
      // Partial match on focus files
      for (const f of focusFileSet) {
        if (row.file?.includes(f)) score += 50;
      }
      return { ...row, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // Step 3: Group by file
    const fileMap = new Map<string, RankedFile>();

    for (const row of scored) {
      const filePath = row.file ?? '';
      if (!filePath) continue;

      if (!fileMap.has(filePath)) {
        fileMap.set(filePath, {
          path: filePath,
          symbols: [],
          totalConnections: 0,
        });
      }
      const file = fileMap.get(filePath)!;
      file.symbols.push({
        name: row.name ?? 'unknown',
        kind: (row.kind ?? 'unknown').toLowerCase(),
        connections: row.connections ?? 0,
        complexity: row.complexity ?? 0,
        line: row.line ?? 0,
      });
      file.totalConnections += row.connections ?? 0;
    }

    // Step 4: Sort files by total importance
    const rankedFiles = [...fileMap.values()].sort(
      (a, b) => b.totalConnections - a.totalConnections
    );

    // Step 5: Format into condensed map, respecting token budget
    let output = '# Repository Map\n\n';
    let charsUsed = output.length;
    let filesIncluded = 0;
    let symbolsIncluded = 0;

    for (const file of rankedFiles) {
      // Format file header
      const shortPath = file.path.split('/').slice(-3).join('/');
      let fileSection = `## ${shortPath}\n`;

      // Sort symbols within file by line number
      file.symbols.sort((a, b) => a.line - b.line);

      for (const sym of file.symbols) {
        const kindTag = sym.kind.charAt(0).toUpperCase();
        const metrics = sym.complexity > 0
          ? ` [cx:${sym.complexity}, conn:${sym.connections}]`
          : sym.connections > 1
            ? ` [conn:${sym.connections}]`
            : '';
        const line = `  ${kindTag} ${sym.name}${metrics} L${sym.line}\n`;
        fileSection += line;
      }
      fileSection += '\n';

      // Check if we'd exceed budget
      if (charsUsed + fileSection.length > maxChars && filesIncluded > 0) {
        output += `\n... (${rankedFiles.length - filesIncluded} more files)\n`;
        break;
      }

      output += fileSection;
      charsUsed += fileSection.length;
      filesIncluded++;
      symbolsIncluded += file.symbols.length;
    }

    if (filesIncluded === 0) {
      return {
        map: '(No symbols found in graph. Index a project first with configure_projects.)',
        filesIncluded: 0,
        symbolsIncluded: 0,
      };
    }

    return {
      map: output,
      filesIncluded,
      symbolsIncluded,
    };
  } catch (error) {
    return {
      map: '',
      filesIncluded: 0,
      symbolsIncluded: 0,
      error: error instanceof Error ? error.message : 'Unknown error generating repo map',
    };
  }
}
