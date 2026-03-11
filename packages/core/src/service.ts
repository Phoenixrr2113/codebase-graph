/**
 * CodeGraphService — Unified Service Layer
 *
 * Consolidates all business query logic into a single service facade.
 * All Cypher is built here (dialect-aware) and executed via client.roQuery().
 *
 * Consumers: @codegraph/mcp-server, @codegraph/api, @codegraph/cli
 */

import type { CypherDialect } from '@codegraph/graph';
import { getGraphClient } from './graphClient';
import { getActiveProjectPaths } from './config';
import { tokensToChars } from './tokenEstimator';
import {
  analyzeImpact as runImpactAnalysis,
  getDirectCallersQuery,
  getTransitiveCallersQuery,
  getAffectedTestsQuery,
  getImpactSummary,
} from './analysis';
import type { ImpactAnalysisInput } from './analysis';
import {
  analyzeRefactoring as runRefactoringAnalysis,
  getExtractionCandidatesQuery,
  getInternalCallsQuery,
  getRefactoringSummary,
} from './analysis';
import type { RefactoringAnalysisInput } from './analysis';

// Imports for new consolidated methods
import {
  scanForVulnerabilities,
  sortBySeverity,
  analyzeDataflow as runDataflowAnalysis,
} from './analysis';
import type { SecurityFinding, DataflowAnalysisResult } from './analysis';
import { initParser, parseCode, parseFile } from './pipeline';
import { hybridSearch } from './hybridSearch';
import type { HybridSearchResult, HybridSearchOptions, CodeNodeType } from './hybridSearch';
import { createDefaultSearchRegistry } from './search';
import type { SearchResponse, SearchType, SearchContext } from './search';
import { createQueries, createOperations, buildFileTree, getIndexSummary } from '@codegraph/graph';
import type { FileTreeOptions } from '@codegraph/graph';
import type { GraphStats, GraphData, SubgraphData, GraphNode, GraphEdge, NodeLabel, EdgeLabel } from '@codegraph/types';
import type { ProjectEntity } from '@codegraph/types';

// ============================================================================
// Types
// ============================================================================

/** Search result from the graph */
export interface ServiceSearchResult {
  name: string;
  type: string;
  filePath: string;
  line?: number | undefined;
}

/** Symbol result with full details */
export interface ServiceSymbolResult {
  name: string;
  kind: string;
  file: string;
  line: number;
  endLine?: number | undefined;
  signature?: string | undefined;
  complexity?: number | undefined;
}

/** Code search result */
export interface ServiceCodeSearchResult {
  name: string;
  kind: string;
  file: string;
  line: number;
}

/** Entity context for a symbol or file */
export interface ServiceEntityContext {
  name: string;
  type: string;
  filePath: string;
  startLine?: number | undefined;
  endLine?: number | undefined;
  docstring?: string | undefined;
  params?: Array<{ name: string; type?: string }> | undefined;
  returnType?: string | undefined;
  complexity?: number | undefined;
}

/** Related entity from the graph */
export interface ServiceRelatedEntity {
  name: string;
  type: string;
  relationship: string;
  filePath: string;
}

/** Dependency info for a file */
export interface ServiceDependencyInfo {
  name: string;
  file: string;
  line: number;
  type: 'import' | 'call' | 'extends' | 'implements';
}

/** Complexity hotspot */
export interface ServiceComplexityHotspot {
  name: string;
  file: string;
  complexity: number;
  cognitive: number;
  nesting: number;
  lines: number;
}

/** Complexity summary */
export interface ServiceComplexitySummary {
  totalFunctions: number;
  overThreshold: number;
  maxComplexity: number;
  avgComplexity: number;
}

/** Project info from the graph */
export interface ServiceProjectInfo {
  name: string;
  path: string;
  fileCount: number;
  lastParsed?: string | undefined;
}

/** Commit change info */
export interface ServiceChangeInfo {
  date: string;
  author: string;
  message: string;
  commitHash: string;
  linesAdded?: number | undefined;
  linesRemoved?: number | undefined;
}

/** Impact analysis result */
export interface ServiceImpactResult {
  directCallers: Array<{ name: string; file: string }>;
  transitiveCallers: Array<{ name: string; file: string; depth: number }>;
  affectedFiles: string[];
  affectedTests: Array<{ name: string; file: string }>;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  recommendation: string;
}

/** Extraction candidate for refactoring */
export interface ServiceExtractionCandidate {
  name: string;
  couplingScore: number;
  internalCalls: number;
  stateReads: number;
  startLine: number;
  endLine: number;
}

/** Detected responsibility group */
export interface ServiceResponsibility {
  name: string;
  functions: string[];
  extractionOrder: number;
}

/** Refactoring analysis result */
export interface ServiceRefactoringResult {
  file: string;
  totalFunctions: number;
  extractionCandidates: ServiceExtractionCandidate[];
  responsibilities: ServiceResponsibility[];
  averageCouplingScore: number;
  couplingLevel: 'low' | 'medium' | 'high';
  summary: string;
}

// ============================================================================
// API model replacement types
// ============================================================================

/** Entity with its connections (replaces API entityModel) */
export interface EntityWithConnections {
  entity: {
    id: string;
    label: GraphNode['label'];
    displayName: string;
    filePath: string;
    data: GraphNode['data'];
  };
  connections: {
    incoming: GraphEdge[];
    outgoing: GraphEdge[];
  };
}

/** Pagination metadata */
export interface Pagination {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
}

/** Paginated nodes result */
export interface PaginatedNodesResult {
  nodes: GraphNode[];
  pagination: Pagination;
}

/** Query options for paginated nodes */
export interface NodesQueryOptions {
  page?: number | undefined;
  limit?: number | undefined;
  types?: NodeLabel[] | undefined;
  query?: string | undefined;
  projectId?: string | undefined;
  rootPath?: string | undefined;
}

/** Direction for neighbor traversal */
export type Direction = 'in' | 'out' | 'both';

/** Neighbors result with nodes, edges, and metadata */
export interface NeighborsResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  centerId: string;
  direction: Direction;
}

/** Result of a Cypher query execution */
export interface CypherResult {
  results: unknown[];
  metadata: unknown;
}

// ============================================================================
// New consolidated types
// ============================================================================

/** Vulnerability scan options */
export interface ServiceScanOptions {
  path?: string;
  extensions?: string[];
  severities?: string[];
  category?: string;
}

/** Vulnerability finding */
export interface ServiceVulnerability {
  type: string;
  severity: string;
  message: string;
  filePath: string;
  line: number;
  column: number;
  code: string;
  recommendation: string;
}

/** Vulnerability scan result */
export interface ServiceScanResult {
  vulnerabilities: ServiceVulnerability[];
  summary: { total: number; bySeverity: Record<string, number> };
  filesScanned: number;
}

/** Dataflow analysis result */
export interface ServiceDataflowResult {
  sources: Array<{ pattern: string; variable: string; category: string; line: number }>;
  sinks: Array<{ pattern: string; category: string; line: number }>;
  paths: Array<{
    source: string;
    transformations: string[];
    sink: string;
  }>;
  vulnerabilities: Array<{
    source: string;
    sink: string;
    severity: string;
    category: string;
  }>;
  summary: string;
}

/** Ranked symbol for repo map */
interface RankedSymbol {
  name: string;
  kind: string;
  connections: number;
  complexity: number;
  line: number;
}

/** Ranked file for repo map */
interface RankedFile {
  path: string;
  symbols: RankedSymbol[];
  totalConnections: number;
}

// ============================================================================
// Helper: Build OR-separated label check expression
// ============================================================================

function labelOr(dialect: CypherDialect, alias: string, labels: string[]): string {
  return labels.map(l => dialect.labelCheckExpr(alias, l)).join(' OR ');
}

/** Standard code entity labels */
const CODE_LABELS = ['Function', 'Class', 'Interface', 'Variable', 'Component', 'Type'];
const ALL_LABELS = ['File', ...CODE_LABELS];

// ============================================================================
// Helpers: Node property extraction and ID generation
// ============================================================================

const VALID_LABELS: NodeLabel[] = [
  'File', 'Function', 'Class', 'Interface', 'Variable', 'Type', 'Component', 'Import',
];

function extractNodeProps(node: Record<string, unknown>): Record<string, unknown> {
  if (node['properties'] && typeof node['properties'] === 'object') {
    return node['properties'] as Record<string, unknown>;
  }
  return node;
}

function getLabelFromLabels(labels: string[]): NodeLabel {
  const found = labels.find(l => VALID_LABELS.includes(l as NodeLabel));
  return (found as NodeLabel) ?? 'File';
}

function generateNodeId(label: NodeLabel, props: Record<string, unknown>): string {
  if (label === 'File') {
    return `File:${props['path'] ?? ''}`;
  }
  const name = props['name'] ?? '';
  const filePath = props['filePath'] ?? '';
  const line = props['startLine'] ?? props['line'] ?? 0;
  return `${label}:${filePath}:${name}:${line}`;
}

// ============================================================================
// CodeGraphService
// ============================================================================

class CodeGraphServiceImpl {
  // ---------------------------------------------------------------
  // Search & Discovery
  // ---------------------------------------------------------------

  /**
   * Search the codebase for entities by name.
   */
  async search(
    query: string,
    options?: {
      type?: 'all' | 'file' | 'function' | 'class' | 'interface' | 'component';
      types?: string[];
      limit?: number;
    },
  ): Promise<{ results: ServiceSearchResult[]; total: number; project?: string }> {
    const client = await getGraphClient();
    const dialect = client.dialect;
    const activePaths = await getActiveProjectPaths();
    const limit = options?.limit ?? 20;
    const type = options?.type ?? 'all';

    // Build type filter — support array of types or single type
    let typeFilter: string;
    if (options?.types && options.types.length > 0) {
      const capitalizedTypes = options.types.map(t => t.charAt(0).toUpperCase() + t.slice(1));
      typeFilter = `(${labelOr(dialect, 'n', capitalizedTypes)})`;
    } else if (type === 'all') {
      typeFilter = `(${labelOr(dialect, 'n', ALL_LABELS)})`;
    } else {
      typeFilter = dialect.labelCheckExpr('n', type.charAt(0).toUpperCase() + type.slice(1));
    }

    // Build project path filter
    let pathFilter = '';
    if (activePaths.length > 0) {
      const pathConditions = activePaths.map(
        (p) => `n.filePath STARTS WITH '${p}' OR n.path STARTS WITH '${p}'`,
      );
      pathFilter = `AND (${pathConditions.join(' OR ')})`;
    }

    const labelsExpr = dialect.labelsExpr('n');
    const cypher = `
      MATCH (n)
      WHERE ${typeFilter}
        AND (
          toLower(n.name) CONTAINS toLower($term)
          OR toLower(n.path) CONTAINS toLower($term)
        )
        ${pathFilter}
      RETURN n, ${labelsExpr} as labels
      LIMIT $limit
    `;

    const result = await client.roQuery<{
      n: Record<string, unknown>;
      labels: string | string[];
    }>(cypher, { params: { term: query, limit } });

    const results: ServiceSearchResult[] = (result.data ?? []).map((row) => {
      const normalized = dialect.normalizeNode(row.n);
      const props = normalized.properties;
      const labelsArr = Array.isArray(row.labels)
        ? row.labels
        : typeof row.labels === 'string'
          ? [row.labels]
          : normalized.labels;

      return {
        name: (props['name'] as string) ?? (props['path'] as string) ?? 'unknown',
        type: labelsArr[0] ?? 'Unknown',
        filePath: (props['filePath'] as string) ?? (props['path'] as string) ?? '',
        line: props['startLine'] as number | undefined,
      };
    });

    const response: { results: ServiceSearchResult[]; total: number; project?: string } = {
      results,
      total: results.length,
    };
    if (activePaths.length === 1) {
      const projectName = activePaths[0]?.split('/').pop();
      if (projectName) response.project = projectName;
    }
    return response;
  }

  /**
   * Find a symbol by exact name, optionally filtered by kind and file.
   */
  async findSymbol(
    name: string,
    options?: { kind?: 'function' | 'class' | 'interface' | 'variable' | 'any'; file?: string },
  ): Promise<{ symbol: ServiceSymbolResult | null; alternatives?: ServiceSymbolResult[] }> {
    const client = await getGraphClient();
    const dialect = client.dialect;
    const labelsExpr = dialect.labelsExpr('n');
    const kind = options?.kind ?? 'any';
    const file = options?.file;

    const kindToLabel: Record<string, string> = {
      function: 'Function',
      class: 'Class',
      interface: 'Interface',
      variable: 'Variable',
      any: '',
    };
    const label = kindToLabel[kind] || '';

    let cypher: string;
    const params: Record<string, string | number | boolean | null | Array<unknown>> = { name };
    const anyLabelFilter = `(${labelOr(dialect, 'n', ['Function', 'Class', 'Interface', 'Variable'])})`;

    if (label && file) {
      cypher = `MATCH (n:${label}) WHERE n.name = $name AND n.filePath CONTAINS $file RETURN n, ${labelsExpr} as labels LIMIT 10`;
      params.file = file;
    } else if (label) {
      cypher = `MATCH (n:${label}) WHERE n.name = $name RETURN n, ${labelsExpr} as labels LIMIT 10`;
    } else if (file) {
      cypher = `MATCH (n) WHERE n.name = $name AND n.filePath CONTAINS $file AND ${anyLabelFilter} RETURN n, ${labelsExpr} as labels LIMIT 10`;
      params.file = file;
    } else {
      cypher = `MATCH (n) WHERE n.name = $name AND ${anyLabelFilter} RETURN n, ${labelsExpr} as labels LIMIT 10`;
    }

    const result = await client.roQuery<{ n: Record<string, unknown>; labels: string | string[] }>(
      cypher,
      { params },
    );

    if (result.data.length === 0) {
      return { symbol: null };
    }

    const symbols: ServiceSymbolResult[] = result.data.map((row) => {
      const normalized = dialect.normalizeNode(row.n);
      const props = normalized.properties;
      const labelsArr = Array.isArray(row.labels)
        ? row.labels
        : typeof row.labels === 'string'
          ? [row.labels]
          : normalized.labels;
      return {
        name: (props['name'] as string) || 'unknown',
        kind: (labelsArr[0] || 'unknown').toLowerCase(),
        file: (props['filePath'] as string) || '',
        line: (props['startLine'] as number) || (props['line'] as number) || 0,
        endLine: props['endLine'] as number | undefined,
        signature: props['signature'] as string | undefined,
        complexity: props['complexity'] as number | undefined,
      };
    });

    const response: { symbol: ServiceSymbolResult | null; alternatives?: ServiceSymbolResult[] } = {
      symbol: symbols[0] ?? null,
    };
    if (symbols.length > 1) {
      response.alternatives = symbols.slice(1);
    }
    return response;
  }

  /**
   * Search code by name or text pattern.
   */
  async searchCode(
    query: string,
    options?: {
      type?: 'name' | 'fulltext' | 'pattern';
      scope?: string;
    },
  ): Promise<ServiceCodeSearchResult[]> {
    const client = await getGraphClient();
    const dialect = client.dialect;
    const firstLabel = dialect.firstLabelExpr('n');
    const scope = options?.scope && options.scope !== 'all' ? options.scope : '';
    const searchType = options?.type ?? 'name';

    const scopeFilter = scope ? 'AND n.filePath STARTS WITH $scope' : '';
    const labelFilter = `(${labelOr(dialect, 'n', ['Function', 'Class', 'Interface', 'Variable', 'Component'])})`;

    let cypher: string;
    if (searchType === 'name') {
      cypher = `
        MATCH (n)
        WHERE ${labelFilter}
          AND n.name CONTAINS $query ${scopeFilter}
        RETURN n.name as name, ${firstLabel} as kind, n.filePath as file, n.startLine as line
        ORDER BY n.name
        LIMIT 50
      `;
    } else {
      cypher = `
        MATCH (n)
        WHERE ${labelFilter}
          AND toLower(n.name) CONTAINS toLower($query) ${scopeFilter}
        RETURN n.name as name, ${firstLabel} as kind, n.filePath as file, n.startLine as line
        ORDER BY n.name
        LIMIT 50
      `;
    }

    const params: Record<string, string | number | boolean | null | Array<unknown>> = { query };
    if (scope) params.scope = scope;

    const result = await client.roQuery<{
      name: string;
      kind: string;
      file: string;
      line: number;
    }>(cypher, { params });

    return result.data.map((row) => ({
      name: row.name ?? 'unknown',
      kind: (row.kind ?? 'unknown').toLowerCase(),
      file: row.file ?? '',
      line: row.line ?? 0,
    }));
  }

  // ---------------------------------------------------------------
  // Context & Explanation
  // ---------------------------------------------------------------

  /**
   * Get code explanation for a file: dependencies, dependents, tests, complexity.
   */
  async getCodeExplanation(
    filePath: string,
  ): Promise<{
    dependencies: ServiceDependencyInfo[];
    dependents: ServiceDependencyInfo[];
    relatedTests: string[];
    complexity?: number;
  }> {
    const client = await getGraphClient();

    const importsQuery = `
      MATCH (f:File {path: $filePath})-[:CONTAINS]->(s)-[:IMPORTS]->(target)
      RETURN DISTINCT target.name as name, target.filePath as file, 1 as line, 'import' as type
      LIMIT 20
    `;

    const callersQuery = `
      MATCH (f:File {path: $filePath})-[:CONTAINS]->(fn:Function)<-[:CALLS]-(caller:Function)
      RETURN DISTINCT caller.name as name, caller.filePath as file, caller.startLine as line, 'call' as type
      LIMIT 20
    `;

    const testsQuery = `
      MATCH (f:File {path: $filePath})-[:CONTAINS]->(fn:Function)<-[:CALLS*]-(test:Function)
      WHERE test.filePath CONTAINS '.test.' OR test.filePath CONTAINS '.spec.'
      RETURN DISTINCT test.filePath as file
      LIMIT 10
    `;

    const complexityQuery = `
      MATCH (f:File {path: $filePath})-[:CONTAINS]->(fn:Function)
      RETURN avg(fn.complexity) as avgComplexity
    `;

    type DepRow = { name: string; file: string; line: number; type: string };
    type TestRow = { file: string };
    type ComplexityRow = { avgComplexity: number };

    const [importsResult, callersResult, testsResult, complexityResult] = await Promise.all([
      client.roQuery<DepRow>(importsQuery, { params: { filePath } }),
      client.roQuery<DepRow>(callersQuery, { params: { filePath } }),
      client.roQuery<TestRow>(testsQuery, { params: { filePath } }),
      client.roQuery<ComplexityRow>(complexityQuery, { params: { filePath } }),
    ]);

    const dependencies: ServiceDependencyInfo[] = importsResult.data.map((row) => ({
      name: row.name ?? 'unknown',
      file: row.file ?? '',
      line: row.line ?? 0,
      type: row.type as 'import' | 'call' | 'extends' | 'implements',
    }));

    const dependents: ServiceDependencyInfo[] = callersResult.data.map((row) => ({
      name: row.name ?? 'unknown',
      file: row.file ?? '',
      line: row.line ?? 0,
      type: row.type as 'import' | 'call' | 'extends' | 'implements',
    }));

    const relatedTests = testsResult.data.map((row) => row.file).filter(Boolean);
    const avgComplexity = complexityResult.data[0]?.avgComplexity;

    const response: {
      dependencies: ServiceDependencyInfo[];
      dependents: ServiceDependencyInfo[];
      relatedTests: string[];
      complexity?: number;
    } = { dependencies, dependents, relatedTests };
    if (avgComplexity) {
      response.complexity = Math.round(avgComplexity * 10) / 10;
    }
    return response;
  }

  /**
   * Get what a symbol calls.
   */
  async getSymbolCalls(name: string): Promise<Array<{ name: string; type: string; filePath: string }>> {
    const client = await getGraphClient();
    const firstLabelExpr = client.dialect.firstLabelExpr('target');
    const cypher = `
      MATCH (n {name: $name})-[r:CALLS]->(target)
      RETURN target.name as name, ${firstLabelExpr} as type, target.filePath as filePath
      LIMIT 20
    `;
    const result = await client.roQuery<{ name: string; type: string; filePath: string }>(
      cypher,
      { params: { name } },
    );
    return result.data ?? [];
  }

  /**
   * Get function callers for a symbol.
   */
  async getFunctionCallers(name: string): Promise<Array<{ name: string; filePath: string; startLine?: number }>> {
    const client = await getGraphClient();
    const cypher = `
      MATCH (caller:Function)-[c:CALLS]->(target:Function {name: $name})
      RETURN caller.name as name, caller.filePath as filePath, caller.startLine as startLine
    `;
    const result = await client.roQuery<{ name: string; filePath: string; startLine?: number }>(
      cypher,
      { params: { name } },
    );
    return result.data ?? [];
  }

  /**
   * Get symbol detail by name and file path.
   */
  async getSymbolDetail(
    name: string,
    filePath: string,
  ): Promise<ServiceEntityContext | null> {
    const client = await getGraphClient();
    const dialect = client.dialect;
    const labelsExpr = dialect.labelsExpr('n');

    const cypher = `
      MATCH (n {name: $name})
      WHERE n.filePath CONTAINS $filePath OR n.path CONTAINS $filePath
      RETURN n, ${labelsExpr} as labels
      LIMIT 1
    `;

    const result = await client.roQuery<{
      n: Record<string, unknown>;
      labels: string | string[];
    }>(cypher, { params: { name, filePath } });

    if (!result.data || result.data.length === 0) return null;

    const row = result.data[0]!;
    const normalized = dialect.normalizeNode(row.n);
    const props = normalized.properties;
    const labelsArr = Array.isArray(row.labels)
      ? row.labels
      : typeof row.labels === 'string'
        ? [row.labels]
        : normalized.labels;

    const entity: ServiceEntityContext = {
      name: (props['name'] as string) ?? name,
      type: labelsArr[0] ?? 'Unknown',
      filePath: (props['filePath'] as string) ?? (props['path'] as string) ?? '',
      startLine: props['startLine'] as number | undefined,
      endLine: props['endLine'] as number | undefined,
      docstring: props['docstring'] as string | undefined,
      returnType: props['returnType'] as string | undefined,
      complexity: props['complexity'] as number | undefined,
    };

    // Parse params if present
    if (props['params']) {
      try {
        entity.params =
          typeof props['params'] === 'string'
            ? JSON.parse(props['params'])
            : (props['params'] as Array<{ name: string; type?: string }>);
      } catch {
        // Ignore parse errors
      }
    }

    return entity;
  }

  // ---------------------------------------------------------------
  // Reporting
  // ---------------------------------------------------------------

  /**
   * Get complexity hotspots.
   */
  async getComplexityHotspots(options?: {
    threshold?: number;
    scope?: string;
    sortBy?: 'complexity' | 'cognitive' | 'nesting';
  }): Promise<{ hotspots: ServiceComplexityHotspot[]; summary: ServiceComplexitySummary }> {
    const client = await getGraphClient();
    const threshold = options?.threshold ?? 10;
    const scope = options?.scope && options.scope !== 'all' ? options.scope : '';

    const scopeFilter = scope ? 'AND f.filePath STARTS WITH $scope' : '';
    const cypher = `
      MATCH (f:Function)
      WHERE f.complexity >= $threshold ${scopeFilter}
      RETURN f.name as name,
             f.filePath as file,
             f.complexity as complexity,
             coalesce(f.cognitiveComplexity, 0) as cognitive,
             coalesce(f.nestingDepth, 0) as nesting,
             CASE WHEN f.endLine IS NOT NULL AND f.startLine IS NOT NULL
                  THEN f.endLine - f.startLine + 1 ELSE 0 END as lines
      ORDER BY f.complexity DESC
      LIMIT 50
    `;

    const queryParams: Record<string, string | number | boolean | null | Array<unknown>> = { threshold };
    if (scope) queryParams.scope = scope;

    const result = await client.roQuery<{
      name: string;
      file: string;
      complexity: number;
      cognitive: number;
      nesting: number;
      lines: number;
    }>(cypher, { params: queryParams });

    const countQuery = scope
      ? 'MATCH (f:Function) WHERE f.filePath STARTS WITH $scope RETURN count(f) as total, max(f.complexity) as maxC, avg(f.complexity) as avgC'
      : 'MATCH (f:Function) RETURN count(f) as total, max(f.complexity) as maxC, avg(f.complexity) as avgC';

    const countResult = await client.roQuery<{ total: number; maxC: number; avgC: number }>(
      countQuery,
      scope ? { params: { scope } } : undefined,
    );

    const hotspots: ServiceComplexityHotspot[] = result.data.map((row) => ({
      name: row.name ?? 'unknown',
      file: row.file ?? '',
      complexity: row.complexity ?? 0,
      cognitive: row.cognitive ?? 0,
      nesting: row.nesting ?? 0,
      lines: row.lines ?? 0,
    }));

    return {
      hotspots,
      summary: {
        totalFunctions: countResult.data[0]?.total ?? 0,
        overThreshold: hotspots.length,
        maxComplexity: countResult.data[0]?.maxC ?? 0,
        avgComplexity: Math.round((countResult.data[0]?.avgC ?? 0) * 10) / 10,
      },
    };
  }

  /**
   * Get index status with entity counts and project info.
   */
  async getIndexStatus(repo?: string): Promise<{
    status: 'ready' | 'empty' | 'error';
    totalFiles: number;
    totalFunctions: number;
    totalClasses: number;
    totalEdges: number;
    lastIndexed?: string;
    projects: ServiceProjectInfo[];
  }> {
    const client = await getGraphClient();

    const [fileResult, funcResult, classResult, projectResult] = await Promise.all([
      client.roQuery<{ count: number }>('MATCH (f:File) RETURN count(f) as count'),
      client.roQuery<{ count: number }>('MATCH (f:Function) RETURN count(f) as count'),
      client.roQuery<{ count: number }>('MATCH (c:Class) RETURN count(c) as count'),
      client.roQuery<{ name: string; path: string; fileCount: number; lastParsed: string }>(
        repo
          ? 'MATCH (p:Project) WHERE p.rootPath CONTAINS $repo RETURN p.name as name, p.rootPath as path, p.fileCount as fileCount, p.lastParsed as lastParsed'
          : 'MATCH (p:Project) RETURN p.name as name, p.rootPath as path, p.fileCount as fileCount, p.lastParsed as lastParsed',
        repo ? { params: { repo } } : undefined,
      ),
    ]);

    const edgeResult = await client.roQuery<{ count: number }>(
      'MATCH ()-[r]->() RETURN count(r) as count',
    );

    const totalFiles = fileResult.data[0]?.count ?? 0;
    const totalFunctions = funcResult.data[0]?.count ?? 0;
    const totalClasses = classResult.data[0]?.count ?? 0;
    const totalEdges = edgeResult.data[0]?.count ?? 0;

    const projects: ServiceProjectInfo[] = projectResult.data.map((p) => ({
      name: p.name ?? 'unknown',
      path: p.path ?? '',
      fileCount: p.fileCount ?? 0,
      lastParsed: p.lastParsed,
    }));

    const status = totalFiles === 0 ? 'empty' as const : 'ready' as const;
    const lastIndexed = projects.length > 0
      ? projects.reduce(
          (latest, p) =>
            p.lastParsed && (!latest || p.lastParsed > latest) ? p.lastParsed : latest,
          '' as string,
        )
      : undefined;

    const response: {
      status: 'ready' | 'empty' | 'error';
      totalFiles: number;
      totalFunctions: number;
      totalClasses: number;
      totalEdges: number;
      lastIndexed?: string;
      projects: ServiceProjectInfo[];
    } = { status, totalFiles, totalFunctions, totalClasses, totalEdges, projects };
    if (lastIndexed) {
      response.lastIndexed = lastIndexed;
    }
    return response;
  }

  /**
   * Get ranked repository map of important symbols.
   */
  async getRepoMap(options?: {
    maxTokens?: number;
    focusFiles?: string[];
    focusSymbols?: string[];
  }): Promise<{ map: string; filesIncluded: number; symbolsIncluded: number }> {
    const client = await getGraphClient();
    const dialect = client.dialect;
    const maxChars = tokensToChars(options?.maxTokens ?? 2048, 'code');

    const cypher = `
      MATCH (n)-[r]-()
      WHERE n.name IS NOT NULL AND n.filePath IS NOT NULL
      RETURN n.name as name, n.filePath as file,
             ${dialect.firstLabelExpr('n')} as kind,
             count(r) as connections,
             coalesce(n.complexity, 0) as complexity,
             coalesce(n.startLine, n.line, 0) as line
      ORDER BY connections DESC
      LIMIT 100
    `;

    const result = await client.roQuery<{
      name: string;
      file: string;
      kind: string;
      connections: number;
      complexity: number;
      line: number;
    }>(cypher);

    const focusFileSet = new Set(options?.focusFiles ?? []);
    const focusSymbolSet = new Set(options?.focusSymbols ?? []);

    const scored = result.data.map((row) => {
      let score = (row.connections ?? 0) + (row.complexity ?? 0);
      if (focusFileSet.has(row.file)) score += 100;
      if (focusSymbolSet.has(row.name)) score += 100;
      for (const f of focusFileSet) {
        if (row.file?.includes(f)) score += 50;
      }
      return { ...row, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // Group by file
    const fileMap = new Map<string, RankedFile>();
    for (const row of scored) {
      const filePath = row.file ?? '';
      if (!filePath) continue;

      if (!fileMap.has(filePath)) {
        fileMap.set(filePath, { path: filePath, symbols: [], totalConnections: 0 });
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

    const rankedFiles = [...fileMap.values()].sort(
      (a, b) => b.totalConnections - a.totalConnections,
    );

    // Format within token budget
    let output = '# Repository Map\n\n';
    let charsUsed = output.length;
    let filesIncluded = 0;
    let symbolsIncluded = 0;

    for (const file of rankedFiles) {
      const shortPath = file.path.split('/').slice(-3).join('/');
      let fileSection = `## ${shortPath}\n`;

      file.symbols.sort((a, b) => a.line - b.line);
      for (const sym of file.symbols) {
        const kindTag = sym.kind.charAt(0).toUpperCase();
        const metrics =
          sym.complexity > 0
            ? ` [cx:${sym.complexity}, conn:${sym.connections}]`
            : sym.connections > 1
              ? ` [conn:${sym.connections}]`
              : '';
        fileSection += `  ${kindTag} ${sym.name}${metrics} L${sym.line}\n`;
      }
      fileSection += '\n';

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

    return { map: output, filesIncluded, symbolsIncluded };
  }

  /**
   * Get symbol commit history.
   */
  async getSymbolHistory(
    symbol: string,
    options?: { file?: string; limit?: number },
  ): Promise<{
    file?: string;
    changes: ServiceChangeInfo[];
    authors: string[];
    ageDays: number;
    changeFrequency: number;
  }> {
    const client = await getGraphClient();
    const dialect = client.dialect;
    const limit = options?.limit ?? 20;
    let filePath = options?.file;

    // Resolve symbol's file if not provided
    if (!filePath) {
      const labelFilter = `(${labelOr(dialect, 'n', ['Function', 'Class', 'Interface', 'Variable'])})`;
      const symbolQuery = `
        MATCH (n)
        WHERE ${labelFilter}
          AND n.name = $symbol
        RETURN n.filePath as file
        LIMIT 1
      `;
      const symbolResult = await client.roQuery<{ file: string }>(
        symbolQuery,
        { params: { symbol } },
      );
      filePath = symbolResult.data[0]?.file;
    }

    if (!filePath) {
      return { changes: [], authors: [], ageDays: 0, changeFrequency: 0 };
    }

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

    const result = await client.roQuery<{
      commitHash: string;
      message: string;
      author: string;
      date: string;
      linesAdded?: number;
      linesRemoved?: number;
    }>(historyQuery, { params: { filePath, limit } });

    const changes: ServiceChangeInfo[] = result.data.map((row) => ({
      date: row.date ?? '',
      author: row.author ?? 'unknown',
      message: row.message ?? '',
      commitHash: row.commitHash ?? '',
      linesAdded: row.linesAdded,
      linesRemoved: row.linesRemoved,
    }));

    const authors = [...new Set(changes.map((c) => c.author))];

    let ageDays = 0;
    if (changes.length > 0) {
      const oldestDate = changes[changes.length - 1]?.date;
      if (oldestDate) {
        const date = new Date(oldestDate);
        ageDays = Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
      }
    }

    const changeFrequency =
      ageDays > 0 ? Math.round((changes.length / ageDays) * 30 * 10) / 10 : 0;

    return { file: filePath, changes, authors, ageDays, changeFrequency };
  }

  // ---------------------------------------------------------------
  // Analysis
  // ---------------------------------------------------------------

  /**
   * Analyze impact of changing a symbol.
   */
  async analyzeImpact(
    symbol: string,
    options?: { file?: string; depth?: number },
  ): Promise<ServiceImpactResult> {
    const client = await getGraphClient();
    const depth = options?.depth ?? 5;

    // Run three queries in parallel
    const directCallersQ = getDirectCallersQuery(symbol);
    const transitiveCallersQ = getTransitiveCallersQuery(symbol, depth);
    const testsQ = getAffectedTestsQuery(symbol);

    const [directResult, transitiveResult, testsResult] = await Promise.all([
      client.roQuery<{ name: string; file: string }>(directCallersQ),
      client.roQuery<{ name: string; file: string; depth: number }>(transitiveCallersQ),
      client.roQuery<{ name: string; file: string }>(testsQ),
    ]);

    // Get target symbol complexity
    const targetQuery = `MATCH (f:Function) WHERE f.name = $name RETURN f.name as name, f.filePath as file, f.complexity as complexity LIMIT 1`;
    const targetResult = await client.roQuery<{
      name: string;
      file: string;
      complexity?: number;
    }>(targetQuery, { params: { name: symbol } });

    const targetComplexity = targetResult.data[0]?.complexity;
    const analysisInput: ImpactAnalysisInput = {
      target: {
        name: symbol,
        file: targetResult.data[0]?.file ?? '',
        ...(targetComplexity !== undefined && { complexity: targetComplexity }),
      },
      callers: [
        ...directResult.data.map((c) => ({ ...c, depth: 1 })),
        ...transitiveResult.data,
      ],
      tests: testsResult.data,
    };

    const result = runImpactAnalysis(analysisInput, { maxDepth: depth });

    const affectedFiles = [
      ...new Set([
        ...directResult.data.map((c) => c.file),
        ...transitiveResult.data.map((c) => c.file),
      ]),
    ].filter(Boolean);

    return {
      directCallers: directResult.data,
      transitiveCallers: transitiveResult.data,
      affectedFiles,
      affectedTests: testsResult.data,
      riskScore: result.riskScore,
      riskLevel: result.riskLevel,
      recommendation: getImpactSummary(result),
    };
  }

  /**
   * Analyze a file for refactoring opportunities.
   */
  async analyzeRefactoring(
    file: string,
    options?: { threshold?: number },
  ): Promise<ServiceRefactoringResult> {
    const client = await getGraphClient();
    const threshold = options?.threshold ?? 3;

    const candidatesQuery = getExtractionCandidatesQuery(file);
    const callsQuery = getInternalCallsQuery(file);

    const [functionsResult, callsResult] = await Promise.all([
      client.roQuery<{
        name: string;
        startLine: number;
        endLine: number;
        internalCalls: number;
        stateReads: number;
      }>(candidatesQuery),
      client.roQuery<{ caller: string; callee: string }>(callsQuery),
    ]);

    const analysisInput: RefactoringAnalysisInput = {
      file,
      functions: functionsResult.data.map((f) => ({
        name: f.name ?? 'unknown',
        startLine: f.startLine ?? 0,
        endLine: f.endLine ?? 0,
        internalCalls: f.internalCalls ?? 0,
        stateReads: f.stateReads ?? 0,
      })),
      callRelationships: callsResult.data.map((c) => ({
        caller: c.caller ?? '',
        callee: c.callee ?? '',
      })),
    };

    const result = runRefactoringAnalysis(analysisInput, {
      extractionThreshold: threshold,
      detectResponsibilities: true,
    });

    return {
      file,
      totalFunctions: result.totalFunctions,
      extractionCandidates: result.extractionCandidates.map((c) => ({
        name: c.name,
        couplingScore: c.couplingScore,
        internalCalls: c.internalCalls,
        stateReads: c.stateReads,
        startLine: c.startLine,
        endLine: c.endLine,
      })),
      responsibilities: result.responsibilities.map((r) => ({
        name: r.name,
        functions: r.functions,
        extractionOrder: r.extractionOrder,
      })),
      averageCouplingScore: Math.round(result.averageCouplingScore * 10) / 10,
      couplingLevel: result.couplingLevel,
      summary: getRefactoringSummary(result),
    };
  }

  // ---------------------------------------------------------------
  // Consolidated Business Logic (Phase: Service Layer Consolidation)
  // ---------------------------------------------------------------

  /**
   * Scan files for security vulnerabilities.
   *
   * Consolidates the glob → readFile → parse → scan → sort pipeline
   * previously duplicated in MCP findVulnerabilities and API analyticsService.
   */
  async scanVulnerabilities(options?: ServiceScanOptions): Promise<ServiceScanResult> {
    const { readFile, stat: fsStat } = await import('node:fs/promises');
    const { glob } = await import('glob');

    const scope = options?.path || process.cwd();
    const extensions = options?.extensions ?? ['ts', 'tsx', 'js', 'jsx'];
    const extGlob = extensions.join(',');

    // Find files to scan
    let files: string[];
    try {
      const fileStat = await fsStat(scope);
      if (fileStat.isFile()) {
        files = [scope];
      } else {
        files = await glob(`**/*.{${extGlob}}`, {
          cwd: scope,
          absolute: true,
          ignore: ['**/node_modules/**', '**/dist/**', '**/build/**'],
        });
      }
    } catch {
      return {
        vulnerabilities: [],
        summary: { total: 0, bySeverity: {} },
        filesScanned: 0,
      };
    }

    // Initialize parser
    await initParser();

    const allFindings: SecurityFinding[] = [];
    let filesScanned = 0;

    const langMap: Record<string, 'typescript' | 'javascript' | 'tsx' | 'jsx'> = {
      ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
      mts: 'typescript', cts: 'typescript', mjs: 'javascript', cjs: 'javascript',
    };

    for (const filePath of files.slice(0, 200)) {
      try {
        const code = await readFile(filePath, 'utf-8');
        const ext = filePath.split('.').pop() ?? 'ts';
        const language = langMap[ext] ?? 'typescript';
        const tree = parseCode(code, language);

        const findings = scanForVulnerabilities(tree.rootNode, {
          filePath,
          includeLowSeverity: true,
        });
        allFindings.push(...findings);
        filesScanned++;
      } catch {
        // Skip files that fail to parse
      }
    }

    // Sort and optionally filter
    let sorted = sortBySeverity(allFindings);

    // Filter by severity if requested
    if (options?.severities && options.severities.length > 0) {
      const allowed = new Set(options.severities.map(s => s.toLowerCase()));
      sorted = sorted.filter(f => allowed.has(f.severity));
    }

    // Filter by category if requested
    if (options?.category && options.category !== 'all') {
      const cat = options.category.toLowerCase();
      sorted = sorted.filter(f => {
        const typeLC = f.type.toLowerCase();
        if (cat === 'injection') return typeLC.includes('injection');
        if (cat === 'xss') return typeLC.includes('xss');
        if (cat === 'auth') return typeLC.includes('auth') || typeLC.includes('password');
        if (cat === 'payment') return typeLC.includes('payment') || typeLC.includes('stripe');
        return true;
      });
    }

    // Map to service result format
    const vulnerabilities: ServiceVulnerability[] = sorted.map(f => ({
      type: f.type,
      severity: f.severity,
      message: f.description,
      filePath: f.file,
      line: f.line,
      column: f.column,
      code: f.code,
      recommendation: f.fix,
    }));

    // Summary
    const bySeverity: Record<string, number> = {};
    for (const v of vulnerabilities) {
      bySeverity[v.severity] = (bySeverity[v.severity] ?? 0) + 1;
    }

    return {
      vulnerabilities,
      summary: { total: vulnerabilities.length, bySeverity },
      filesScanned,
    };
  }

  /**
   * Analyze data flow in a file.
   *
   * Consolidates the readFile → parse → analyzeDataflow pipeline
   * previously duplicated in MCP traceDataFlow and API analyticsService.
   */
  async analyzeDataflowForFile(
    filePath: string,
    variable?: string,
  ): Promise<ServiceDataflowResult> {
    await initParser();

    const tree = await parseFile(filePath);
    const result: DataflowAnalysisResult = runDataflowAnalysis(
      tree.rootNode,
      filePath,
      { maxDepth: 10, includeSteps: true },
    );

    // Filter sources by variable if provided
    const matchingSources = variable
      ? result.sources.filter(
          s => s.pattern.includes(variable) || s.taintedVariable.includes(variable),
        )
      : result.sources;

    // Build paths from matching sources
    const relevantPaths = variable
      ? result.paths.filter(p =>
          matchingSources.some(s => s.taintedVariable === p.source.taintedVariable),
        )
      : result.paths;

    const paths = relevantPaths.map(p => ({
      source: `${p.source.pattern} (${p.source.taintedVariable})`,
      transformations: p.steps.map(s => `${s.name} [${s.transformation}]`),
      sink: p.sink ? `${p.sink.pattern} (${p.sink.category})` : 'unknown',
    }));

    const vulnerabilities = result.vulnerabilities.map(v => ({
      source: v.source.pattern,
      sink: v.sink.pattern,
      severity: v.severity,
      category: v.category,
    }));

    return {
      sources: matchingSources.map(s => ({
        pattern: s.pattern,
        variable: s.taintedVariable,
        category: s.category,
        line: s.line,
      })),
      sinks: result.sinks.map(s => ({
        pattern: s.pattern,
        category: s.category,
        line: s.line,
      })),
      paths,
      vulnerabilities,
      summary: `Found ${matchingSources.length} sources, ${result.sinks.length} sinks, ${result.vulnerabilities.length} potential vulnerabilities`,
    };
  }

  /**
   * Hybrid search — vector + text + graph traversal + knowledge graph.
   *
   * Consolidates the getGraphClient() + hybridSearch() orchestration
   * previously duplicated in MCP searchCode.
   */
  async hybridSearchCode(
    query: string,
    options?: {
      limit?: number;
      nodeTypes?: CodeNodeType[];
      includeKnowledge?: boolean;
      scope?: string;
    },
  ): Promise<HybridSearchResult> {
    const client = await getGraphClient();

    const opts: HybridSearchOptions = {
      limit: options?.limit ?? 30,
      includeKnowledge: options?.includeKnowledge ?? true,
      expandGraph: true,
      maxHops: 1,
      includeAboutEdges: true,
    };
    if (options?.nodeTypes) opts.nodeTypes = options.nodeTypes;
    if (options?.scope) opts.scope = options.scope;

    return hybridSearch(query, client, opts);
  }

  /**
   * Strategy-based search using the SearchRegistry.
   *
   * Consolidates the registry creation, SearchContext construction,
   * and LLM availability check previously duplicated in MCP searchCode
   * and askCode tools.
   */
  async strategySearch(
    query: string,
    strategy: string,
    options?: { limit?: number; scope?: string },
  ): Promise<SearchResponse> {
    const client = await getGraphClient();
    const context: SearchContext = { client };

    // Dynamically check for LLM availability
    try {
      const { isLLMAvailable, getLLMModel } = await import('@codegraph/plugin-nlp');
      if (isLLMAvailable()) {
        context.llm = await getLLMModel();
      }
    } catch {
      // plugin-nlp not available — strategies that require LLM will fail gracefully
    }

    const registry = createDefaultSearchRegistry();
    const searchType = strategy as SearchType;

    const request: { query: string; type: SearchType; limit?: number; scope?: string } = {
      query,
      type: searchType,
    };
    if (options?.limit) request.limit = options.limit;
    if (options?.scope && options.scope !== 'all') request.scope = options.scope;

    return registry.search(request, context);
  }

  /**
   * Get graph statistics (node/edge counts, largest files, etc.)
   *
   * Consolidates the connectGraph() + createQueries() + getStats() pattern
   * previously used by CLI status command.
   */
  async getGraphStats(): Promise<GraphStats> {
    const client = await getGraphClient();
    const queries = createQueries(client);
    return queries.getStats();
  }

  // ---------------------------------------------------------------
  // Graph Traversal (wraps @codegraph/graph queries)
  // ---------------------------------------------------------------

  /**
   * Get the full graph (nodes + edges), optionally filtered by root path.
   */
  async getFullGraph(limit?: number, rootPath?: string): Promise<GraphData> {
    const client = await getGraphClient();
    const queries = createQueries(client);
    return queries.getFullGraph(limit, rootPath);
  }

  /**
   * Get subgraph for a specific file: file node + contained entities + their relationships.
   */
  async getFileSubgraph(filePath: string): Promise<SubgraphData> {
    const client = await getGraphClient();
    const queries = createQueries(client);
    return queries.getFileSubgraph(filePath);
  }

  /**
   * Get import dependency tree from a file, up to the given depth.
   */
  async getDependencyTree(filePath: string, depth?: number): Promise<GraphData> {
    const client = await getGraphClient();
    const queries = createQueries(client);
    return queries.getDependencyTree(filePath, depth);
  }

  // ---------------------------------------------------------------
  // Context Building (wraps @codegraph/graph fileTree)
  // ---------------------------------------------------------------

  /**
   * Build a compact file tree string from the graph for LLM context.
   */
  async buildFileTree(options?: FileTreeOptions): Promise<string> {
    const client = await getGraphClient();
    return buildFileTree(client, options);
  }

  /**
   * Get a one-line stats summary (e.g. "Files: 42 | Functions: 120 | ...").
   */
  async getIndexSummary(): Promise<string> {
    const client = await getGraphClient();
    return getIndexSummary(client);
  }

  // ---------------------------------------------------------------
  // Project Management (wraps @codegraph/graph operations)
  // ---------------------------------------------------------------

  /**
   * Get all indexed projects from the graph.
   */
  async getProjects(): Promise<ProjectEntity[]> {
    const client = await getGraphClient();
    const ops = createOperations(client);
    return ops.getProjects();
  }

  /**
   * Delete a project and all its associated data.
   */
  async deleteProject(projectId: string): Promise<void> {
    const client = await getGraphClient();
    const ops = createOperations(client);
    await ops.deleteProject(projectId);
  }

  /**
   * Clear all nodes and edges from the graph.
   */
  async clearGraph(): Promise<void> {
    const client = await getGraphClient();
    const ops = createOperations(client);
    await ops.clearAll();
  }

  /**
   * Delete a file and all its contained entities from the graph.
   */
  async deleteFileEntities(filePath: string): Promise<void> {
    const client = await getGraphClient();
    const ops = createOperations(client);
    await ops.deleteFileEntities(filePath);
  }

  /**
   * Resolve a project ID to its root path.
   */
  async resolveProjectRootPath(projectId: string): Promise<string | undefined> {
    const projects = await this.getProjects();
    const project = projects.find(p => p.id === projectId);
    return project?.rootPath;
  }

  // ---------------------------------------------------------------
  // Raw Query Execution
  // ---------------------------------------------------------------

  /**
   * Execute a read-only Cypher query.
   */
  async executeReadQuery(
    cypherQuery: string,
    params: Record<string, unknown> = {},
  ): Promise<CypherResult> {
    const client = await getGraphClient();
    const result = await client.roQuery(cypherQuery, {
      params: params as Record<string, string | number | boolean | null | unknown[]>,
    });
    return {
      results: result.data ?? [],
      metadata: result.metadata ?? null,
    };
  }

  // ---------------------------------------------------------------
  // Entity & Traversal (replaces API model layer)
  // ---------------------------------------------------------------

  /**
   * Get an entity by ID with its incoming and outgoing connections.
   */
  async getEntityWithConnections(
    id: string,
    depth: number = 1,
  ): Promise<EntityWithConnections | null> {
    const client = await getGraphClient();
    const dialect = client.dialect;

    const result = await client.roQuery<{
      n: Record<string, unknown>;
      labels: string[];
      inEdge: Record<string, unknown> | null;
      inType: string | null;
      inNode: Record<string, unknown> | null;
      inLabels: string[] | null;
      outEdge: Record<string, unknown> | null;
      outType: string | null;
      outNode: Record<string, unknown> | null;
      outLabels: string[] | null;
    }>(`
      MATCH (n)
      WHERE elementId(n) = $id OR n.path = $id OR (n.name + ':' + n.filePath) = $id
      OPTIONAL MATCH (inNode)-[inEdge]->(n)
      OPTIONAL MATCH (n)-[outEdge]->(outNode)
      RETURN n, ${dialect.labelsExpr('n')} as labels,
             inEdge, ${dialect.typeExpr('inEdge')} as inType, inNode, ${dialect.labelsExpr('inNode')} as inLabels,
             outEdge, ${dialect.typeExpr('outEdge')} as outType, outNode, ${dialect.labelsExpr('outNode')} as outLabels
      LIMIT $depth
    `, { params: { id, depth: depth * 10 } });

    if (!result.data || result.data.length === 0) {
      return null;
    }

    const firstRow = result.data[0]!;
    const entity = {
      id,
      label: (firstRow.labels[0] ?? 'Unknown') as GraphNode['label'],
      displayName: (firstRow.n['name'] as string) ?? (firstRow.n['path'] as string) ?? 'unknown',
      filePath: (firstRow.n['filePath'] as string) ?? (firstRow.n['path'] as string),
      data: firstRow.n as unknown as GraphNode['data'],
    };

    const incomingEdges: GraphEdge[] = [];
    const outgoingEdges: GraphEdge[] = [];
    const seenEdges = new Set<string>();

    for (const row of result.data) {
      if (row.inEdge && row.inType && row.inNode) {
        const edgeId = `${row.inType}:in:${JSON.stringify(row.inNode)}`;
        if (!seenEdges.has(edgeId)) {
          seenEdges.add(edgeId);
          incomingEdges.push({
            id: edgeId,
            source: (row.inNode['name'] as string) ?? (row.inNode['path'] as string) ?? 'unknown',
            target: id,
            label: row.inType as GraphEdge['label'],
            data: row.inEdge as unknown as GraphEdge['data'],
          });
        }
      }

      if (row.outEdge && row.outType && row.outNode) {
        const edgeId = `${row.outType}:out:${JSON.stringify(row.outNode)}`;
        if (!seenEdges.has(edgeId)) {
          seenEdges.add(edgeId);
          outgoingEdges.push({
            id: edgeId,
            source: id,
            target: (row.outNode['name'] as string) ?? (row.outNode['path'] as string) ?? 'unknown',
            label: row.outType as GraphEdge['label'],
            data: row.outEdge as unknown as GraphEdge['data'],
          });
        }
      }
    }

    return {
      entity,
      connections: {
        incoming: incomingEdges,
        outgoing: outgoingEdges,
      },
    };
  }

  /**
   * Get paginated nodes with optional filtering by type, search query, and project path.
   */
  async getNodesPaginated(options: NodesQueryOptions = {}): Promise<PaginatedNodesResult> {
    const {
      page = 1,
      limit = 50,
      types,
      query,
      rootPath,
    } = options;

    const MAX_LIMIT = 100;
    const effectiveLimit = Math.min(limit, MAX_LIMIT);
    const skip = (page - 1) * effectiveLimit;
    const client = await getGraphClient();
    const dialect = client.dialect;

    const typeLabels = types && types.length > 0
      ? types
      : ['File', 'Function', 'Class', 'Interface', 'Variable', 'Type', 'Component'];

    const typeCondition = typeLabels.map(t => dialect.labelCheckExpr('n', t)).join(' OR ');

    const pathFilter = rootPath
      ? `AND (CASE WHEN ${dialect.labelCaseExpr('n', 'File')} THEN n.path ELSE n.filePath END) STARTS WITH $rootPath`
      : '';

    const searchFilter = query
      ? `AND (toLower(n.name) CONTAINS toLower($query) OR toLower(n.path) CONTAINS toLower($query))`
      : '';

    const countResult = await client.roQuery<{ total: number }>(`
      MATCH (n)
      WHERE (${typeCondition}) ${pathFilter} ${searchFilter}
      RETURN count(n) as total
    `, {
      params: { ...(rootPath && { rootPath }), ...(query && { query }) },
    });

    const totalCount = countResult.data?.[0]?.total ?? 0;
    const totalPages = Math.ceil(totalCount / effectiveLimit);

    const dataResult = await client.roQuery<{
      n: Record<string, unknown>;
      labels: string[];
    }>(`
      MATCH (n)
      WHERE (${typeCondition}) ${pathFilter} ${searchFilter}
      RETURN n, ${dialect.labelsExpr('n')} as labels
      ORDER BY CASE WHEN ${dialect.labelCaseExpr('n', 'File')} THEN n.path ELSE n.name END
      SKIP $skip
      LIMIT $limit
    `, {
      params: {
        skip,
        limit: effectiveLimit,
        ...(rootPath && { rootPath }),
        ...(query && { query }),
      },
    });

    const nodes: GraphNode[] = [];

    for (const row of dataResult.data ?? []) {
      const props = extractNodeProps(row.n);
      const label = getLabelFromLabels(row.labels);
      const nodeId = generateNodeId(label, props);

      nodes.push({
        id: nodeId,
        label,
        displayName: (props['name'] as string) ?? (props['path'] as string) ?? 'unknown',
        filePath: (props['filePath'] as string) ?? (props['path'] as string),
        data: props,
      } as unknown as GraphNode);
    }

    return {
      nodes,
      pagination: {
        page,
        limit: effectiveLimit,
        totalCount,
        totalPages,
        hasMore: page < totalPages,
      },
    };
  }

  /**
   * Get neighboring nodes with direction and edge type filtering.
   */
  async getNeighbors(
    id: string,
    direction: Direction = 'both',
    edgeTypes?: EdgeLabel[],
    depth: number = 1,
  ): Promise<NeighborsResult> {
    const client = await getGraphClient();
    const dialect = client.dialect;

    const isFileId = id.startsWith('File:');
    const actualPath = isFileId ? id.substring(5) : null;
    const parts = id.split(':');

    let cypherMatch: string;
    if (direction === 'in') {
      cypherMatch = '(neighbor)-[r]->(center)';
    } else if (direction === 'out') {
      cypherMatch = '(center)-[r]->(neighbor)';
    } else {
      cypherMatch = '(center)-[r]-(neighbor)';
    }

    const edgeTypeFilter = edgeTypes && edgeTypes.length > 0
      ? `AND ${dialect.typeExpr('r')} IN [${edgeTypes.map(t => `'${t}'`).join(', ')}]`
      : '';

    let centerMatch: string;
    const queryParams: {
      limit: number;
      actualPath?: string;
      filePath?: string;
      name?: string;
      line?: number;
      simpleId?: string;
    } = { limit: depth * 50 };

    if (isFileId && actualPath) {
      centerMatch = 'center.path = $actualPath';
      queryParams.actualPath = actualPath;
    } else if (parts.length >= 4) {
      centerMatch = '(center.filePath = $filePath AND center.name = $name AND (center.startLine = $line OR center.line = $line))';
      queryParams.filePath = parts[1] ?? '';
      queryParams.name = parts[2] ?? '';
      queryParams.line = parseInt(parts[3] ?? '0', 10) || 0;
    } else {
      centerMatch = '(center.name = $simpleId OR center.path = $simpleId)';
      queryParams.simpleId = id;
    }

    const result = await client.roQuery<{
      neighbor: Record<string, unknown>;
      neighborLabels: string[];
      r: Record<string, unknown>;
      rType: string;
    }>(`
      MATCH (center)
      WHERE ${centerMatch}
      MATCH ${cypherMatch}
      WHERE neighbor.path IS NOT NULL OR neighbor.name IS NOT NULL ${edgeTypeFilter}
      RETURN DISTINCT neighbor, ${dialect.labelsExpr('neighbor')} as neighborLabels, r, ${dialect.typeExpr('r')} as rType
      LIMIT $limit
    `, { params: queryParams });

    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const seenNodes = new Set<string>();
    const seenEdges = new Set<string>();

    for (const row of result.data ?? []) {
      const neighborProps = extractNodeProps(row.neighbor as Record<string, unknown>);
      const nodeLabel = (row.neighborLabels[0] ?? 'File') as NodeLabel;
      const nodeId = generateNodeId(nodeLabel, neighborProps);

      if (nodeId && !seenNodes.has(nodeId)) {
        seenNodes.add(nodeId);
        nodes.push({
          id: nodeId,
          label: nodeLabel,
          displayName: (neighborProps['name'] as string) ?? (neighborProps['path'] as string) ?? 'unknown',
          filePath: (neighborProps['filePath'] as string) ?? (neighborProps['path'] as string),
          data: neighborProps as unknown as GraphNode['data'],
        } as GraphNode);
      }

      const edgeId = `${row.rType}:${id}:${nodeId}`;
      if (!seenEdges.has(edgeId)) {
        seenEdges.add(edgeId);
        edges.push({
          id: edgeId,
          source: direction === 'in' ? nodeId : id,
          target: direction === 'in' ? id : nodeId,
          label: row.rType as EdgeLabel,
          data: row.r as unknown as GraphEdge['data'],
        } as GraphEdge);
      }
    }

    return { nodes, edges, centerId: id, direction };
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

/**
 * Shared CodeGraphService instance.
 * All consumers should use this singleton.
 */
export const codeGraphService = new CodeGraphServiceImpl();

/** Type alias for the service */
export type CodeGraphService = typeof codeGraphService;
