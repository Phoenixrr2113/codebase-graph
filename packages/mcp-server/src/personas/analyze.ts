/**
 * Analyze Persona — Code analysis, security, impact, and history
 *
 * Consolidates: analyze_impact, find_vulnerabilities, get_complexity_report,
 *               analyze_file_for_refactoring, trace_data_flow, get_symbol_history
 */

import type { ToolDefinition } from '../tools/consolidated';
import { analyzeImpact, type AnalyzeImpactInput } from '../tools/analyzeImpact';
import { findVulnerabilities, type FindVulnerabilitiesInput } from '../tools/findVulnerabilities';
import { getComplexityReport, type ComplexityReportInput } from '../tools/complexityReport';
import { analyzeFileForRefactoring, type AnalyzeRefactoringInput } from '../tools/analyzeRefactoring';
import { traceDataFlow, type TraceDataFlowInput } from '../tools/traceDataFlow';
import { getSymbolHistory, type SymbolHistoryInput } from '../tools/symbolHistory';
import { validateFilePath, clampLimit } from './validation';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'MCP:Persona:Analyze' });

export const analyzePersonaDefinition: ToolDefinition = {
  name: 'analyze',
  description: `Analyze code for impact, security, complexity, refactoring opportunities, data flow, and history.

**Actions:**
- **impact**: Find all code affected by changing a symbol. Returns callers, affected files, risk score.
  Params: symbol (required), file (optional, disambiguate), depth (default: 5)
- **vulnerabilities**: Scan for security vulnerabilities (injection, XSS, auth).
  Params: scope (default: "all"), severity (critical|high|medium|low|all), category (injection|xss|auth|all)
- **complexity**: Find complex code hotspots by cyclomatic/cognitive complexity.
  Params: scope (default: "all"), threshold (default: 10), sortBy (complexity|cognitive|nesting)
- **refactoring**: Identify refactoring opportunities in a file (extraction candidates, responsibilities).
  Params: file (required), threshold (default: 3)
- **dataflow**: Trace data flow from source to sink. Identifies vulnerabilities and sanitizers.
  Params: source (required, e.g. "request.body"), file (required), sink (optional)
- **history**: Get git commit history for a symbol.
  Params: symbol (required), file (optional), limit (default: 20)

**Examples:**
- Impact analysis: { action: "impact", symbol: "parseProject", depth: 3 }
- Security scan: { action: "vulnerabilities", severity: "critical" }
- Find complex code: { action: "complexity", threshold: 15 }
- Refactoring: { action: "refactoring", file: "src/service.ts" }`,
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['impact', 'vulnerabilities', 'complexity', 'refactoring', 'dataflow', 'history'],
        description: 'What kind of analysis to perform',
      },
      symbol: {
        type: 'string',
        description: 'Symbol name (for impact/history)',
      },
      file: {
        type: 'string',
        description: 'File path (for refactoring/dataflow/disambiguate)',
      },
      source: {
        type: 'string',
        description: 'Data source expression (for dataflow, e.g. "request.body")',
      },
      sink: {
        type: 'string',
        description: 'Data sink (for dataflow, optional)',
      },
      scope: {
        type: 'string',
        description: 'Path prefix scope (for vulnerabilities/complexity)',
      },
      depth: {
        type: 'number',
        description: 'Traversal depth for impact analysis (default: 5)',
      },
      severity: {
        type: 'string',
        enum: ['critical', 'high', 'medium', 'low', 'all'],
        description: 'Vulnerability severity filter',
      },
      category: {
        type: 'string',
        enum: ['injection', 'xss', 'auth', 'all'],
        description: 'Vulnerability category filter',
      },
      threshold: {
        type: 'number',
        description: 'Complexity/coupling threshold',
      },
      sortBy: {
        type: 'string',
        enum: ['complexity', 'cognitive', 'nesting'],
        description: 'Sort complexity results by metric',
      },
      limit: {
        type: 'number',
        description: 'Max results (for history)',
      },
    },
    required: ['action'],
  },
};

export async function handleAnalyze(args: Record<string, unknown>): Promise<unknown> {
  const action = args.action as string;
  const start = Date.now();

  let result: unknown;
  let toolUsed: string;

  switch (action) {
    case 'impact': {
      if (!args.symbol) return { error: 'symbol is required for impact action' };
      const input: AnalyzeImpactInput = {
        symbol: args.symbol as string,
        depth: (args.depth as number) || 5,
      };
      if (args.file) input.file = args.file as string;
      result = await analyzeImpact(input);
      toolUsed = 'analyze_impact';
      break;
    }

    case 'vulnerabilities': {
      const input: FindVulnerabilitiesInput = {
        scope: (args.scope as string) || 'all',
        severity: (args.severity as FindVulnerabilitiesInput['severity']) || 'all',
        category: (args.category as FindVulnerabilitiesInput['category']) || 'all',
      };
      result = await findVulnerabilities(input);
      toolUsed = 'find_vulnerabilities';
      break;
    }

    case 'complexity': {
      const input: ComplexityReportInput = {
        scope: (args.scope as string) || 'all',
        threshold: (args.threshold as number) || 10,
        sortBy: (args.sortBy as ComplexityReportInput['sortBy']) || 'complexity',
      };
      result = await getComplexityReport(input);
      toolUsed = 'get_complexity_report';
      break;
    }

    case 'refactoring': {
      if (!args.file) return { error: 'file is required for refactoring action' };
      const pathCheck = await validateFilePath(args.file as string);
      if (!pathCheck.valid) return { error: pathCheck.error };
      const input: AnalyzeRefactoringInput = {
        file: args.file as string,
        threshold: (args.threshold as number) || 3,
      };
      result = await analyzeFileForRefactoring(input);
      toolUsed = 'analyze_file_for_refactoring';
      break;
    }

    case 'dataflow': {
      if (!args.source) return { error: 'source is required for dataflow action' };
      if (args.file) {
        const pathCheck = await validateFilePath(args.file as string);
        if (!pathCheck.valid) return { error: pathCheck.error };
      }
      const input: TraceDataFlowInput = {
        source: args.source as string,
      };
      if (args.sink) input.sink = args.sink as string;
      if (args.file) input.file = args.file as string;
      result = await traceDataFlow(input);
      toolUsed = 'trace_data_flow';
      break;
    }

    case 'history': {
      if (!args.symbol) return { error: 'symbol is required for history action' };
      const input: SymbolHistoryInput = {
        symbol: args.symbol as string,
        limit: clampLimit(args.limit as number | undefined),
      };
      if (args.file) input.file = args.file as string;
      result = await getSymbolHistory(input);
      toolUsed = 'get_symbol_history';
      break;
    }

    default:
      return { error: `Unknown analyze action: ${action}. Use: impact, vulnerabilities, complexity, refactoring, dataflow, history` };
  }

  const durationMs = Date.now() - start;
  logger.debug('Analyze persona completed', { action, toolUsed, durationMs });

  return {
    ...(result as object),
    _meta: { action, toolUsed, durationMs },
  };
}
