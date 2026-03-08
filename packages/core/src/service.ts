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
      limit?: number;
    },
  ): Promise<{ results: ServiceSearchResult[]; total: number; project?: string }> {
    const client = await getGraphClient();
    const dialect = client.dialect;
    const activePaths = await getActiveProjectPaths();
    const limit = options?.limit ?? 20;
    const type = options?.type ?? 'all';

    // Build type filter
    const typeFilter =
      type === 'all'
        ? `(${labelOr(dialect, 'n', ALL_LABELS)})`
        : dialect.labelCheckExpr('n', type.charAt(0).toUpperCase() + type.slice(1));

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
    const maxChars = (options?.maxTokens ?? 2048) * 4; // ~4 chars per token

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
