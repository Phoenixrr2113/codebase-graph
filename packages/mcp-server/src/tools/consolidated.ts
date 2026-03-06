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

// Infrastructure
import { getShortSchema } from '../schema';
import { buildFileTree, getIndexSummary } from '@codegraph/graph';
import { getGraphClient } from '../graphClient';
import { needsSetup, getActiveProjectPaths, updateLastUsed, isStale } from '../config';
import { indexProject } from '../indexer';
import { createLogger } from '@codegraph/logger';
import { readFile } from 'node:fs/promises';

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
    // ---- Core tools ----
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
export const staticTools: ToolDefinition[] = [
  // Core
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
  reindexToolDefinition,

  // Index & status
  indexStatusToolDefinition,
  getStatsToolDefinition,
  getSourceToolDefinition,

  // Symbol & code
  findSymbolToolDefinition,
  searchCodeToolDefinition,
  explainCodeToolDefinition,
  repoMapToolDefinition,

  // Analysis
  complexityReportToolDefinition,
  analyzeImpactToolDefinition,
  analyzeRefactoringToolDefinition,
  findVulnerabilitiesToolDefinition,
  traceDataFlowToolDefinition,
  symbolHistoryToolDefinition,

  // Knowledge graph
  ...knowledgeToolDefinitions,
];

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
    if (activePaths.length === 0) return;

    // Run re-index in background (non-blocking)
    Promise.all(
      activePaths.map(async (rootPath) => {
        try {
          const result = await indexProject(rootPath);
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

const handlers: Record<string, ToolHandler> = {
  // ==== Core tools ====

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

  trigger_reindex: async (args) => {
    const input: ReindexInput = {
      mode: (args.mode as 'incremental' | 'full') || 'incremental',
      scope: args.scope as string | undefined,
    };
    return triggerReindex(input);
  },

  // ==== Index & status tools ====

  get_index_status: async (args) => {
    const input = args.repo ? { repo: args.repo as string } : {};
    return getIndexStatus(input);
  },

  get_stats: async (args) => {
    try {
      const client = await getGraphClient();
      const projectPath = args.projectPath as string | undefined;
      const pathFilter = projectPath ? `WHERE n.filePath STARTS WITH '${projectPath}'` : '';
      const filePathFilter = projectPath ? `WHERE f.path STARTS WITH '${projectPath}'` : '';

      // Parallel queries for stats
      const [
        nodesByType,
        edgesByType,
        largestFiles,
        mostConnected,
      ] = await Promise.all([
        client.roQuery<{ label: string; count: number }>(
          `MATCH (n) ${pathFilter} RETURN labels(n)[0] as label, count(n) as count ORDER BY count DESC`
        ),
        client.roQuery<{ type: string; count: number }>(
          'MATCH ()-[r]->() RETURN type(r) as type, count(r) as count ORDER BY count DESC'
        ),
        client.roQuery<{ path: string; entities: number }>(
          `MATCH (f:File) ${filePathFilter} OPTIONAL MATCH (f)-[:CONTAINS]->(e) RETURN f.path as path, count(e) as entities ORDER BY entities DESC LIMIT 10`
        ),
        client.roQuery<{ name: string; file: string; connections: number }>(
          'MATCH (n)-[r]-() WHERE n.name IS NOT NULL RETURN n.name as name, n.filePath as file, count(r) as connections ORDER BY connections DESC LIMIT 10'
        ),
      ]);

      const totalNodes = nodesByType.data.reduce((sum, r) => sum + (r.count ?? 0), 0);
      const totalEdges = edgesByType.data.reduce((sum, r) => sum + (r.count ?? 0), 0);

      return {
        totalNodes,
        totalEdges,
        nodesByType: Object.fromEntries(nodesByType.data.map(r => [r.label, r.count])),
        edgesByType: Object.fromEntries(edgesByType.data.map(r => [r.type, r.count])),
        largestFiles: largestFiles.data.map(r => ({ path: r.path, entities: r.entities })),
        mostConnected: mostConnected.data.map(r => ({ name: r.name, file: r.file, connections: r.connections })),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error getting stats' };
    }
  },

  get_source: async (args) => {
    try {
      const filePath = args.path as string;
      if (!filePath) return { error: 'File path is required' };

      // Security: reject paths that try to escape
      if (filePath.includes('..')) return { error: 'Path traversal not allowed' };

      const content = await readFile(filePath, 'utf-8');
      const allLines = content.split('\n');
      const startLine = (args.startLine as number) || 1;
      const endLine = (args.endLine as number) || allLines.length;

      const lines = allLines.slice(startLine - 1, endLine);
      const numbered = lines.map((line, i) => ({
        line: startLine + i,
        content: line,
      }));

      return {
        path: filePath,
        startLine,
        endLine: Math.min(endLine, allLines.length),
        totalLines: allLines.length,
        content: lines.join('\n'),
        lines: numbered,
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unknown error reading source' };
    }
  },

  // ==== Symbol & code tools ====

  find_symbol: async (args) => {
    const input: FindSymbolInput = {
      name: args.name as string,
      kind: (args.kind as 'function' | 'class' | 'interface' | 'variable' | 'any') || 'any',
      file: args.file as string | undefined,
    };
    return findSymbol(input);
  },

  search_code: async (args) => {
    const input: SearchCodeInput = {
      query: args.query as string,
      type: (args.type as 'name' | 'fulltext' | 'pattern') || 'name',
      scope: (args.scope as string) || 'all',
      language: args.language as string | undefined,
    };
    return searchCode(input);
  },

  explain_code: async (args) => {
    const input: ExplainCodeInput = {
      file: args.file as string,
      start_line: args.start_line as number | undefined,
      end_line: args.end_line as number | undefined,
    };
    return explainCode(input);
  },

  get_repo_map: async (args) => {
    const input: RepoMapInput = {
      maxTokens: (args.maxTokens as number) || 2048,
      focusFiles: args.focusFiles as string[] | undefined,
      focusSymbols: args.focusSymbols as string[] | undefined,
    };
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
    const input: AnalyzeImpactInput = {
      symbol: args.symbol as string,
      file: args.file as string | undefined,
      depth: (args.depth as number) || 5,
    };
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
      category: (args.category as 'injection' | 'xss' | 'auth' | 'payment' | 'all') || 'all',
    };
    return findVulnerabilities(input);
  },

  trace_data_flow: async (args) => {
    const input: TraceDataFlowInput = {
      source: args.source as string,
      sink: args.sink as string | undefined,
      file: args.file as string | undefined,
    };
    return traceDataFlow(input);
  },

  get_symbol_history: async (args) => {
    const input: SymbolHistoryInput = {
      symbol: args.symbol as string,
      file: args.file as string | undefined,
      limit: (args.limit as number) || 20,
    };
    return getSymbolHistory(input);
  },

  // ==== Knowledge graph tools ====
  ...knowledgeHandlers,
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
