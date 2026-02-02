/**
 * MCP Consolidated Tool Registry
 * 
 * Exposes core tools for LLM codebase context:
 * - configure_projects: Setup and manage active projects
 * - search: Find files and symbols
 * - get_context: Get detailed context for file/symbol  
 * - query: Advanced raw Cypher queries
 * 
 * Tool descriptions include schema + file tree for LLM context.
 * First-use triggers setup prompt for project selection.
 */

import { searchToolDefinition, search, type SearchInput } from './search';
import { getContextToolDefinition, getContext, type GetContextInput } from './getContext';
import { queryGraphToolDefinition, queryGraph, type QueryGraphInput } from './queryGraph';
import {
  configureProjectsToolDefinition,
  configureProjects,
  checkSetupRequired,
  type ConfigureProjectsInput
} from './configureProjects';
import { getShortSchema } from '../schema';
import { buildFileTree, getIndexSummary } from '@codegraph/graph';
import { getGraphClient } from '../graphClient';
import { needsSetup, getActiveProjectPaths } from '../config';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'MCP:Tools' });

// ============================================================================
// Types
// ============================================================================

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Build dynamic tool definitions with schema + file tree context
 */
export async function buildToolsWithContext(): Promise<ToolDefinition[]> {
  let contextPreamble = '';
  const isSetupNeeded = await needsSetup();

  if (isSetupNeeded) {
    contextPreamble = `
⚠️ **Setup Required**

Before using search/get_context, please run:
\`configure_projects\` with action: "status" to see available projects and select which to include.

---

`;
  } else {
    try {
      const client = await getGraphClient();
      const activePaths = await getActiveProjectPaths();

      // Build file tree scoped to active projects
      const rootPath = activePaths.length === 1 ? activePaths[0] : undefined;
      const fileTreeOptions = rootPath ? { maxDepth: 3, rootPath } : { maxDepth: 3 };
      const fileTree = await buildFileTree(client, fileTreeOptions);
      const summary = await getIndexSummary(client);
      const schema = getShortSchema();

      const projectInfo = activePaths.length > 0
        ? `Active: ${activePaths.map(p => p.split('/').pop()).join(', ')}`
        : 'Searching all projects';

      contextPreamble = `
## Codebase Context

${projectInfo}
${summary}

### Schema
${schema}

### File Structure
${fileTree}

---

`;
    } catch (error) {
      logger.warn('Failed to build context preamble', { error });
      contextPreamble = `(Codebase not yet indexed. Use configure_projects to set up.)\n\n`;
    }
  }

  return [
    {
      name: 'ping',
      description: 'Test connectivity to the CodeGraph MCP server',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    configureProjectsToolDefinition,
    {
      ...searchToolDefinition,
      description: contextPreamble + searchToolDefinition.description,
    },
    getContextToolDefinition,
    {
      ...queryGraphToolDefinition,
      description: queryGraphToolDefinition.description + '\n\nNote: Use search and get_context for most tasks. Query is for advanced use.',
    },
  ];
}

/**
 * Static tool list (without dynamic context) for initial registration
 */
export const staticTools: ToolDefinition[] = [
  {
    name: 'ping',
    description: 'Test connectivity to the CodeGraph MCP server',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  configureProjectsToolDefinition,
  searchToolDefinition,
  getContextToolDefinition,
  queryGraphToolDefinition,
];

// ============================================================================
// Tool Handlers
// ============================================================================

const handlers: Record<string, ToolHandler> = {
  ping: async () => ({
    status: 'ok',
    message: 'CodeGraph MCP Server is running',
    timestamp: new Date().toISOString(),
  }),

  configure_projects: async (args) => {
    const input: ConfigureProjectsInput = {
      action: (args.action as ConfigureProjectsInput['action']) || 'status',
      projects: args.projects as string[] | undefined,
    };
    return configureProjects(input);
  },

  search: async (args) => {
    // Check if setup is needed
    const setupPrompt = await checkSetupRequired();
    if (setupPrompt) {
      return setupPrompt;
    }

    const input: SearchInput = {
      query: args.query as string,
      type: (args.type as SearchInput['type']) || 'all',
      limit: (args.limit as number) || 20,
    };
    return search(input);
  },

  get_context: async (args) => {
    // Check if setup is needed
    const setupPrompt = await checkSetupRequired();
    if (setupPrompt) {
      return setupPrompt;
    }

    const input: GetContextInput = {
      file: args.file as string | undefined,
      symbol: args.symbol as string | undefined,
      includeRelationships: args.includeRelationships !== false,
      maxDepth: (args.maxDepth as number) || 2,
    };
    return getContext(input);
  },

  query: async (args) => {
    const input: QueryGraphInput = {
      cypher: args.cypher as string,
      params: args.params as Record<string, unknown> | undefined,
    };
    return queryGraph(input);
  },
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Get tool definitions (with context when possible)
 */
export async function getTools(): Promise<ToolDefinition[]> {
  try {
    return await buildToolsWithContext();
  } catch (error) {
    logger.warn('Using static tools', { error });
    return staticTools;
  }
}

/**
 * Handle a tool call
 */
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const handler = handlers[name];

  if (!handler) {
    throw new Error(`Unknown tool: ${name}. Available: ${Object.keys(handlers).join(', ')}`);
  }

  return handler(args);
}

// Re-export for backwards compatibility during migration
export { searchToolDefinition, getContextToolDefinition, configureProjectsToolDefinition };
