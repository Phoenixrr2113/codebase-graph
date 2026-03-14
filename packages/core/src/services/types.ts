/**
 * Shared types for CodeGraph service layer.
 * @module services/types
 */

import type { GraphNode, GraphEdge, NodeLabel } from '@codegraph/types';

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
