/**
 * Index Persona — Project configuration, indexing, status, and source access
 *
 * Consolidates: configure_projects, trigger_reindex, get_stats, get_source, ping
 */

import type { ToolDefinition } from '../tools/router';
import { configureProjects, type ConfigureProjectsInput } from '../tools/configureProjects';
import { triggerReindex, type ReindexInput } from '../tools/reindex';
import { codeGraphService, readSourceFile, getGraphClient } from '@codegraph/core';
import { validateFilePath } from './validation';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'MCP:Persona:Index' });

export const indexPersonaDefinition: ToolDefinition = {
  name: 'codebase',
  description: `Manage the codebase index — configure projects, trigger indexing, check status, read source.

**Actions:**
- **configure**: View and manage active codebases. First-time setup.
  Params: projectAction (list|set|add|remove|status), projects (string[], auto-detected if omitted)
- **reindex**: Re-index codebase (incremental or full).
  Params: mode (incremental|full), scope (optional file/directory path)
- **status**: Get current indexing status (file/function/class counts, last indexed).
  Params: repo (optional repository path)
- **stats**: Get graph-wide statistics (node/edge counts, largest files, most connected).
  Params: none
- **source**: Read source code from a file with optional line range.
  Params: path (required), startLine, endLine
- **ping**: Test connectivity.
  Params: none

**Examples:**
- Check status: { action: "status" }
- Configure projects: { action: "configure", projectAction: "status" }
- Re-index: { action: "reindex", mode: "incremental" }
- Read source: { action: "source", path: "/path/to/file.ts", startLine: 1, endLine: 50 }`,
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['configure', 'reindex', 'status', 'stats', 'source', 'ping'],
        description: 'Index operation to perform',
      },
      // configure params
      projectAction: {
        type: 'string',
        enum: ['list', 'set', 'add', 'remove', 'status'],
        description: 'Project action (for configure)',
      },
      projects: {
        type: 'array',
        items: { type: 'string' },
        description: 'Project paths (for configure set/add/remove)',
      },
      // reindex params
      mode: {
        type: 'string',
        enum: ['incremental', 'full'],
        description: 'Reindex mode (default: incremental)',
      },
      scope: {
        type: 'string',
        description: 'File/directory path to scope reindex',
      },
      // status params
      repo: {
        type: 'string',
        description: 'Repository path for status',
      },
      // source params
      path: {
        type: 'string',
        description: 'Absolute file path to read',
      },
      startLine: {
        type: 'number',
        description: 'Starting line number (1-indexed)',
      },
      endLine: {
        type: 'number',
        description: 'Ending line number',
      },
    },
    required: ['action'],
  },
};

export async function handleIndex(args: Record<string, unknown>): Promise<unknown> {
  const action = args.action as string;
  const start = Date.now();

  let result: unknown;
  let toolUsed: string;

  switch (action) {
    case 'ping': {
      result = {
        status: 'ok',
        message: 'CodeGraph MCP Server is running',
        timestamp: new Date().toISOString(),
      };
      toolUsed = 'ping';
      break;
    }

    case 'configure': {
      const input: ConfigureProjectsInput = {
        action: (args.projectAction as ConfigureProjectsInput['action']) || 'status',
      };
      if (args.projects) input.projects = args.projects as string[];
      result = await configureProjects(input);
      toolUsed = 'configure_projects';
      break;
    }

    case 'reindex': {
      const input: ReindexInput = {
        mode: (args.mode as 'incremental' | 'full') || 'incremental',
      };
      if (args.scope) input.scope = args.scope as string;
      result = await triggerReindex(input);
      toolUsed = 'trigger_reindex';
      break;
    }

    case 'status': {
      try {
        const stats = await codeGraphService.getGraphStats();
        // Query embedding coverage per node type
        let embeddingCoverage: Record<string, number> = {};
        try {
          const client = await getGraphClient();
          const embResult = await client.roQuery<{ label: string; count: number }>(
            `MATCH (n) WHERE n.embedding IS NOT NULL
             WITH labels(n)[0] AS label, count(*) AS count
             RETURN label, count ORDER BY count DESC`
          );
          for (const row of embResult.data ?? []) {
            embeddingCoverage[row.label] = row.count;
          }
        } catch { /* non-fatal */ }
        result = {
          totalNodes: stats.totalNodes,
          totalEdges: stats.totalEdges,
          nodesByType: stats.nodesByType,
          edgesByType: stats.edgesByType,
          embeddingCoverage,
        };
      } catch (error) {
        result = { error: error instanceof Error ? error.message : 'Unknown error getting status' };
      }
      toolUsed = 'get_status';
      break;
    }

    case 'stats': {
      try {
        const stats = await codeGraphService.getGraphStats();
        result = {
          totalNodes: stats.totalNodes,
          totalEdges: stats.totalEdges,
          nodesByType: stats.nodesByType,
          edgesByType: stats.edgesByType,
          largestFiles: stats.largestFiles,
          mostConnected: stats.mostConnected,
        };
      } catch (error) {
        result = { error: error instanceof Error ? error.message : 'Unknown error getting stats' };
      }
      toolUsed = 'get_stats';
      break;
    }

    case 'source': {
      if (!args.path) return { error: 'path is required for source action' };
      const pathCheck = await validateFilePath(args.path as string);
      if (!pathCheck.valid) return { error: pathCheck.error };
      try {
        const fileResult = await readSourceFile(pathCheck.resolved, {
          startLine: (args.startLine as number) || undefined,
          endLine: (args.endLine as number) || undefined,
        });
        const rawLines = fileResult.content.split('\n');
        const sl = (args.startLine as number) || 1;
        result = {
          path: fileResult.path,
          startLine: sl,
          endLine: sl + rawLines.length - 1,
          totalLines: fileResult.totalLines,
          content: fileResult.content,
          lines: rawLines.map((line, i) => ({ line: sl + i, content: line })),
        };
      } catch (error) {
        result = { error: error instanceof Error ? error.message : 'Unknown error reading source' };
      }
      toolUsed = 'get_source';
      break;
    }

    default:
      return { error: `Unknown index action: ${action}. Use: configure, reindex, status, stats, source, ping` };
  }

  const durationMs = Date.now() - start;
  logger.debug('Index persona completed', { action, toolUsed, durationMs });

  return {
    ...(result as object),
    _meta: { action, toolUsed, durationMs },
  };
}
