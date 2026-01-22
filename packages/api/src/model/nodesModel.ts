/**
 * Nodes model - Paginated node queries for sidebar
 * @module model/nodesModel
 */

import type { GraphNode, NodeLabel } from '@codegraph/types';
import { getClient } from './graphClient';

/**
 * Pagination metadata
 */
export interface Pagination {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasMore: boolean;
}

/**
 * Paginated nodes result
 */
export interface PaginatedNodesResult {
  nodes: GraphNode[];
  pagination: Pagination;
}

/**
 * Query options for paginated nodes
 */
export interface NodesQueryOptions {
  page?: number | undefined;
  limit?: number | undefined;
  types?: NodeLabel[] | undefined;
  query?: string | undefined;
  projectId?: string | undefined;
  rootPath?: string | undefined;
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

/**
 * Helper to generate node ID from properties
 */
function generateNodeId(label: NodeLabel, props: Record<string, unknown>): string {
  if (label === 'File') {
    return `File:${props['path'] ?? ''}`;
  }
  const name = props['name'] ?? '';
  const filePath = props['filePath'] ?? '';
  const line = props['startLine'] ?? props['line'] ?? 0;
  return `${label}:${filePath}:${name}:${line}`;
}

/**
 * Helper to get valid label from FalkorDB labels array
 */
function getLabelFromLabels(labels: string[]): NodeLabel {
  const validLabels: NodeLabel[] = [
    'File', 'Function', 'Class', 'Interface', 'Variable', 'Type', 'Component', 'Import'
  ];
  const found = labels.find(l => validLabels.includes(l as NodeLabel));
  return (found as NodeLabel) ?? 'File';
}

/**
 * Extract node properties from FalkorDB result
 */
function extractNodeProps(node: Record<string, unknown>): Record<string, unknown> {
  if (node['properties'] && typeof node['properties'] === 'object') {
    return node['properties'] as Record<string, unknown>;
  }
  return node;
}

/**
 * Get paginated nodes with optional filtering
 */
export async function getNodes(options: NodesQueryOptions = {}): Promise<PaginatedNodesResult> {
  const {
    page = 1,
    limit = DEFAULT_LIMIT,
    types,
    query,
    rootPath,
  } = options;

  const effectiveLimit = Math.min(limit, MAX_LIMIT);
  const skip = (page - 1) * effectiveLimit;
  const client = await getClient();

  // Build type filter
  const typeLabels = types && types.length > 0
    ? types
    : ['File', 'Function', 'Class', 'Interface', 'Variable', 'Type', 'Component'];

  const typeCondition = typeLabels.map(t => `n:${t}`).join(' OR ');

  // Build path filter for project scoping
  const pathFilter = rootPath
    ? `AND (CASE WHEN n:File THEN n.path ELSE n.filePath END) STARTS WITH $rootPath`
    : '';

  // Build search filter
  const searchFilter = query
    ? `AND (toLower(n.name) CONTAINS toLower($query) OR toLower(n.path) CONTAINS toLower($query))`
    : '';

  // Count query
  const countQuery = `
    MATCH (n)
    WHERE (${typeCondition}) ${pathFilter} ${searchFilter}
    RETURN count(n) as total
  `;

  const countResult = await client.roQuery<{ total: number }>(countQuery, {
    params: { ...(rootPath && { rootPath }), ...(query && { query }) },
  });

  const totalCount = countResult.data?.[0]?.total ?? 0;
  const totalPages = Math.ceil(totalCount / effectiveLimit);

  // Data query with pagination
  const dataQuery = `
    MATCH (n)
    WHERE (${typeCondition}) ${pathFilter} ${searchFilter}
    RETURN n, labels(n) as labels
    ORDER BY CASE WHEN n:File THEN n.path ELSE n.name END
    SKIP $skip
    LIMIT $limit
  `;

  const dataResult = await client.roQuery<{
    n: Record<string, unknown>;
    labels: string[];
  }>(dataQuery, {
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
    const id = generateNodeId(label, props);

    nodes.push({
      id,
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
