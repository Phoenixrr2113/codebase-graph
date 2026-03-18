/**
 * API Service Client
 * Typed API client for CodeGraph endpoints
 */

import type { GraphData, GraphStats, ParseResult, SearchResult } from '@codegraph/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

interface FetchOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
}

async function fetchAPI<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { params, ...init } = options;
  
  // Use relative URLs to work with Next.js proxy
  let url = `${API_BASE}${endpoint}`;
  
  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        searchParams.append(key, String(value));
      }
    });
    const queryString = searchParams.toString();
    if (queryString) {
      url += `?${queryString}`;
    }
  }

  const response = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || `API error: ${response.status}`);
  }

  return response.json();
}

// ============================================================================
// Graph Endpoints
// ============================================================================

export async function getFullGraph(limit?: number, projectId?: string): Promise<GraphData> {
  return fetchAPI<GraphData>('/api/graph/full', {
    params: { limit, projectId },
  });
}

export async function getFileSubgraph(filePath: string): Promise<GraphData> {
  const encodedPath = encodeURIComponent(filePath);
  return fetchAPI<GraphData>(`/api/graph/file/${encodedPath}`);
}

export async function getEntityWithConnections(
  entityId: string,
  depth: number = 1
): Promise<GraphData> {
  return fetchAPI<GraphData>(`/api/graph/entity/${entityId}`, {
    params: { depth },
  });
}

export async function getNeighbors(
  entityId: string,
  direction: 'in' | 'out' | 'both' = 'both',
  edgeTypes?: string[],
  depth: number = 1
): Promise<GraphData> {
  const encodedId = encodeURIComponent(entityId);
  return fetchAPI<GraphData>(`/api/neighbors/${encodedId}`, {
    params: {
      direction,
      edgeTypes: edgeTypes?.join(','),
      depth,
    },
  });
}

export async function getStats(): Promise<GraphStats> {
  return fetchAPI<GraphStats>('/api/stats');
}

// ============================================================================
// Parse Endpoints
// ============================================================================

export async function parseProject(
  path: string,
  ignore?: string[],
  deepAnalysis?: boolean,
  includeExternals?: boolean
): Promise<ParseResult> {
  return fetchAPI<ParseResult>('/api/parse/project', {
    method: 'POST',
    body: JSON.stringify({ path, ignore, deepAnalysis, includeExternals }),
  });
}

export async function parseFile(path: string): Promise<ParseResult> {
  return fetchAPI<ParseResult>('/api/parse/file', {
    method: 'POST',
    body: JSON.stringify({ path }),
  });
}

export async function deleteFile(path: string): Promise<{ success: boolean }> {
  return fetchAPI<{ success: boolean }>('/api/parse/file', {
    method: 'DELETE',
    body: JSON.stringify({ path }),
  });
}

export async function clearGraph(): Promise<{ success: boolean; message: string }> {
  return fetchAPI<{ success: boolean; message: string }>('/api/parse/clear', {
    method: 'DELETE',
  });
}

// ============================================================================
// Query Endpoints
// ============================================================================

export async function executeCypher(
  query: string,
  params?: Record<string, unknown>
): Promise<{ results: unknown[] }> {
  return fetchAPI<{ results: unknown[] }>('/api/query/cypher', {
    method: 'POST',
    body: JSON.stringify({ query, params }),
  });
}

export interface NaturalQueryResponse {
  question: string;
  cypher: string | null;
  results: Array<{
    name: string;
    nodeType: string;
    filePath?: string;
    startLine?: number;
    score: number;
    properties?: Record<string, unknown>;
  }>;
  explanation: string | null;
  /** Synthesized answer (if applicable) */
  answer: string | null;
  answerConfidence: number | null;
  answerSources: Array<{ nodeType: string; name: string; relevance: string }> | null;
  /** Which search strategy handled this query */
  routedTo: string | null;
  routingReason: string | null;
  total: number;
  durationMs: number;
}

export async function queryNatural(question: string): Promise<NaturalQueryResponse> {
  return fetchAPI<NaturalQueryResponse>('/api/query/natural', {
    method: 'POST',
    body: JSON.stringify({ question }),
  });
}

// ============================================================================
// Source Code Endpoint
// ============================================================================

export interface SourceCodeResponse {
  path: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  content: string;
  lines: Array<{ number: number; content: string }>;
}

export async function getSourceCode(
  path: string,
  startLine?: number,
  endLine?: number
): Promise<SourceCodeResponse> {
  return fetchAPI<SourceCodeResponse>('/api/source', {
    params: {
      path,
      startLine,
      endLine,
    },
  });
}

// ============================================================================
// Nodes Endpoint (Paginated)
// ============================================================================

import type { GraphNode, NodeLabel } from '@codegraph/types';

export interface Pagination {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
}

export interface NodesResponse {
  nodes: GraphNode[];
  pagination: Pagination;
}

export interface GetNodesOptions {
  page?: number | undefined;
  limit?: number | undefined;
  types?: NodeLabel[] | undefined;
  q?: string | undefined;
  projectId?: string | undefined;
}

export async function getNodes(options: GetNodesOptions = {}): Promise<NodesResponse> {
  const { page, limit, types, q, projectId } = options;
  return fetchAPI<NodesResponse>('/api/nodes', {
    params: {
      page,
      limit,
      types: types?.join(','),
      q,
      projectId,
    },
  });
}

// ============================================================================
// Search Endpoint
// ============================================================================

export async function search(
  query: string,
  types?: string[],
  limit: number = 20
): Promise<{ results: SearchResult[] }> {
  return fetchAPI<{ results: SearchResult[] }>('/api/search', {
    params: {
      q: query,
      types: types?.join(','),
      limit,
    },
  });
}

// ============================================================================
// Hybrid Search Endpoint
// ============================================================================

export interface HybridSearchHit {
  key: string;
  nodeType: string;
  name: string;
  filePath?: string;
  startLine?: number;
  score: number;
  sources: ('vector' | 'text' | 'graph')[];
  vectorDistance?: number;
  properties: Record<string, unknown>;
}

export interface HybridSearchResult {
  hits: HybridSearchHit[];
  relatedHits: Array<{
    sourceKey: string;
    nodeType: string;
    name: string;
    filePath?: string;
    relationship: string;
  }>;
  stats: {
    vectorHits: number;
    textHits: number;
    graphHits: number;
    totalBeforeDedup: number;
  };
}

export async function searchHybrid(
  query: string,
  options?: { limit?: number; nodeTypes?: string[]; includeKnowledge?: boolean; projectId?: string }
): Promise<HybridSearchResult> {
  return fetchAPI<HybridSearchResult>('/api/search/hybrid', {
    params: {
      q: query,
      limit: options?.limit,
      nodeTypes: options?.nodeTypes?.join(','),
      includeKnowledge: options?.includeKnowledge,
      projectId: options?.projectId,
    },
  });
}

// ============================================================================
// Embedding Stats Endpoint
// ============================================================================

export interface EmbeddingStats {
  totalWithEmbeddings: number;
  totalNodes: number;
  byType: Record<string, number>;
}

export async function getEmbeddingStats(): Promise<EmbeddingStats> {
  return fetchAPI<EmbeddingStats>('/api/stats/embeddings');
}

// ============================================================================
// Analytics Endpoints
// ============================================================================

// Analytics API responses are wrapped in { success: boolean; data: T }
interface ApiEnvelope<T> {
  success: boolean;
  data: T;
}

export interface AnalyticsSummary {
  projectPath: string;
  security: { total: number; critical: number; high: number; medium: number; low: number };
  complexity: { hotspots: number; avgComplexity: number; maxComplexity: number };
  refactoring?: { filesAnalyzed: number; extractionCandidates: number };
  dataflow?: { vulnerabilities: number; sources: number; sinks: number };
  lastFullScan?: string;
  cachedAt?: string;
}

export interface SecurityFinding {
  name: string;
  filePath?: string;
  severity: string;
  description?: string;
}

export interface SecurityAnalysisResult {
  findings: SecurityFinding[];
  summary: Record<string, number>;
  filesScanned: number;
  cachedAt?: string;
}

export interface ComplexityEntry {
  name: string;
  filePath?: string;
  complexity: number;
  cognitive?: number;
  nesting?: number;
  lines?: number;
}

export interface ComplexityResult {
  hotspots: ComplexityEntry[];
  avgComplexity: number;
  maxComplexity: number;
  cachedAt?: string;
}

export async function getAnalyticsSummary(projectPath: string): Promise<AnalyticsSummary> {
  const res = await fetchAPI<ApiEnvelope<AnalyticsSummary>>('/api/analytics/summary', {
    params: { path: projectPath },
  });
  return res.data;
}

export async function getSecurityAnalysis(projectPath: string, severity?: string): Promise<SecurityAnalysisResult> {
  const res = await fetchAPI<ApiEnvelope<SecurityAnalysisResult>>('/api/analytics/security', {
    params: { path: projectPath, severity },
  });
  return res.data;
}

export async function getComplexityHotspots(projectPath: string, minComplexity?: number): Promise<ComplexityResult> {
  const res = await fetchAPI<ApiEnvelope<ComplexityResult>>('/api/analytics/complexity', {
    params: { path: projectPath, minComplexity },
  });
  return res.data;
}

export async function getImpactAnalysis(symbol: string, depth?: number): Promise<unknown> {
  const res = await fetchAPI<ApiEnvelope<unknown>>(`/api/analytics/impact/${encodeURIComponent(symbol)}`, {
    params: { depth },
  });
  return res.data;
}

export async function runAnalysis(projectPath: string): Promise<unknown> {
  const res = await fetchAPI<ApiEnvelope<unknown>>('/api/analytics/run', {
    method: 'POST',
    body: JSON.stringify({ path: projectPath }),
  });
  return res.data;
}

// ============================================================================
// Projects Endpoints
// ============================================================================

import type { ProjectEntity } from '@codegraph/types';

export async function getProjects(): Promise<{ projects: ProjectEntity[] }> {
  return fetchAPI<{ projects: ProjectEntity[] }>('/api/projects');
}

export async function deleteProject(projectId: string): Promise<{ success: boolean }> {
  return fetchAPI<{ success: boolean }>(`/api/projects/${projectId}`, {
    method: 'DELETE',
  });
}

// ============================================================================
// Export all API functions
// ============================================================================

export const api = {
  graph: {
    getFull: getFullGraph,
    getFileSubgraph,
    getEntity: getEntityWithConnections,
    getNeighbors,
  },
  parse: {
    project: parseProject,
    file: parseFile,
    delete: deleteFile,
    clear: clearGraph,
  },
  query: {
    cypher: executeCypher,
    natural: queryNatural,
  },
  search: {
    text: search,
    hybrid: searchHybrid,
  },
  stats: {
    graph: getStats,
    embeddings: getEmbeddingStats,
  },
  analytics: {
    summary: getAnalyticsSummary,
    security: getSecurityAnalysis,
    complexity: getComplexityHotspots,
    impact: getImpactAnalysis,
    run: runAnalysis,
  },
  source: getSourceCode,
  projects: {
    list: getProjects,
    delete: deleteProject,
  },
};
