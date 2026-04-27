/**
 * MCP Tool Router
 *
 * Default mode (4 persona tools): search, knowledge, codebase, query
 * Raw mode (CODEGRAPH_RAW_TOOLS=true): adds individual tools for power users
 */

import { getContextToolDefinition, getContext, type GetContextInput } from './getContext';
import { queryGraphToolDefinition, queryGraph, type QueryGraphInput } from './queryGraph';
import {
  configureProjectsToolDefinition,
  configureProjects,
  checkSetupRequired,
  type ConfigureProjectsInput
} from './configureProjects';
import {
  reindexToolDefinition,
  triggerReindex,
  type ReindexInput,
} from './reindex';

// Search tool
import { searchCodeToolDefinition, searchCode, type SearchCodeInput } from './searchCode';

// Knowledge graph tools
import { knowledgeToolDefinitions, knowledgeHandlers } from './knowledge';

// Graph Explorer App UI tools
import {
  graphExplorerToolDefinition,
  fetchGraphDataToolDefinition,
  fetchGraphData,
} from './graphExplorer';

// Persona tools
import { personaToolDefinitions, personaHandlers, useRawTools } from '../personas';

// Infrastructure
import {
  needsSetup,
  getActiveProjectPaths, updateLastUsed, isStale, indexProject,
  codeGraphService, readSourceFile,
} from '@codegraph/core';
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
// Inline Tool Definitions (for tools without a separate file)
// ============================================================================

const getStatsToolDefinition: ToolDefinition = {
  name: 'get_stats',
  description: 'Get graph-wide statistics: node/edge counts by type, largest files, most connected entities.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Optional project path to scope stats to a specific project',
      },
    },
  },
};

const getSourceToolDefinition: ToolDefinition = {
  name: 'get_source',
  description: 'Read source code from a file with optional line range. Returns numbered lines.',
  inputSchema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute file path to read (required)',
      },
      startLine: {
        type: 'number',
        description: 'Starting line number (1-indexed, optional)',
      },
      endLine: {
        type: 'number',
        description: 'Ending line number (optional)',
      },
    },
    required: ['path'],
  },
};

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
      const activePaths = await getActiveProjectPaths();

      // Build file tree scoped to active projects
      const rootPath = activePaths.length === 1 ? activePaths[0] : undefined;
      const fileTreeOptions = rootPath ? { maxDepth: 3, rootPath } : { maxDepth: 3 };
      const fileTree = await codeGraphService.buildFileTree(fileTreeOptions);
      const summary = await codeGraphService.getIndexSummary();

      const projectInfo = activePaths.length > 0
        ? `Active: ${activePaths.map(p => p.split('/').pop()).join(', ')}`
        : 'Searching all projects';

      contextPreamble = `
## Codebase Context

${projectInfo}
${summary}

### File Structure
${fileTree}

---

`;
    } catch (error) {
      logger.warn('Failed to build context preamble', { error });
      contextPreamble = `(Codebase not yet indexed. Use configure_projects to set up.)\n\n`;
    }
  }

  // Build persona tools with context preamble
  const personaTools = personaToolDefinitions.map(tool => {
    if (tool.name === 'search') {
      return { ...tool, description: contextPreamble + tool.description };
    }
    return tool;
  });

  // If raw tools are not requested, return only persona tools
  if (!useRawTools()) {
    return personaTools;
  }

  // Raw mode: return both persona tools and raw tools
  return [
    // ---- Persona tools (consolidated) ----
    ...personaTools,

    // ---- Raw tools (for power users) ----
    {
      name: 'ping',
      description: 'Test connectivity to the CodeGraph MCP server',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    configureProjectsToolDefinition,
    getContextToolDefinition,
    {
      ...queryGraphToolDefinition,
      description: queryGraphToolDefinition.description + '\n\nNote: Use search and get_context for most tasks. Query is for advanced use.',
    },
    reindexToolDefinition,

    // ---- Index & status tools ----
    getStatsToolDefinition,
    getSourceToolDefinition,

    // ---- Search tools ----
    searchCodeToolDefinition,

    // ---- Knowledge graph tools ----
    ...knowledgeToolDefinitions,

    // ---- App UI tools ----
    graphExplorerToolDefinition,
    fetchGraphDataToolDefinition,
  ];
}

/**
 * Static tool list (without dynamic context) for initial registration
 */
export const staticTools: ToolDefinition[] = useRawTools()
  ? [
      // Persona tools
      ...personaToolDefinitions,
      // Raw tools
      {
        name: 'ping',
        description: 'Test connectivity to the CodeGraph MCP server',
        inputSchema: { type: 'object', properties: {} },
      },
      configureProjectsToolDefinition,
      getContextToolDefinition,
      queryGraphToolDefinition,
      reindexToolDefinition,
      getStatsToolDefinition,
      getSourceToolDefinition,
      searchCodeToolDefinition,
      ...knowledgeToolDefinitions,
      graphExplorerToolDefinition,
      fetchGraphDataToolDefinition,
    ]
  : personaToolDefinitions;

// ============================================================================
// Tool Handlers
// ============================================================================

/**
 * Check staleness and trigger background re-index if needed.
 * Non-blocking — current request returns immediately with existing data.
 */
let stalenessCheckInProgress = false;

async function checkAndTriggerStalenessReindex(): Promise<void> {
  if (stalenessCheckInProgress) return;

  try {
    const stale = await isStale();
    if (!stale) return;

    stalenessCheckInProgress = true;
    logger.info('Context is stale, triggering background re-index');

    const activePaths = await getActiveProjectPaths();
    if (activePaths.length === 0) {
      stalenessCheckInProgress = false;
      return;
    }

    // Run re-index in background (non-blocking)
    Promise.all(
      activePaths.map(async (rootPath) => {
        try {
          const result = await indexProject(rootPath, { deferEmbeddings: true });
          logger.info(`Staleness re-index complete: ${result.projectName} (${result.stats.files} files)`);
        } catch (err) {
          logger.warn(`Staleness re-index failed for ${rootPath}:`, err);
        }
      })
    ).finally(() => {
      stalenessCheckInProgress = false;
    });
  } catch (err) {
    stalenessCheckInProgress = false;
    logger.warn('Staleness check failed:', err);
  }
}

const rawHandlers: Record<string, ToolHandler> = {
  ping: async () => ({
    status: 'ok',
    message: 'CodeGraph MCP Server is running',
    timestamp: new Date().toISOString(),
  }),

  configure_projects: async (args) => {
    const input = {
      action: (args.action as ConfigureProjectsInput['action']) || 'status',
    } as ConfigureProjectsInput;
    if (args.projects != null) input.projects = args.projects as string[];
    return configureProjects(input);
  },

  get_context: async (args) => {
    const setupPrompt = await checkSetupRequired();
    if (setupPrompt) return setupPrompt;

    const input = {
      includeRelationships: args.includeRelationships !== false,
      maxDepth: (args.maxDepth as number) || 2,
    } as GetContextInput;
    if (args.file != null) input.file = args.file as string;
    if (args.symbol != null) input.symbol = args.symbol as string;
    return getContext(input);
  },

  query: async (args) => {
    const input = {
      cypher: args.cypher as string,
    } as QueryGraphInput;
    if (args.params != null) input.params = args.params as Record<string, unknown>;
    return queryGraph(input);
  },

  trigger_reindex: async (args) => {
    const input = {
      mode: (args.mode as 'incremental' | 'full') || 'incremental',
    } as ReindexInput;
    if (args.scope != null) input.scope = args.scope as string;
    return triggerReindex(input);
  },

  // ==== Index & status tools ====

  get_stats: async () => {
    try {
      const stats = await codeGraphService.getGraphStats();
      return {
        totalNodes: stats.totalNodes,
        totalEdges: stats.totalEdges,
        nodesByType: stats.nodesByType,
        edgesByType: stats.edgesByType,
        largestFiles: stats.largestFiles,
        mostConnected: stats.mostConnected,
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error getting stats' };
    }
  },

  get_source: async (args) => {
    try {
      const filePath = args.path as string;
      if (!filePath) return { error: 'File path is required' };

      const result = await readSourceFile(filePath, {
        startLine: (args.startLine as number) || undefined,
        endLine: (args.endLine as number) || undefined,
      });

      // Build numbered lines for backward compat
      const rawLines = result.content.split('\n');
      const startLine = (args.startLine as number) || 1;
      const numbered = rawLines.map((line, i) => ({
        line: startLine + i,
        content: line,
      }));

      return {
        path: result.path,
        startLine,
        endLine: startLine + rawLines.length - 1,
        totalLines: result.totalLines,
        content: result.content,
        lines: numbered,
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error reading source' };
    }
  },

  // ==== Symbol & code tools ====

  search_code: async (args) => {
    const input: SearchCodeInput = { query: args.query as string };
    if (args.scope && args.scope !== 'all') input.scope = args.scope as string;
    if (args.limit) input.limit = args.limit as number;
    return searchCode(input);
  },

  // ==== Knowledge graph tools ====
  ...knowledgeHandlers,

  // ==== App UI tools ====

  graph_explorer: async (args) => {
    // App UI clients render the HTML panel inline; non-App-UI clients get a
    // text response describing the tool.
    return {
      message: 'Graph Explorer panel registered. Requires an App-UI-capable MCP client (e.g. Claude Desktop) to render.',
      resourceUri: 'ui://codegraph/graph-explorer.html',
      projectPath: args.projectPath ?? null,
    };
  },

  fetch_graph_data: async (args) => {
    try {
      const { getGraphClient } = await import('@codegraph/core');
      const client = await getGraphClient();
      return fetchGraphData(client as Parameters<typeof fetchGraphData>[0], {
        projectPath: typeof args.projectPath === 'string' ? args.projectPath : undefined,
        limit: typeof args.limit === 'number' ? args.limit : undefined,
      });
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Failed to fetch graph data', nodes: [], edges: [] };
    }
  },
};

// Combined handlers: raw tools + persona tools (persona takes precedence for shared names)
const handlers: Record<string, ToolHandler> = {
  ...rawHandlers,
  ...personaHandlers,
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

  // Track lastUsed for staleness detection
  updateLastUsed().catch(() => {}); // Non-blocking

  // On query/search/get_context calls, check for staleness and trigger background re-index
  if (['search', 'get_context', 'query'].includes(name)) {
    checkAndTriggerStalenessReindex(); // Non-blocking
  }

  return handler(args);
}

// Re-export for backwards compatibility during migration
export { getContextToolDefinition, configureProjectsToolDefinition };
