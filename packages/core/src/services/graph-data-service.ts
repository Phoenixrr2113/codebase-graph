/**
 * GraphDataService — graph traversal, entity access, and project management.
 * @module services/graph-data-service
 */

import { getGraphClient } from '../graphClient';
import { createQueries, createOperations, buildFileTree as buildFileTreeFromGraph, getIndexSummary as getIndexSummaryFromGraph } from '@codegraph/graph';
import type {
  FileTreeOptions,
  SymbolReferenceQuery,
  SymbolReferencesResult,
} from '@codegraph/graph';
import type { GraphStats, GraphData, SubgraphData, GraphNode, GraphEdge, NodeLabel, EdgeLabel } from '@codegraph/types';
import type { ProjectEntity } from '@codegraph/types';
import { labelOr, ALL_LABELS, extractNodeProps, getLabelFromLabels, generateNodeId } from './helpers';
import type {
  EntityWithConnections,
  PaginatedNodesResult,
  NodesQueryOptions,
  Direction,
  NeighborsResult,
  CypherResult,
} from './types';

// ============================================================================
// Graph Stats
// ============================================================================

/**
 * Get graph statistics (node/edge counts, largest files, etc.)
 */
export async function getGraphStatsImpl(): Promise<GraphStats> {
  const client = await getGraphClient();
  const queries = createQueries(client);
  return queries.getStats();
}

// ============================================================================
// Graph Traversal (wraps @codegraph/graph queries)
// ============================================================================

/**
 * Get the full graph (nodes + edges), optionally filtered by root path.
 */
export async function getFullGraphImpl(limit?: number, rootPath?: string): Promise<GraphData> {
  const client = await getGraphClient();
  const queries = createQueries(client);
  return queries.getFullGraph(limit, rootPath);
}

/**
 * Get subgraph for a specific file: file node + contained entities + their relationships.
 */
export async function getFileSubgraphImpl(filePath: string): Promise<SubgraphData> {
  const client = await getGraphClient();
  const queries = createQueries(client);
  return queries.getFileSubgraph(filePath);
}

/**
 * Find where a symbol is used: callers, type users, subclasses, implementers
 * and renderers that point at the declaration.
 */
export async function getSymbolReferencesImpl(
  query: SymbolReferenceQuery,
): Promise<SymbolReferencesResult> {
  const client = await getGraphClient();
  const queries = createQueries(client);
  return queries.getSymbolReferences(query);
}

/**
 * Get import dependency tree from a file, up to the given depth.
 */
export async function getDependencyTreeImpl(filePath: string, depth?: number): Promise<GraphData> {
  const client = await getGraphClient();
  const queries = createQueries(client);
  return queries.getDependencyTree(filePath, depth);
}

// ============================================================================
// Context Building (wraps @codegraph/graph fileTree)
// ============================================================================

/**
 * Build a compact file tree string from the graph for LLM context.
 */
export async function buildFileTreeImpl(options?: FileTreeOptions): Promise<string> {
  const client = await getGraphClient();
  return buildFileTreeFromGraph(client, options);
}

/**
 * Get a one-line stats summary (e.g. "Files: 42 | Functions: 120 | ...").
 */
export async function getIndexSummaryImpl(): Promise<string> {
  const client = await getGraphClient();
  return getIndexSummaryFromGraph(client);
}

// ============================================================================
// Project Management (wraps @codegraph/graph operations)
// ============================================================================

/**
 * Get all indexed projects from the graph.
 */
export async function getProjectsImpl(): Promise<ProjectEntity[]> {
  const client = await getGraphClient();
  const ops = createOperations(client);
  return ops.getProjects();
}

/**
 * Delete a project and all its associated data.
 */
export async function deleteProjectImpl(projectId: string): Promise<void> {
  const client = await getGraphClient();
  const ops = createOperations(client);
  await ops.deleteProject(projectId);
}

/**
 * Clear all nodes and edges from the graph.
 */
export async function clearGraphImpl(): Promise<void> {
  const client = await getGraphClient();
  const ops = createOperations(client);
  await ops.clearAll();
}

/**
 * Smart file removal (PERF.4) — removes file and its entities while
 * preserving incoming cross-file edges (CALLS, EXTENDS, IMPLEMENTS).
 */
export async function removeFileAndCleanupImpl(filePath: string): Promise<void> {
  const client = await getGraphClient();
  const ops = createOperations(client);
  await ops.removeFileAndCleanup(filePath);
}

/**
 * Resolve a project ID to its root path.
 */
export async function resolveProjectRootPathImpl(projectId: string): Promise<string | undefined> {
  const projects = await getProjectsImpl();
  const project = projects.find(p => p.id === projectId);
  return project?.rootPath;
}

// ============================================================================
// Raw Query Execution
// ============================================================================

/**
 * Execute a read-only Cypher query.
 */
export async function executeReadQueryImpl(
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

// ============================================================================
// Entity & Traversal (replaces API model layer)
// ============================================================================

/**
 * Get an entity by ID with its incoming and outgoing connections.
 */
export async function getEntityWithConnectionsImpl(
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
    WHERE n.filePath = $id OR (n.name + ':' + n.filePath) = $id
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
export async function getNodesPaginatedImpl(options: NodesQueryOptions = {}): Promise<PaginatedNodesResult> {
  const {
    page = 1,
    limit = 50,
    types,
    query,
    rootPath,
  } = options;

  const MAX_LIMIT = 100;
  const safeLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
  const offset = (page - 1) * safeLimit;

  const client = await getGraphClient();
  const dialect = client.dialect;
  const labelsExpr = dialect.labelsExpr('n');

  // Build WHERE conditions
  const conditions: string[] = [];
  const params: Record<string, string | number | boolean | null | Array<unknown>> = {};

  // Type filter
  if (types && types.length > 0) {
    conditions.push(`(${labelOr(dialect, 'n', types)})`);
  } else {
    conditions.push(`(${labelOr(dialect, 'n', ALL_LABELS)})`);
  }

  // Search query filter
  if (query) {
    conditions.push('(toLower(n.name) CONTAINS toLower($query) OR toLower(n.filePath) CONTAINS toLower($query))');
    params.query = query;
  }

  // Project path filter
  if (rootPath) {
    conditions.push('n.filePath STARTS WITH $rootPath');
    params.rootPath = rootPath;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Count query
  const countCypher = `MATCH (n) ${whereClause} RETURN count(n) as total`;
  const countResult = await client.roQuery<{ total: number }>(countCypher, { params });
  const totalCount = countResult.data[0]?.total ?? 0;

  // Data query with pagination
  const dataCypher = `
    MATCH (n) ${whereClause}
    RETURN n, ${labelsExpr} as labels
    SKIP $offset
    LIMIT $limit
  `;

  const dataResult = await client.roQuery<{
    n: Record<string, unknown>;
    labels: string | string[];
  }>(dataCypher, { params: { ...params, offset, limit: safeLimit } });

  const nodes: GraphNode[] = (dataResult.data ?? []).map((row) => {
    const normalized = dialect.normalizeNode(row.n);
    const props = normalized.properties;
    const labelsArr = Array.isArray(row.labels)
      ? row.labels
      : typeof row.labels === 'string'
        ? [row.labels]
        : normalized.labels;
    const nodeLabel = getLabelFromLabels(labelsArr);
    const nodeId = generateNodeId(nodeLabel, props);

    return {
      id: nodeId,
      label: nodeLabel,
      displayName: (props['name'] as string) ?? (props['filePath'] as string) ?? 'unknown',
      filePath: (props['filePath'] as string),
      data: props as unknown as GraphNode['data'],
    } as GraphNode;
  });

  const totalPages = Math.ceil(totalCount / safeLimit);

  return {
    nodes,
    pagination: {
      page,
      limit: safeLimit,
      totalCount,
      totalPages,
      hasMore: page < totalPages,
    },
  };
}

/**
 * Get neighbors of a node by ID with configurable direction and depth.
 */
export async function getNeighborsImpl(
  id: string,
  direction: Direction = 'both',
  edgeTypes?: string[],
  depthArg: number = 1,
): Promise<NeighborsResult> {
  const depth = Math.min(depthArg, 3);

  const client = await getGraphClient();
  const dialect = client.dialect;

  // Validate edge types
  const VALID_EDGE_TYPES = new Set([
    'CONTAINS', 'IMPORTS', 'CALLS', 'EXTENDS', 'IMPLEMENTS',
    'RENDERS', 'MODIFIED_IN', 'DEPENDS_ON', 'ABOUT',
  ]);
  const safeEdgeTypes = edgeTypes?.filter(t => VALID_EDGE_TYPES.has(t));

  // Build edge type filter (parameterized for SEC safety)
  let edgeTypeFilter = '';
  if (safeEdgeTypes && safeEdgeTypes.length > 0) {
    edgeTypeFilter = `AND ${dialect.typeExpr('r')} IN $edgeTypes`;
  }

  // Build direction-specific match
  let cypherMatch: string;
  if (direction === 'in') {
    cypherMatch = '(neighbor)-[r]->(center)';
  } else if (direction === 'out') {
    cypherMatch = '(center)-[r]->(neighbor)';
  } else {
    cypherMatch = '(center)-[r]-(neighbor)';
  }

  // Parse node ID to build center match
  const parts = id.split(':');
  const isFileId = parts[0] === 'File';
  const actualPath = isFileId ? parts.slice(1).join(':') : undefined;

  let centerMatch: string;
  const queryParams: Record<string, string | number | boolean | null | Array<unknown>> = { limit: depth * 50 };
  if (safeEdgeTypes && safeEdgeTypes.length > 0) {
    queryParams.edgeTypes = safeEdgeTypes;
  }

  if (isFileId && actualPath) {
    centerMatch = 'center.filePath = $actualPath';
    queryParams.actualPath = actualPath;
  } else if (parts.length >= 4) {
    centerMatch = '(center.filePath = $filePath AND center.name = $name AND (center.startLine = $line OR center.line = $line))';
    queryParams.filePath = parts[1] ?? '';
    queryParams.name = parts[2] ?? '';
    queryParams.line = parseInt(parts[3] ?? '0', 10) || 0;
  } else {
    centerMatch = '(center.name = $simpleId OR center.filePath = $simpleId)';
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
    WHERE neighbor.filePath IS NOT NULL OR neighbor.name IS NOT NULL ${edgeTypeFilter}
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
