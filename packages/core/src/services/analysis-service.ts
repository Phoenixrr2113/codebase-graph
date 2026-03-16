/**
 * AnalysisService — impact, refactoring, security, context, and reporting methods.
 * @module services/analysis-service
 */

import { getGraphClient } from '../graphClient';
import { tokensToChars } from '../tokenEstimator';
import {
  analyzeImpact as runImpactAnalysis,
  getDirectCallersQuery,
  getTransitiveCallersQuery,
  getAffectedTestsQuery,
  getImpactSummary,
} from '../analysis';
import type { ImpactAnalysisInput } from '../analysis';
import {
  analyzeRefactoring as runRefactoringAnalysis,
  getExtractionCandidatesQuery,
  getInternalCallsQuery,
  getRefactoringSummary,
} from '../analysis';
import type { RefactoringAnalysisInput } from '../analysis';
import {
  scanForVulnerabilities,
  sortBySeverity,
  analyzeDataflow as runDataflowAnalysis,
} from '../analysis';
import type { SecurityFinding, DataflowAnalysisResult } from '../analysis';
import { initParser, parseCode, parseFile, registerPlugins } from '../pipeline';
import { labelOr } from './helpers';
import type {
  ServiceEntityContext,
  ServiceDependencyInfo,
  ServiceComplexityHotspot,
  ServiceComplexitySummary,
  ServiceProjectInfo,
  ServiceChangeInfo,
  ServiceImpactResult,
  ServiceRefactoringResult,
  ServiceScanOptions,
  ServiceScanResult,
  ServiceVulnerability,
  ServiceDataflowResult,
} from './types';

// ============================================================================
// Private types
// ============================================================================

interface RankedSymbol {
  name: string;
  kind: string;
  connections: number;
  complexity: number;
  line: number;
}

interface RankedFile {
  path: string;
  symbols: RankedSymbol[];
  totalConnections: number;
}

// ============================================================================
// Context & Explanation
// ============================================================================

/**
 * Get code explanation for a file: dependencies, dependents, tests, complexity.
 */
export async function getCodeExplanationImpl(
  filePath: string,
): Promise<{
  dependencies: ServiceDependencyInfo[];
  dependents: ServiceDependencyInfo[];
  relatedTests: string[];
  complexity?: number;
}> {
  const client = await getGraphClient();

  const importsQuery = `
    MATCH (f:File {filePath: $filePath})-[:CONTAINS]->(s)-[:IMPORTS]->(target)
    RETURN DISTINCT target.name as name, target.filePath as file, 1 as line, 'import' as type
    LIMIT 20
  `;

  const callersQuery = `
    MATCH (f:File {filePath: $filePath})-[:CONTAINS]->(fn:Function)<-[:CALLS]-(caller:Function)
    RETURN DISTINCT caller.name as name, caller.filePath as file, caller.startLine as line, 'call' as type
    LIMIT 20
  `;

  const testsQuery = `
    MATCH (f:File {filePath: $filePath})-[:CONTAINS]->(fn:Function)<-[:CALLS*]-(test:Function)
    WHERE test.filePath CONTAINS '.test.' OR test.filePath CONTAINS '.spec.'
    RETURN DISTINCT test.filePath as file
    LIMIT 10
  `;

  const complexityQuery = `
    MATCH (f:File {filePath: $filePath})-[:CONTAINS]->(fn:Function)
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
export async function getSymbolCallsImpl(name: string): Promise<Array<{ name: string; type: string; filePath: string }>> {
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
export async function getFunctionCallersImpl(name: string): Promise<Array<{ name: string; filePath: string; startLine?: number }>> {
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
export async function getSymbolDetailImpl(
  name: string,
  filePath: string,
): Promise<ServiceEntityContext | null> {
  const client = await getGraphClient();
  const dialect = client.dialect;
  const labelsExpr = dialect.labelsExpr('n');

  const cypher = `
    MATCH (n {name: $name})
    WHERE n.filePath CONTAINS $filePath
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

// ============================================================================
// Reporting
// ============================================================================

/**
 * Get complexity hotspots.
 */
export async function getComplexityHotspotsImpl(options?: {
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
           max(f.complexity) as complexity,
           max(coalesce(f.cognitiveComplexity, 0)) as cognitive,
           max(coalesce(f.nestingDepth, 0)) as nesting,
           max(CASE WHEN f.endLine IS NOT NULL AND f.startLine IS NOT NULL
                THEN f.endLine - f.startLine + 1 ELSE 0 END) as lines
    ORDER BY complexity DESC
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
export async function getIndexStatusImpl(repo?: string): Promise<{
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
export async function getRepoMapImpl(options?: {
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
export async function getSymbolHistoryImpl(
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
    MATCH (f:File {filePath: $filePath})-[r:MODIFIED_IN]->(c:Commit)
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

// ============================================================================
// Analysis
// ============================================================================

/**
 * Analyze impact of changing a symbol.
 */
export async function analyzeImpactImpl(
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
    client.roQuery<{ name: string; file: string }>(directCallersQ.cypher, { params: directCallersQ.params }),
    client.roQuery<{ name: string; file: string; depth: number }>(transitiveCallersQ.cypher, { params: transitiveCallersQ.params }),
    client.roQuery<{ name: string; file: string }>(testsQ.cypher, { params: testsQ.params }),
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
export async function analyzeRefactoringImpl(
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
    }>(candidatesQuery.cypher, { params: candidatesQuery.params }),
    client.roQuery<{ caller: string; callee: string }>(callsQuery.cypher, { params: callsQuery.params }),
  ]);

  const analysisInput: RefactoringAnalysisInput = {
    file,
    functions: functionsResult.data.map((f) => ({
      name: f.name ?? 'unknown',
      startLine: f.startLine ?? 0,
      endLine: f.endLine ?? 0,
      internalCalls: f.internalCalls ?? 0,
      stateReads: 0,
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

// ============================================================================
// Security & Dataflow
// ============================================================================

/**
 * Scan files for security vulnerabilities.
 */
export async function scanVulnerabilitiesImpl(options?: ServiceScanOptions): Promise<ServiceScanResult> {
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

  // Initialize parser and language plugins
  registerPlugins();
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
 */
export async function analyzeDataflowForFileImpl(
  filePath: string,
  variable?: string,
): Promise<ServiceDataflowResult> {
  registerPlugins();
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
