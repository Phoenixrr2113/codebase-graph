/**
 * MCP Consolidated Tool Registry
 *
 * Exposes ALL tools for LLM codebase context:
 *
 * Core Tools:
 * - ping: Test connectivity
 * - configure_projects: Setup and manage active projects
 * - search: Find files and symbols
 * - get_context: Get detailed context for file/symbol
 * - query: Advanced raw Cypher queries
 * - trigger_reindex: Re-index codebase
 *
 * Analysis Tools:
 * - get_index_status: Index health and stats
 * - find_symbol: Find symbol by name with source location
 * - search_code: Search code by name/pattern
 * - explain_code: Code with dependencies, tests, complexity
 * - get_complexity_report: Complexity hotspots
 * - analyze_impact: Change impact analysis
 * - analyze_file_for_refactoring: Refactoring opportunities
 * - find_vulnerabilities: Security vulnerability scanning
 * - trace_data_flow: Data flow tracing
 * - get_symbol_history: Git commit history for symbols
 * - get_repo_map: Ranked symbol map for context
 * - get_stats: Graph-wide statistics
 * - get_source: Read source code with line ranges
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
import {
  reindexToolDefinition,
  triggerReindex,
  type ReindexInput,
} from './reindex';

// Analysis tools
import { indexStatusToolDefinition, getIndexStatus } from './indexStatus';
import { findSymbolToolDefinition, findSymbol, type FindSymbolInput } from './findSymbol';
import { searchCodeToolDefinition, searchCode, type SearchCodeInput } from './searchCode';
import { askCodeToolDefinition, askCode, type AskCodeInput } from './askCode';
import { queryCypherToolDefinition, queryCypher, type QueryCypherInput } from './queryCypher';
import { explainCodeToolDefinition, explainCode, type ExplainCodeInput } from './explainCode';
import { complexityReportToolDefinition, getComplexityReport, type ComplexityReportInput } from './complexityReport';
import { analyzeImpactToolDefinition, analyzeImpact, type AnalyzeImpactInput } from './analyzeImpact';
import { analyzeRefactoringToolDefinition, analyzeFileForRefactoring, type AnalyzeRefactoringInput } from './analyzeRefactoring';
import { findVulnerabilitiesToolDefinition, findVulnerabilities, type FindVulnerabilitiesInput } from './findVulnerabilities';
import { traceDataFlowToolDefinition, traceDataFlow, type TraceDataFlowInput } from './traceDataFlow';
import { symbolHistoryToolDefinition, getSymbolHistory, type SymbolHistoryInput } from './symbolHistory';
import { repoMapToolDefinition, getRepoMap, type RepoMapInput } from './repoMap';

// Knowledge graph tools
import { knowledgeToolDefinitions, knowledgeHandlers } from './knowledge';

// Persona tools
import { personaToolDefinitions, personaHandlers, useRawTools } from '../personas';

// Infrastructure
import {
  getShortSchema, needsSetup,
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
    {
      ...searchToolDefinition,
      description: contextPreamble + searchToolDefinition.description,
    },
    getContextToolDefinition,
    {
      ...queryGraphToolDefinition,
      description: queryGraphToolDefinition.description + '\n\nNote: Use search and get_context for most tasks. Query is for advanced use.',
    },
    reindexToolDefinition,

    // ---- Index & status tools ----
    indexStatusToolDefinition,
    getStatsToolDefinition,
    getSourceToolDefinition,

    // ---- Symbol & code tools ----
    findSymbolToolDefinition,
    searchCodeToolDefinition,
    askCodeToolDefinition,
    queryCypherToolDefinition,
    explainCodeToolDefinition,
    repoMapToolDefinition,

    // ---- Analysis tools ----
    complexityReportToolDefinition,
    analyzeImpactToolDefinition,
    analyzeRefactoringToolDefinition,
    findVulnerabilitiesToolDefinition,
    traceDataFlowToolDefinition,
    symbolHistoryToolDefinition,

    // ---- Knowledge graph tools ----
    ...knowledgeToolDefinitions,
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
      searchToolDefinition,
      getContextToolDefinition,
      queryGraphToolDefinition,
      reindexToolDefinition,
      indexStatusToolDefinition,
      getStatsToolDefinition,
      getSourceToolDefinition,
      findSymbolToolDefinition,
      searchCodeToolDefinition,
      askCodeToolDefinition,
      queryCypherToolDefinition,
      explainCodeToolDefinition,
      repoMapToolDefinition,
      complexityReportToolDefinition,
      analyzeImpactToolDefinition,
      analyzeRefactoringToolDefinition,
      findVulnerabilitiesToolDefinition,
      traceDataFlowToolDefinition,
      symbolHistoryToolDefinition,
      ...knowledgeToolDefinitions,
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

  search: async (args) => {
    const setupPrompt = await checkSetupRequired();
    if (setupPrompt) return setupPrompt;

    const input: SearchInput = {
      query: args.query as string,
      type: (args.type as SearchInput['type']) || 'all',
      limit: (args.limit as number) || 20,
    };
    return search(input);
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

  get_index_status: async (args) => {
    const input = args.repo ? { repo: args.repo as string } : {};
    return getIndexStatus(input);
  },

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

  find_symbol: async (args) => {
    const input = {
      name: args.name as string,
      kind: (args.kind as 'function' | 'class' | 'interface' | 'variable' | 'any') || 'any',
    } as FindSymbolInput;
    if (args.file != null) input.file = args.file as string;
    return findSymbol(input);
  },

  search_code: async (args) => {
    const input = {
      query: args.query as string,
      type: (args.type as 'name' | 'fulltext' | 'pattern') || 'name',
      scope: (args.scope as string) || 'all',
    } as SearchCodeInput;
    if (args.language != null) input.language = args.language as string;
    if (typeof args.strategy === 'string') {
      input.strategy = args.strategy as NonNullable<SearchCodeInput['strategy']>;
    }
    return searchCode(input);
  },

  ask_code: async (args) => {
    const input: AskCodeInput = {
      question: args.question as string,
    };
    if (args.scope != null) input.scope = args.scope as string;
    if (args.limit != null) input.limit = args.limit as number;
    return askCode(input);
  },

  query_cypher: async (args) => {
    const input: QueryCypherInput = {
      question: args.question as string,
    };
    if (args.scope != null) input.scope = args.scope as string;
    return queryCypher(input);
  },

  explain_code: async (args) => {
    const input = {
      file: args.file as string,
    } as ExplainCodeInput;
    if (args.start_line != null) input.start_line = args.start_line as number;
    if (args.end_line != null) input.end_line = args.end_line as number;
    return explainCode(input);
  },

  get_repo_map: async (args) => {
    const input = {
      maxTokens: (args.maxTokens as number) || 2048,
    } as RepoMapInput;
    if (args.focusFiles != null) input.focusFiles = args.focusFiles as string[];
    if (args.focusSymbols != null) input.focusSymbols = args.focusSymbols as string[];
    return getRepoMap(input);
  },

  // ==== Analysis tools ====

  get_complexity_report: async (args) => {
    const input: ComplexityReportInput = {
      scope: (args.scope as string) || 'all',
      threshold: (args.threshold as number) || 10,
      sortBy: (args.sortBy as 'complexity' | 'cognitive' | 'nesting') || 'complexity',
    };
    return getComplexityReport(input);
  },

  analyze_impact: async (args) => {
    const input = {
      symbol: args.symbol as string,
      depth: (args.depth as number) || 5,
    } as AnalyzeImpactInput;
    if (args.file != null) input.file = args.file as string;
    return analyzeImpact(input);
  },

  analyze_file_for_refactoring: async (args) => {
    const input: AnalyzeRefactoringInput = {
      file: args.file as string,
      threshold: (args.threshold as number) || 3,
    };
    return analyzeFileForRefactoring(input);
  },

  find_vulnerabilities: async (args) => {
    const input: FindVulnerabilitiesInput = {
      scope: (args.scope as string) || 'all',
      severity: (args.severity as 'critical' | 'high' | 'medium' | 'low' | 'all') || 'all',
      category: (args.category as 'injection' | 'xss' | 'auth' | 'all') || 'all',
    };
    return findVulnerabilities(input);
  },

  trace_data_flow: async (args) => {
    const input = {
      source: args.source as string,
    } as TraceDataFlowInput;
    if (args.sink != null) input.sink = args.sink as string;
    if (args.file != null) input.file = args.file as string;
    return traceDataFlow(input);
  },

  get_symbol_history: async (args) => {
    const input = {
      symbol: args.symbol as string,
      limit: (args.limit as number) || 20,
    } as SymbolHistoryInput;
    if (args.file != null) input.file = args.file as string;
    return getSymbolHistory(input);
  },

  // ==== Knowledge graph tools ====
  ...knowledgeHandlers,
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
export { searchToolDefinition, getContextToolDefinition, configureProjectsToolDefinition };
