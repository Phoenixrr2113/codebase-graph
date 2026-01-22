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

export async function queryNatural(question: string): Promise<{
  cypher: string;
  results: unknown[];
  explanation: string;
}> {
  return fetchAPI('/api/query/natural', {
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
    getStats,
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
  search,
  source: getSourceCode,
  projects: {
    list: getProjects,
    delete: deleteProject,
  },
};
