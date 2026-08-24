import type { GraphClient } from './client';
import type { HistoryCoverage, OwnershipInput, OwnershipResult } from '@codegraph/types';
import { resolve } from 'node:path';
import {
  AnalysisQueryInputError,
  createOwnershipQuery,
  normalizeAnalysisSince,
} from './ownership-queries';

export { AnalysisQueryInputError } from './ownership-queries';

const STATIC_ANALYSIS_CAVEATS = [
  'Results describe static graph relationships, not runtime behavior.',
  'Dynamic calls, reflection, event dispatch, dependency injection, and unresolved imports may be absent.',
  'Symbol import coverage currently omits namespace and default imports.',
] as const;

export interface BlastRadiusInput {
  id: string;
  /** Traversal depth. Defaults to 3 and is clamped to 1 through 10. */
  depth?: number;
  /** Maximum returned dependents. Defaults to 100 and is clamped to 1 through 1000. */
  limit?: number;
}

export interface NormalizedBlastRadiusInput {
  id: string;
  depth: number;
  limit: number;
}

export interface AnalysisSymbol {
  id: string;
  name: string;
  nodeType: string;
  filePath: string;
  startLine?: number;
}

export interface BlastRadiusItem extends AnalysisSymbol {
  depth: number;
}

export interface BlastRadiusResult {
  status: 'ok' | 'not_found';
  input: NormalizedBlastRadiusInput;
  projectRoot: string | null;
  target: AnalysisSymbol | null;
  items: BlastRadiusItem[];
  maxDepth: number;
  countsByDepth: Record<number, number>;
  countsByNodeType: Record<string, number>;
  truncated: boolean;
  caveats: string[];
}

export interface AnalysisQueries {
  getBlastRadius(input: BlastRadiusInput): Promise<BlastRadiusResult>;
  getImportCycles(input: ImportCyclesInput): Promise<ImportCyclesResult>;
  getCallHierarchy(input: CallHierarchyInput): Promise<CallHierarchyResult>;
  getUnreferencedExports(input: UnreferencedExportsInput): Promise<UnreferencedExportsResult>;
  getHotspots(input: HotspotsInput): Promise<HotspotsResult>;
  getChangeCoupling(input: ChangeCouplingInput): Promise<ChangeCouplingResult>;
  getOwnership(input: OwnershipInput): Promise<OwnershipResult>;
}

export interface ChangeCouplingInput {
  rootPath: string;
  since?: string;
  /** Minimum shared commits. Defaults to 2 and is clamped to 1 through 200. */
  minSupport?: number;
  /** Maximum returned pairs. Defaults to 50 and must be an integer from 1 through 500. */
  limit?: number;
}

export interface NormalizedChangeCouplingInput {
  rootPath: string;
  since: string | null;
  minSupport: number;
  limit: number;
}

export interface ChangeCouplingItem {
  leftFile: string;
  rightFile: string;
  coChanges: number;
  aChanges: number;
  bChanges: number;
  jaccard: number;
}

export interface ChangeCouplingResult {
  input: NormalizedChangeCouplingInput;
  projectRoot: string;
  items: ChangeCouplingItem[];
  candidateFileLimit: number;
  candidateFileLimitReached: boolean;
  truncated: boolean;
  historyCoverage: HistoryCoverage;
  caveats: string[];
}

export type HotspotScore = 'complexity' | 'degree';

export interface HotspotsInput {
  rootPath: string;
  since?: string;
  scoreBy?: HotspotScore;
  /** Maximum returned files. Defaults to 50 and must be an integer from 1 through 500. */
  limit?: number;
}

export interface NormalizedHotspotsInput {
  rootPath: string;
  since: string | null;
  scoreBy: HotspotScore;
  limit: number;
}

export interface HotspotItem {
  filePath: string;
  changeCount: number;
  churn: number;
  complexity: number;
  importDegree: number;
  complexityScore: number;
  degreeScore: number;
  score: number;
}

export interface HotspotsResult {
  input: NormalizedHotspotsInput;
  projectRoot: string;
  items: HotspotItem[];
  truncated: boolean;
  historyCoverage: HistoryCoverage;
  caveats: string[];
}

export interface UnreferencedExportsInput {
  rootPath: string;
  /** Maximum returned candidates. Defaults to 100 and is clamped to 1 through 1000. */
  limit?: number;
}

export interface NormalizedUnreferencedExportsInput {
  rootPath: string;
  limit: number;
}

export interface UnreferencedExportItem extends AnalysisSymbol {
  fileImporterCount: number;
  confidence: 'higher' | 'lower';
}

export interface UnreferencedExportsResult {
  input: NormalizedUnreferencedExportsInput;
  projectRoot: string;
  items: UnreferencedExportItem[];
  truncated: boolean;
  caveats: string[];
}

export type CallHierarchyDirection = 'callers' | 'callees' | 'both';

export interface CallHierarchyInput {
  id: string;
  direction?: CallHierarchyDirection;
  /** Maximum returned neighbors per direction. Defaults to 100 and is clamped to 1 through 1000. */
  limit?: number;
}

export interface NormalizedCallHierarchyInput {
  id: string;
  direction: CallHierarchyDirection;
  limit: number;
}

export interface CallHierarchyItem extends AnalysisSymbol {
  callLine?: number;
  count: number;
  via: string;
}

export interface CallHierarchyResult {
  status: 'ok' | 'not_found';
  input: NormalizedCallHierarchyInput;
  projectRoot: string | null;
  center: AnalysisSymbol | null;
  callers: CallHierarchyItem[];
  callees: CallHierarchyItem[];
  callersTruncated: boolean;
  calleesTruncated: boolean;
  caveats: string[];
}

export interface ImportCyclesInput {
  rootPath: string;
  /** Traversal depth. Defaults to 25 and is clamped to 2 through 25. */
  maxDepth?: number;
  /** Maximum returned canonical cycles. Defaults to 50 and is clamped to 1 through 500. */
  limit?: number;
}

export interface NormalizedImportCyclesInput {
  rootPath: string;
  maxDepth: number;
  limit: number;
}

export interface ImportCycle {
  filePaths: string[];
  length: number;
}

export interface ImportCyclesResult {
  input: NormalizedImportCyclesInput;
  projectRoot: string;
  cycles: ImportCycle[];
  candidateLimit: number;
  candidateLimitReached: boolean;
  truncated: boolean;
  caveats: string[];
}

interface BlastRadiusRow {
  targetId: string;
  targetName: string;
  targetNodeType: string;
  targetFilePath: string | null;
  targetStartLine: number | null;
  projectRoot: string | null;
  id: string | null;
  name: string | null;
  nodeType: string | null;
  filePath: string | null;
  startLine: number | null;
  depth: number | null;
}

interface CallHierarchyRow {
  centerId: string;
  centerName: string;
  centerNodeType: string;
  centerFilePath: string | null;
  centerStartLine: number | null;
  projectRoot: string | null;
  id: string | null;
  name: string | null;
  nodeType: string | null;
  filePath: string | null;
  startLine: number | null;
  callLine: number | null;
  count: number | null;
  via: string | null;
}

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), minimum), maximum);
}

function strictLimit(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new AnalysisQueryInputError(`limit must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function normalizeRootPath(rootPath: string): string {
  return resolve(rootPath);
}

function rootPathPrefix(rootPath: string): string {
  return rootPath === '/' ? '/' : `${rootPath}/`;
}

function historyCoverage(row: {
  commitCount?: number;
  earliestCommitDate?: string | null;
  latestCommitDate?: string | null;
  totalCommitCount?: number | null;
  historySince?: string | null;
  historyMaxCommits?: number | null;
  historyWindowSize?: number | null;
  historyTruncated?: boolean | null;
  historyComplete?: boolean | null;
} | undefined): HistoryCoverage {
  const historyMaxCommits = row?.historyMaxCommits ?? row?.historyWindowSize ?? null;
  return {
    commitCount: row?.commitCount ?? 0,
    earliestCommitDate: row?.earliestCommitDate ?? null,
    latestCommitDate: row?.latestCommitDate ?? null,
    totalCommitCount: row?.totalCommitCount ?? null,
    historySince: row?.historySince ?? null,
    historyMaxCommits,
    historyWindowSize: historyMaxCommits,
    historyTruncated: row?.historyTruncated === true,
    historyComplete: row?.historyComplete === true,
  };
}

function indexedHistoryCaveat(subject: string, coverage: HistoryCoverage): string {
  if (coverage.historyTruncated && coverage.historyWindowSize !== null) {
    return `${subject} use only the most recent ${coverage.historyWindowSize} commits indexed by the history sync.`;
  }
  if (coverage.historyComplete) {
    return `${subject} use the complete branch history available at the last history sync.`;
  }
  return `${subject} use indexed git history whose completeness could not be verified.`;
}

function canonicalCycle(filePaths: string[]): string[] {
  const cycle = filePaths.length > 1 && filePaths[0] === filePaths[filePaths.length - 1]
    ? filePaths.slice(0, -1)
    : [...filePaths];
  if (cycle.length < 1) return [];

  let best = cycle;
  let bestKey = cycle.join('\u0000');
  for (let index = 1; index < cycle.length; index += 1) {
    const rotation = [...cycle.slice(index), ...cycle.slice(0, index)];
    const key = rotation.join('\u0000');
    if (key < bestKey) {
      best = rotation;
      bestKey = key;
    }
  }
  return best;
}

function analysisSymbol(row: BlastRadiusRow): AnalysisSymbol {
  return {
    id: row.targetId,
    name: row.targetName,
    nodeType: row.targetNodeType,
    filePath: row.targetFilePath ?? '',
    ...(row.targetStartLine == null ? {} : { startLine: row.targetStartLine }),
  };
}

class AnalysisQueriesImpl implements AnalysisQueries {
  constructor(private readonly client: GraphClient) {}

  async getBlastRadius(input: BlastRadiusInput): Promise<BlastRadiusResult> {
    const depth = boundedInteger(input.depth, 3, 1, 10);
    const limit = boundedInteger(input.limit, 100, 1, 1_000);
    const normalizedInput: NormalizedBlastRadiusInput = { id: input.id, depth, limit };
    const result = await this.client.roQuery<BlastRadiusRow>(`
      MATCH (target)
      WHERE target.id = $id
      MATCH (project:Project)-[:HAS_FILE]->(:File)-[:CONTAINS]->(target)
      OPTIONAL MATCH p = (dependent)-[:CALLS|IMPORTS_SYMBOL|USES_TYPE|EXTENDS|IMPLEMENTS*1..${depth}]->(target)
      WHERE all(node IN nodes(p) WHERE node.filePath = project.rootPath
        OR node.filePath STARTS WITH CASE WHEN project.rootPath = '/' THEN '/' ELSE project.rootPath + '/' END)
      WITH target, project, dependent, min(length(p)) AS depth
      WHERE dependent IS NULL OR dependent.id IS NOT NULL
      RETURN target.id AS targetId,
             target.name AS targetName,
             labels(target)[0] AS targetNodeType,
             target.filePath AS targetFilePath,
             target.startLine AS targetStartLine,
             project.rootPath AS projectRoot,
             dependent.id AS id,
             dependent.name AS name,
             labels(dependent)[0] AS nodeType,
             dependent.filePath AS filePath,
             dependent.startLine AS startLine,
             depth
      ORDER BY depth, filePath, startLine, id
      LIMIT $rowLimit
    `, { params: { id: input.id, rowLimit: limit + 1 } });

    const rows = result.data ?? [];
    const first = rows[0];
    if (!first) {
      return {
        status: 'not_found',
        input: normalizedInput,
        projectRoot: null,
        target: null,
        items: [],
        maxDepth: depth,
        countsByDepth: {},
        countsByNodeType: {},
        truncated: false,
        caveats: [...STATIC_ANALYSIS_CAVEATS],
      };
    }

    const candidates = rows.filter((row): row is BlastRadiusRow & {
      id: string;
      name: string;
      nodeType: string;
      filePath: string;
      depth: number;
    } => row.id != null && row.name != null && row.nodeType != null && row.filePath != null && row.depth != null);
    const truncated = candidates.length > limit;
    const items: BlastRadiusItem[] = candidates.slice(0, limit).map((row) => ({
      id: row.id,
      name: row.name,
      nodeType: row.nodeType,
      filePath: row.filePath,
      ...(row.startLine == null ? {} : { startLine: row.startLine }),
      depth: row.depth,
    }));
    const countsByDepth: Record<number, number> = {};
    const countsByNodeType: Record<string, number> = {};
    for (const item of items) {
      countsByDepth[item.depth] = (countsByDepth[item.depth] ?? 0) + 1;
      countsByNodeType[item.nodeType] = (countsByNodeType[item.nodeType] ?? 0) + 1;
    }

    return {
      status: 'ok',
      input: normalizedInput,
      projectRoot: first.projectRoot,
      target: analysisSymbol(first),
      items,
      maxDepth: depth,
      countsByDepth,
      countsByNodeType,
      truncated,
      caveats: [...STATIC_ANALYSIS_CAVEATS],
    };
  }

  async getImportCycles(input: ImportCyclesInput): Promise<ImportCyclesResult> {
    const rootPath = normalizeRootPath(input.rootPath);
    const maxDepth = boundedInteger(input.maxDepth, 25, 2, 25);
    const limit = boundedInteger(input.limit, 50, 1, 500);
    const candidateLimit = Math.min(Math.max(limit * 20, 100), 5_000);
    const result = await this.client.roQuery<{ filePaths: string[]; length: number }>(`
      MATCH p = (start:File)-[:IMPORTS*1..${maxDepth}]->(start)
      WHERE NOT 'External' IN labels(start)
        AND (start.filePath = $rootPath OR start.filePath STARTS WITH $rootPathPrefix)
        AND all(n IN nodes(p) WHERE NOT 'External' IN labels(n)
          AND (n.filePath = $rootPath OR n.filePath STARTS WITH $rootPathPrefix))
      RETURN [n IN nodes(p) | n.filePath] AS filePaths,
             length(p) AS length
      ORDER BY length, filePaths
      LIMIT $candidateRowLimit
    `, {
      params: {
        rootPath,
        rootPathPrefix: rootPathPrefix(rootPath),
        candidateRowLimit: candidateLimit + 1,
      },
    });

    const rows = result.data ?? [];
    const candidateLimitReached = rows.length > candidateLimit;
    const cyclesByKey = new Map<string, ImportCycle>();
    for (const row of rows.slice(0, candidateLimit)) {
      const filePaths = canonicalCycle(row.filePaths);
      if (filePaths.length < 1) continue;
      const key = filePaths.join('\u0000');
      if (!cyclesByKey.has(key)) {
        cyclesByKey.set(key, { filePaths, length: filePaths.length });
      }
    }

    const canonicalCycles = [...cyclesByKey.values()].sort((left, right) => (
      left.length - right.length
      || left.filePaths.join('\u0000').localeCompare(right.filePaths.join('\u0000'))
    ));

    return {
      input: { rootPath, maxDepth, limit },
      projectRoot: rootPath,
      cycles: canonicalCycles.slice(0, limit),
      candidateLimit,
      candidateLimitReached,
      truncated: canonicalCycles.length > limit,
      caveats: [
        'Cycles include only imports resolved to File nodes by the language pipeline.',
        'External and unresolved import targets are excluded.',
      ],
    };
  }

  async getCallHierarchy(input: CallHierarchyInput): Promise<CallHierarchyResult> {
    const direction = input.direction ?? 'both';
    const limit = boundedInteger(input.limit, 100, 1, 1_000);
    const normalizedInput: NormalizedCallHierarchyInput = { id: input.id, direction, limit };

    const runDirection = async (requested: Exclude<CallHierarchyDirection, 'both'>): Promise<CallHierarchyRow[]> => {
      const relationshipPattern = requested === 'callers'
        ? '(neighbor)-[r:CALLS]->(center)'
        : '(center)-[r:CALLS]->(neighbor)';
      const result = await this.client.roQuery<CallHierarchyRow>(`
        MATCH (center)
        WHERE center.id = $id
        MATCH (project:Project)-[:HAS_FILE]->(:File)-[:CONTAINS]->(center)
        OPTIONAL MATCH ${relationshipPattern}
        WHERE neighbor.filePath = project.rootPath
          OR neighbor.filePath STARTS WITH CASE WHEN project.rootPath = '/' THEN '/' ELSE project.rootPath + '/' END
        RETURN center.id AS centerId,
               center.name AS centerName,
               labels(center)[0] AS centerNodeType,
               center.filePath AS centerFilePath,
               center.startLine AS centerStartLine,
               project.rootPath AS projectRoot,
               neighbor.id AS id,
               neighbor.name AS name,
               labels(neighbor)[0] AS nodeType,
               neighbor.filePath AS filePath,
               neighbor.startLine AS startLine,
               r.line AS callLine,
               coalesce(r.count, 1) AS count,
               coalesce(r.via, 'direct') AS via
        ORDER BY filePath, startLine, id
        LIMIT $rowLimit
      `, { params: { id: input.id, rowLimit: limit + 1 } });
      return result.data ?? [];
    };

    const [callerRows, calleeRows] = await Promise.all([
      direction === 'callees' ? Promise.resolve([]) : runDirection('callers'),
      direction === 'callers' ? Promise.resolve([]) : runDirection('callees'),
    ]);
    const first = callerRows[0] ?? calleeRows[0];

    const toItems = (rows: CallHierarchyRow[]): CallHierarchyItem[] => rows
      .filter((row): row is CallHierarchyRow & {
        id: string;
        name: string;
        nodeType: string;
        filePath: string;
      } => row.id != null && row.name != null && row.nodeType != null && row.filePath != null)
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        name: row.name,
        nodeType: row.nodeType,
        filePath: row.filePath,
        ...(row.startLine == null ? {} : { startLine: row.startLine }),
        ...(row.callLine == null ? {} : { callLine: row.callLine }),
        count: row.count ?? 1,
        via: row.via ?? 'direct',
      }));
    const callerCandidates = callerRows.filter((row) => row.id != null);
    const calleeCandidates = calleeRows.filter((row) => row.id != null);

    if (!first) {
      return {
        status: 'not_found',
        input: normalizedInput,
        projectRoot: null,
        center: null,
        callers: [],
        callees: [],
        callersTruncated: false,
        calleesTruncated: false,
        caveats: [...STATIC_ANALYSIS_CAVEATS],
      };
    }

    return {
      status: 'ok',
      input: normalizedInput,
      projectRoot: first.projectRoot,
      center: {
        id: first.centerId,
        name: first.centerName,
        nodeType: first.centerNodeType,
        filePath: first.centerFilePath ?? '',
        ...(first.centerStartLine == null ? {} : { startLine: first.centerStartLine }),
      },
      callers: toItems(callerRows),
      callees: toItems(calleeRows),
      callersTruncated: callerCandidates.length > limit,
      calleesTruncated: calleeCandidates.length > limit,
      caveats: [...STATIC_ANALYSIS_CAVEATS],
    };
  }

  async getUnreferencedExports(input: UnreferencedExportsInput): Promise<UnreferencedExportsResult> {
    const rootPath = normalizeRootPath(input.rootPath);
    const limit = boundedInteger(input.limit, 100, 1, 1_000);
    const result = await this.client.roQuery<{
      id: string;
      name: string;
      nodeType: string;
      filePath: string;
      startLine: number | null;
      fileImporterCount: number;
      confidence: 'higher' | 'lower';
    }>(`
      MATCH (f:File)-[:EXPORTS]->(symbol)
      WHERE f.filePath = $rootPath OR f.filePath STARTS WITH $rootPathPrefix
      OPTIONAL MATCH (source)-[r:IMPORTS_SYMBOL|CALLS|USES_TYPE|EXTENDS|IMPLEMENTS|RENDERS]->(symbol)
      WITH f, symbol, count(DISTINCT r) AS staticReferenceCount
      OPTIONAL MATCH (importer:File)-[:IMPORTS]->(f)
      WITH f, symbol, staticReferenceCount, count(DISTINCT importer) AS fileImporterCount
      WHERE staticReferenceCount = 0
      RETURN symbol.id AS id,
             symbol.name AS name,
             labels(symbol)[0] AS nodeType,
             symbol.filePath AS filePath,
             symbol.startLine AS startLine,
             fileImporterCount,
             CASE WHEN fileImporterCount = 0 THEN 'higher' ELSE 'lower' END AS confidence
      ORDER BY CASE WHEN fileImporterCount = 0 THEN 0 ELSE 1 END, filePath, startLine, id
      LIMIT $rowLimit
    `, {
      params: {
        rootPath,
        rootPathPrefix: rootPathPrefix(rootPath),
        rowLimit: limit + 1,
      },
    });

    const rows = result.data ?? [];
    return {
      input: { rootPath, limit },
      projectRoot: rootPath,
      items: rows.slice(0, limit).map((row) => ({
        id: row.id,
        name: row.name,
        nodeType: row.nodeType,
        filePath: row.filePath,
        ...(row.startLine == null ? {} : { startLine: row.startLine }),
        fileImporterCount: row.fileImporterCount,
        confidence: row.confidence,
      })),
      truncated: rows.length > limit,
      caveats: [
        'These are unreferenced export candidates, not proof that code is dead.',
        'Dynamic loading, frameworks, package APIs, reflection, dependency injection, namespace imports, and default imports may not appear as symbol references.',
        'A file-level importer lowers confidence because it may reach the export through an import form not represented by IMPORTS_SYMBOL.',
      ],
    };
  }

  async getHotspots(input: HotspotsInput): Promise<HotspotsResult> {
    const rootPath = normalizeRootPath(input.rootPath);
    const since = normalizeAnalysisSince(input.since);
    const scoreBy = input.scoreBy ?? 'complexity';
    const limit = strictLimit(input.limit, 50, 500);
    const params = {
      rootPath,
      rootPathPrefix: rootPathPrefix(rootPath),
      since,
    };
    const scoreColumn = scoreBy === 'degree' ? 'degreeScore' : 'complexityScore';

    const [hotspotsResult, coverageResult] = await Promise.all([
      this.client.roQuery<{
        filePath: string;
        changeCount: number;
        churn: number;
        complexity: number;
        importDegree: number;
        complexityScore: number;
        degreeScore: number;
      }>(`
        MATCH (f:File)-[m:MODIFIED_IN]->(c:Commit)
        WHERE (f.filePath = $rootPath OR f.filePath STARTS WITH $rootPathPrefix)
          AND ($since IS NULL OR c.date >= $since)
        WITH f,
             count(DISTINCT c) AS changeCount,
             sum(coalesce(m.linesAdded, 0) + coalesce(m.linesRemoved, 0)) AS churn
        OPTIONAL MATCH (f)-[:CONTAINS]->(fn:Function)
        WITH f, changeCount, churn, sum(coalesce(fn.complexity, 0)) AS complexity
        OPTIONAL MATCH (f)-[dep:IMPORTS]->()
        WITH f, changeCount, churn, complexity, count(DISTINCT dep) AS importDegree
        RETURN f.filePath AS filePath,
               changeCount,
               churn,
               coalesce(complexity, 0) AS complexity,
               importDegree,
               changeCount * (1 + coalesce(complexity, 0)) AS complexityScore,
               changeCount * (1 + importDegree) AS degreeScore
        ORDER BY ${scoreColumn} DESC, filePath
        LIMIT $rowLimit
      `, { params: { ...params, rowLimit: limit + 1 } }),
      this.client.roQuery<{
        commitCount: number;
        earliestCommitDate: string | null;
        latestCommitDate: string | null;
        totalCommitCount: number | null;
        historySince: string | null;
        historyMaxCommits: number | null;
        historyWindowSize: number | null;
        historyTruncated: boolean | null;
        historyComplete: boolean | null;
      }>(`
        MATCH (project:Project {rootPath: $rootPath})
        OPTIONAL MATCH (f:File)-[:MODIFIED_IN]->(c:Commit)
        WHERE (f.filePath = $rootPath OR f.filePath STARTS WITH $rootPathPrefix)
          AND ($since IS NULL OR c.date >= $since)
        RETURN count(DISTINCT c) AS commitCount,
               min(c.date) AS earliestCommitDate,
               max(c.date) AS latestCommitDate,
               project.gitHistoryTotalCommits AS totalCommitCount,
               project.gitHistorySince AS historySince,
               coalesce(project.gitHistoryMaxCommits, project.gitHistoryWindowSize) AS historyMaxCommits,
               coalesce(project.gitHistoryMaxCommits, project.gitHistoryWindowSize) AS historyWindowSize,
               project.gitHistoryTruncated AS historyTruncated,
               project.gitHistoryComplete AS historyComplete
      `, { params }),
    ]);

    const rows = hotspotsResult.data ?? [];
    const coverage = historyCoverage(coverageResult.data?.[0]);
    return {
      input: { rootPath, since, scoreBy, limit },
      projectRoot: rootPath,
      items: rows.slice(0, limit).map((row) => ({
        ...row,
        score: scoreBy === 'degree' ? row.degreeScore : row.complexityScore,
      })),
      truncated: rows.length > limit,
      historyCoverage: coverage,
      caveats: [
        indexedHistoryCaveat('Scores', coverage),
        'Complexity is the current sum for contained functions, not historical complexity at each commit.',
        'A hotspot score prioritizes review and does not prove a defect.',
      ],
    };
  }

  async getChangeCoupling(input: ChangeCouplingInput): Promise<ChangeCouplingResult> {
    const rootPath = normalizeRootPath(input.rootPath);
    const since = normalizeAnalysisSince(input.since);
    const minSupport = boundedInteger(input.minSupport, 2, 1, 200);
    const limit = strictLimit(input.limit, 50, 500);
    const coverageParams = {
      rootPath,
      rootPathPrefix: rootPathPrefix(rootPath),
      since,
    };
    const candidateFileLimit = 500;
    const candidateResult = await this.client.roQuery<{ filePath: string }>(`
      MATCH (f:File)-[:MODIFIED_IN]->(c:Commit)
      WHERE (f.filePath = $rootPath OR f.filePath STARTS WITH $rootPathPrefix)
        AND ($since IS NULL OR c.date >= $since)
      RETURN DISTINCT f.filePath AS filePath
      ORDER BY filePath
      LIMIT $candidateRowLimit
    `, {
      params: {
        ...coverageParams,
        candidateRowLimit: candidateFileLimit + 1,
      },
    });
    const candidateRows = candidateResult.data ?? [];
    const candidateFileLimitReached = candidateRows.length > candidateFileLimit;
    const candidateFiles = candidateRows.slice(0, candidateFileLimit).map((row) => row.filePath);

    const [couplingResult, coverageResult] = await Promise.all([
      this.client.roQuery<ChangeCouplingItem>(`
        MATCH (a:File)-[:MODIFIED_IN]->(c:Commit)<-[:MODIFIED_IN]-(b:File)
        WHERE a.filePath < b.filePath
          AND a.filePath IN $candidateFiles
          AND b.filePath IN $candidateFiles
          AND (a.filePath = $rootPath OR a.filePath STARTS WITH $rootPathPrefix)
          AND (b.filePath = $rootPath OR b.filePath STARTS WITH $rootPathPrefix)
          AND ($since IS NULL OR c.date >= $since)
        WITH a, b, count(DISTINCT c) AS coChanges
        WHERE coChanges >= $minSupport
        OPTIONAL MATCH (a)-[:MODIFIED_IN]->(ca:Commit)
        WHERE $since IS NULL OR ca.date >= $since
        WITH a, b, coChanges, count(DISTINCT ca) AS aChanges
        OPTIONAL MATCH (b)-[:MODIFIED_IN]->(cb:Commit)
        WHERE $since IS NULL OR cb.date >= $since
        WITH a, b, coChanges, aChanges, count(DISTINCT cb) AS bChanges
        RETURN a.filePath AS leftFile,
               b.filePath AS rightFile,
               coChanges,
               aChanges,
               bChanges,
               (1.0 * coChanges) / (aChanges + bChanges - coChanges) AS jaccard
        ORDER BY jaccard DESC, coChanges DESC, leftFile, rightFile
        LIMIT $rowLimit
      `, {
        params: {
          ...coverageParams,
          candidateFiles,
          minSupport,
          rowLimit: limit + 1,
        },
      }),
      this.client.roQuery<{
        commitCount: number;
        earliestCommitDate: string | null;
        latestCommitDate: string | null;
        totalCommitCount: number | null;
        historySince: string | null;
        historyMaxCommits: number | null;
        historyWindowSize: number | null;
        historyTruncated: boolean | null;
        historyComplete: boolean | null;
      }>(`
        MATCH (project:Project {rootPath: $rootPath})
        OPTIONAL MATCH (f:File)-[:MODIFIED_IN]->(c:Commit)
        WHERE (f.filePath = $rootPath OR f.filePath STARTS WITH $rootPathPrefix)
          AND ($since IS NULL OR c.date >= $since)
        RETURN count(DISTINCT c) AS commitCount,
               min(c.date) AS earliestCommitDate,
               max(c.date) AS latestCommitDate,
               project.gitHistoryTotalCommits AS totalCommitCount,
               project.gitHistorySince AS historySince,
               coalesce(project.gitHistoryMaxCommits, project.gitHistoryWindowSize) AS historyMaxCommits,
               coalesce(project.gitHistoryMaxCommits, project.gitHistoryWindowSize) AS historyWindowSize,
               project.gitHistoryTruncated AS historyTruncated,
               project.gitHistoryComplete AS historyComplete
      `, { params: coverageParams }),
    ]);

    const rows = couplingResult.data ?? [];
    const coverage = historyCoverage(coverageResult.data?.[0]);
    return {
      input: { rootPath, since, minSupport, limit },
      projectRoot: rootPath,
      items: rows.slice(0, limit),
      candidateFileLimit,
      candidateFileLimitReached,
      truncated: rows.length > limit,
      historyCoverage: coverage,
      caveats: [
        'Co-change is correlation, not proof of a dependency.',
        'Merge commits, bulk formatting, generated files, and repository moves can inflate coupling.',
        indexedHistoryCaveat('Results', coverage),
        'Pair generation is bounded to the first 500 history-bearing files in normalized path order.',
      ],
    };
  }

  async getOwnership(input: OwnershipInput): Promise<OwnershipResult> {
    return createOwnershipQuery(this.client)(input);
  }
}

export function createAnalysisQueries(client: GraphClient): AnalysisQueries {
  return new AnalysisQueriesImpl(client);
}
