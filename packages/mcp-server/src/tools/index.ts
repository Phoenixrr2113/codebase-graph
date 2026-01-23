/**
 * MCP Tool Registry
 * Defines and registers available tools for the CodeGraph MCP server
 */

// zod will be used in subsequent tasks for input validation

import { indexStatusToolDefinition, getIndexStatus } from './indexStatus.js';
import { reindexToolDefinition, triggerReindex, type ReindexInput } from './reindex.js';
import { findSymbolToolDefinition, findSymbol, type FindSymbolInput } from './findSymbol.js';
import { searchCodeToolDefinition, searchCode, type SearchCodeInput } from './searchCode.js';
import { explainCodeToolDefinition, explainCode, type ExplainCodeInput } from './explainCode.js';
import { analyzeImpactToolDefinition, analyzeImpact, type AnalyzeImpactInput } from './analyzeImpact.js';
import { findVulnerabilitiesToolDefinition, findVulnerabilities, type FindVulnerabilitiesInput } from './findVulnerabilities.js';
import { traceDataFlowToolDefinition, traceDataFlow, type TraceDataFlowInput } from './traceDataFlow.js';
import { complexityReportToolDefinition, getComplexityReport, type ComplexityReportInput } from './complexityReport.js';
import { repoMapToolDefinition, getRepoMap, type RepoMapInput } from './repoMap.js';
import { queryGraphToolDefinition, queryGraph, type QueryGraphInput } from './queryGraph.js';
import { symbolHistoryToolDefinition, getSymbolHistory, type SymbolHistoryInput } from './symbolHistory.js';
import { analyzeRefactoringToolDefinition, analyzeFileForRefactoring, type AnalyzeRefactoringInput } from './analyzeRefactoring.js';

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Tool definition type matching MCP SDK
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Available tools for the CodeGraph MCP server
 * Tools are added in subsequent tasks
 */
export const tools: ToolDefinition[] = [
  {
    name: 'ping',
    description: 'Test connectivity to the CodeGraph MCP server',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  indexStatusToolDefinition,
  reindexToolDefinition,
  findSymbolToolDefinition,
  searchCodeToolDefinition,
  explainCodeToolDefinition,
  analyzeImpactToolDefinition,
  findVulnerabilitiesToolDefinition,
  traceDataFlowToolDefinition,
  complexityReportToolDefinition,
  repoMapToolDefinition,
  queryGraphToolDefinition,
  symbolHistoryToolDefinition,
  analyzeRefactoringToolDefinition,
];

// ============================================================================
// Tool Handlers
// ============================================================================

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

const handlers: Record<string, ToolHandler> = {
  ping: async () => {
    return {
      status: 'ok',
      message: 'CodeGraph MCP Server is running',
      timestamp: new Date().toISOString(),
    };
  },
  get_index_status: async (args) => {
    const input = args.repo ? { repo: args.repo as string } : {};
    return getIndexStatus(input);
  },
  trigger_reindex: async (args) => {
    const input: ReindexInput = {
      mode: (args.mode as 'incremental' | 'full') || 'incremental',
      scope: args.scope as string | undefined,
    };
    return triggerReindex(input);
  },
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
  analyze_impact: async (args) => {
    const input: AnalyzeImpactInput = {
      symbol: args.symbol as string,
      file: args.file as string | undefined,
      depth: (args.depth as number) || 5,
    };
    return analyzeImpact(input);
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
  get_complexity_report: async (args) => {
    const input: ComplexityReportInput = {
      scope: (args.scope as string) || 'all',
      threshold: (args.threshold as number) || 10,
      sortBy: (args.sortBy as 'complexity' | 'cognitive' | 'nesting') || 'complexity',
    };
    return getComplexityReport(input);
  },
  get_repo_map: async (args) => {
    const input: RepoMapInput = {
      maxTokens: (args.maxTokens as number) || 2048,
      focusFiles: args.focusFiles as string[] | undefined,
      focusSymbols: args.focusSymbols as string[] | undefined,
    };
    return getRepoMap(input);
  },
  query_graph: async (args) => {
    const input: QueryGraphInput = {
      cypher: args.cypher as string,
      params: args.params as Record<string, unknown> | undefined,
    };
    return queryGraph(input);
  },
  get_symbol_history: async (args) => {
    const input: SymbolHistoryInput = {
      symbol: args.symbol as string,
      file: args.file as string | undefined,
      limit: (args.limit as number) || 20,
    };
    return getSymbolHistory(input);
  },
  analyze_file_for_refactoring: async (args) => {
    const input: AnalyzeRefactoringInput = {
      file: args.file as string,
      threshold: (args.threshold as number) || 3,
    };
    return analyzeFileForRefactoring(input);
  },
};

/**
 * Handle a tool call by delegating to the appropriate handler
 */
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const handler = handlers[name];

  if (!handler) {
    throw new Error(`Unknown tool: ${name}`);
  }

  return handler(args);
}

/**
 * Register a new tool
 */
export function registerTool(
  definition: ToolDefinition,
  handler: ToolHandler
): void {
  tools.push(definition);
  handlers[definition.name] = handler;
}
