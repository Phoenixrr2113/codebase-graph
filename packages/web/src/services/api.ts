/**
 * API Service Client
 * Typed API client for CodeGraph endpoints
 */

import type { GraphData, GraphStats, ParseResult, SearchResult } from '@codegraph/types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface FetchOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined>;
}

async function fetchAPI<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { params, ...init } = options;
  
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

export async function getFullGraph(limit?: number): Promise<GraphData> {
  return fetchAPI<GraphData>('/api/graph/full', {
    params: { limit },
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
  return fetchAPI<GraphData>(`/api/graph/neighbors/${entityId}`, {
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
  ignore?: string[]
): Promise<ParseResult> {
  return fetchAPI<ParseResult>('/api/parse/project', {
    method: 'POST',
    body: JSON.stringify({ path, ignore }),
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
  },
  query: {
    cypher: executeCypher,
    natural: queryNatural,
  },
  search,
};
