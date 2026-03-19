/**
 * Shared types for CodeGraph service layer.
 * @module services/types
 */

import type { GraphNode, GraphEdge, NodeLabel } from '@codegraph/types';

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

