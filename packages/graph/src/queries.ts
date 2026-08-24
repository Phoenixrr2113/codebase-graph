/**
 * @codegraph/graph - Query Operations
 * Graph query functions for retrieving and searching graph data
 * Based on CodeGraph MVP Specification Section 6.2
 */

import type { GraphClient } from './client';
import type { CypherDialect } from './driver';
import { deriveEntityId } from './knowledge-operations';
import { trace } from '@codegraph/logger';
import { REFERENCEABLE_LABELS, SYMBOL_LABELS, resolveNodeLabel } from '@codegraph/types';
import type {
  GraphData,
  GraphNode,
  GraphEdge,
  SubgraphData,
  GraphStats,
  NodeLabel,
  EdgeLabel,
} from '@codegraph/types';

// ============================================================================
// Type Guards and Helpers
// ============================================================================

type DashboardNodeLabel = NodeLabel | 'Entity' | 'TypeRef';

type FileSubgraphIdentityError = {
  labels: string[];
  edgeType: string;
  message: string;
};

type FileSubgraphResult = SubgraphData & {
  identityErrors?: FileSubgraphIdentityError[];
};

function getLabelFromLabels(labels: string[]): DashboardNodeLabel {
  if (labels.includes('Entity')) {
    return 'Entity';
  }
  if (labels.includes('TypeRef')) {
    return 'TypeRef';
  }

  // resolveNodeLabel is the shared classifier (packages/types/src/labels.ts):
  // it walks `labels` in DB order and returns the first recognized
  // NodeLabel value. This is also what lets the External check below win
  // over nothing: a specific valid label (File, Interface, etc.) always
  // takes priority, so an External File node still returns 'File', not
  // the 'Class' fallback for pure External nodes.
  const found = resolveNodeLabel(labels);
  if (found) {
    return found;
  }

  // Fallback for pure External nodes (like external classes with no other label)
  if (labels.includes('External')) {
    return 'Class' as NodeLabel;
  }

  return 'File';
}

/**
 * Extract node properties using the dialect normalizer.
 * Falls back to direct access for backward compatibility.
 */
function extractNodeProps(node: Record<string, unknown>, dialect?: CypherDialect): Record<string, unknown> {
  if (dialect) {
    return dialect.normalizeNode(node).properties;
  }
  // Legacy FalkorDB format: { properties: {...} }
  if (node['properties'] && typeof node['properties'] === 'object') {
    return node['properties'] as Record<string, unknown>;
  }
  return node;
}

/**
 * Extract labels using the dialect normalizer.
 * Falls back to direct access for backward compatibility.
 */
function extractLabels(node: Record<string, unknown>, providedLabels: string[], dialect?: CypherDialect): string[] {
  if (dialect) {
    const normalized = dialect.normalizeNode(node);
    return normalized.labels.length > 0 ? normalized.labels : providedLabels;
  }
  // Legacy FalkorDB format
  if (node['labels'] && Array.isArray(node['labels'])) {
    return node['labels'] as string[];
  }
  return providedLabels;
}

function projectDashboardValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(projectDashboardValue);
  if (value === null || typeof value !== 'object') return value;

  const projected: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === 'embedding' || key === 'embeddingTextHash') continue;
    projected[key] = projectDashboardValue(child);
  }
  return projected;
}

function projectDashboardProperties(props: Record<string, unknown>): Record<string, unknown> {
  return projectDashboardValue(props) as Record<string, unknown>;
}

function persistedNodeId(props: Record<string, unknown>, label?: DashboardNodeLabel): string {
  if (label === 'File') {
    const filePath = typeof props['filePath'] === 'string' ? props['filePath'] : '';
    return `File:${filePath}`;
  }
  if (label === 'Commit') {
    const hash = typeof props['hash'] === 'string' ? props['hash'] : '';
    if (hash.length > 0) return `Commit:${hash}`;
  }
  const id = props['id'];
  if (typeof id === 'string' && id.length > 0) {
    return id;
  }
  if (label === 'Entity') {
    const text = typeof props['text'] === 'string' ? props['text'] : '';
    const type = typeof props['type'] === 'string' ? props['type'] : '';
    return deriveEntityId(text, type);
  }
  throw new Error('Graph node is missing a persisted id');
}

function isMissingPersistedNodeIdError(error: unknown): error is Error {
  return error instanceof Error && error.message === 'Graph node is missing a persisted id';
}

function nodeToGraphNode(node: Record<string, unknown>, labels: string[], dialect?: CypherDialect): GraphNode {
  const actualLabels = extractLabels(node, labels, dialect);
  const props = extractNodeProps(node, dialect);
  const label = getLabelFromLabels(actualLabels);
  const id = persistedNodeId(props, label);
  const dashboardProps = projectDashboardProperties(props);

  return {
    id,
    label,
    displayName: (props['name'] as string) ?? (props['filePath'] as string) ?? (props['text'] as string) ?? (props['hash'] as string) ?? 'unknown',
    filePath: (props['filePath'] as string),
    data: dashboardProps,
  } as unknown as GraphNode;
}

function nodeToGraphWindowNode(
  node: Record<string, unknown>,
  labels: string[],
  degree: number,
  dialect?: CypherDialect,
): GraphWindowNode {
  const actualLabels = extractLabels(node, labels, dialect);
  const props = extractNodeProps(node, dialect);
  const label = getLabelFromLabels(actualLabels);
  const filePath = typeof props['filePath'] === 'string' ? props['filePath'] : undefined;
  const rawStartLine = props['startLine'] ?? props['line'];
  const startLine = typeof rawStartLine === 'number' ? rawStartLine : undefined;
  const symbolCount = label === 'File' && typeof props['symbolCount'] === 'number'
    ? props['symbolCount']
    : undefined;

  const projectedNode = {
    id: persistedNodeId(props, label),
    label,
    displayName: (props['name'] as string) ?? filePath ?? (props['text'] as string) ?? 'unknown',
    ...(filePath !== undefined ? { filePath } : {}),
    ...(startLine !== undefined ? { startLine } : {}),
    degree,
    ...(symbolCount !== undefined ? { symbolCount } : {}),
  } as GraphWindowNode;

  // The CLI map command still reads data.path from the in-process result.
  // Keep that compatibility field non-enumerable so JSON API payloads expose
  // only the canvas projection above.
  Object.defineProperty(projectedNode, 'data', {
    configurable: false,
    enumerable: false,
    value: { path: filePath ?? '' },
    writable: false,
  });

  return projectedNode;
}

function edgeToGraphEdge(
  fromNode: Record<string, unknown>,
  toNode: Record<string, unknown>,
  edgeType: string,
  edgeProps: Record<string, unknown>,
  fromLabels: string[],
  toLabels: string[],
): GraphEdge {
  const fromId = persistedNodeId(fromNode, getLabelFromLabels(fromLabels));
  const toId = persistedNodeId(toNode, getLabelFromLabels(toLabels));
  const dashboardProps = projectDashboardProperties(edgeProps);

  return {
    id: JSON.stringify([edgeType, fromId, toId]),
    source: fromId,
    target: toId,
    label: edgeType as EdgeLabel,
    data: {
      type: edgeType,
      from: fromId,
      to: toId,
      ...dashboardProps,
    },
  } as GraphEdge;
}

function projectedWindowEdge(source: string, target: string, label: string): GraphWindowEdge {
  const edge = { source, target, label: label as EdgeLabel } as GraphWindowEdge;
  Object.defineProperties(edge, {
    id: {
      configurable: false,
      enumerable: false,
      value: JSON.stringify([label, source, target]),
      writable: false,
    },
    data: {
      configurable: false,
      enumerable: false,
      value: { type: label, from: source, to: target },
      writable: false,
    },
  });
  return edge;
}

// ============================================================================
// Cypher Template Builders (dialect-aware)
// ============================================================================

function buildCypherTemplates(dialect: CypherDialect) {
  const labelsExpr = dialect.labelsExpr;
  const firstLabel = dialect.firstLabelExpr;
  const typeExpr = dialect.typeExpr;
  const lc = dialect.labelCheckExpr.bind(dialect);

  /** Build OR-separated label checks for WHERE clauses */
  function labelOr(alias: string, labels: string[]): string {
    return labels.map(l => lc(alias, l)).join(' OR ');
  }

  function stableNodeId(alias: string): string {
    return `CASE WHEN ${lc(alias, 'File')} THEN 'File:' + ${alias}.filePath ELSE coalesce(${alias}.id, ${alias}.text, ${alias}.name, toString(id(${alias}))) END`;
  }

  return {
    GET_FULL_GRAPH_NODES: (rootPath?: string) => {
      const dashboardLabels = [...REFERENCEABLE_LABELS, 'Entity'];
      if (rootPath) {
        const withinRoot = (alias: string) =>
          `(${alias}.filePath = $rootPath OR ${alias}.filePath STARTS WITH $rootPathPrefix)`;

        return `
          MATCH (n)
          WHERE (${labelOr('n', dashboardLabels)})
          OPTIONAL MATCH (n)-[:ABOUT]->(aboutTarget)
          OPTIONAL MATCH (n)-[:RELATES_TO]-(related:Entity)-[:ABOUT]->(relatedTarget)
          WITH n, aboutTarget, relatedTarget
          WHERE (
            (NOT (${lc('n', 'Entity')}) AND ${withinRoot('n')})
            OR (${lc('n', 'Entity')} AND (
              ${withinRoot('aboutTarget')} OR ${withinRoot('relatedTarget')}
            ))
          )
          WITH DISTINCT n, ${stableNodeId('n')} AS stableId
          ORDER BY CASE WHEN ${lc('n', 'External')} THEN 1 ELSE 0 END
          WITH stableId, head(collect(n)) AS n
          WITH n, stableId, coalesce(n.degree, 0) AS degree
          RETURN n, ${labelsExpr('n')} as labels, id(n) as nodeIdentity, degree
          ORDER BY degree DESC, stableId ASC
          SKIP $offset
          LIMIT $limit
        `;
      }

      return `
        MATCH (n)
        WHERE (${labelOr('n', dashboardLabels)})
        WITH n, ${stableNodeId('n')} AS stableId
        ORDER BY CASE WHEN ${lc('n', 'External')} THEN 1 ELSE 0 END
        WITH stableId, head(collect(n)) AS n
        WITH n, stableId, coalesce(n.degree, 0) AS degree
        RETURN n, ${labelsExpr('n')} as labels, id(n) as nodeIdentity, degree
        ORDER BY degree DESC, stableId ASC
        SKIP $offset
        LIMIT $limit
      `;
    },

    GET_FULL_GRAPH_TOTALS: (rootPath?: string) => {
      const dashboardLabels = [...REFERENCEABLE_LABELS, 'Entity'];
      if (rootPath) {
        const withinRoot = (alias: string) =>
          `(${alias}.filePath = $rootPath OR ${alias}.filePath STARTS WITH $rootPathPrefix)`;

        return `
          MATCH (n)
          WHERE (${labelOr('n', dashboardLabels)})
          OPTIONAL MATCH (n)-[:ABOUT]->(aboutTarget)
          OPTIONAL MATCH (n)-[:RELATES_TO]-(related:Entity)-[:ABOUT]->(relatedTarget)
          WITH n, aboutTarget, relatedTarget
          WHERE (
            (NOT (${lc('n', 'Entity')}) AND ${withinRoot('n')})
            OR (${lc('n', 'Entity')} AND (
              ${withinRoot('aboutTarget')} OR ${withinRoot('relatedTarget')}
            ))
          )
          WITH DISTINCT n, ${stableNodeId('n')} AS stableId
          ORDER BY CASE WHEN ${lc('n', 'External')} THEN 1 ELSE 0 END
          WITH stableId, head(collect(n)) AS n
          RETURN count(*) AS totalNodes
        `;
      }

      return `
        MATCH (n)
        WHERE (${labelOr('n', dashboardLabels)})
        WITH n, ${stableNodeId('n')} AS stableId
        ORDER BY CASE WHEN ${lc('n', 'External')} THEN 1 ELSE 0 END
        WITH stableId, head(collect(n)) AS n
        RETURN count(*) AS totalNodes
      `;
    },

    GET_SCOPED_ENTITY_IDENTITIES: (rootPath?: string) => {
      if (!rootPath) {
        return 'MATCH (n:Entity) RETURN collect(id(n)) AS nodeIdentities';
      }
      const withinRoot = (alias: string) =>
        `(${alias}.filePath = $rootPath OR ${alias}.filePath STARTS WITH $rootPathPrefix)`;
      return `
        MATCH (n:Entity)
        OPTIONAL MATCH (n)-[:ABOUT]->(aboutTarget)
        OPTIONAL MATCH (n)-[:RELATES_TO]-(related:Entity)-[:ABOUT]->(relatedTarget)
        WITH n, aboutTarget, relatedTarget
        WHERE ${withinRoot('aboutTarget')} OR ${withinRoot('relatedTarget')}
        RETURN collect(DISTINCT id(n)) AS nodeIdentities
      `;
    },

    GET_SHADOWED_EXTERNAL_IDENTITIES: (rootPath?: string) => {
      const scope = rootPath
        ? 'AND (stub.filePath = $rootPath OR stub.filePath STARTS WITH $rootPathPrefix)'
        : '';
      return `
        MATCH (stub:File:External)
        WHERE true ${scope}
        MATCH (canonical:File {filePath: stub.filePath})
        WHERE NOT canonical:External
        RETURN collect(DISTINCT id(stub)) AS nodeIdentities
      `;
    },

    GET_FULL_GRAPH_EDGE_TOTAL: (rootPath?: string) => {
      const dashboardLabels = [...REFERENCEABLE_LABELS, 'Entity'];
      const excluded = (alias: string) => `NOT id(${alias}) IN $excludedNodeIdentities`;
      if (!rootPath) {
        return `
          MATCH (a)-[r]->(b)
          WHERE (${labelOr('a', dashboardLabels)}) AND ${excluded('a')}
            AND (${labelOr('b', dashboardLabels)}) AND ${excluded('b')}
          RETURN count(r) AS totalEdges
        `;
      }

      const codeLabels = [...REFERENCEABLE_LABELS];
      const withinRoot = (alias: string) =>
        `(${alias}.filePath = $rootPath OR ${alias}.filePath STARTS WITH $rootPathPrefix)`;
      const inScope = (alias: string) => `(
        ((${labelOr(alias, codeLabels)}) AND ${withinRoot(alias)})
        OR id(${alias}) IN $entityNodeIdentities
      )`;
      return `
        MATCH (a)-[r]->(b)
        WHERE ${inScope('a')} AND ${excluded('a')}
          AND ${inScope('b')} AND ${excluded('b')}
        RETURN count(r) AS totalEdges
      `;
    },

    GET_FILE_GRAPH_NODES: (rootPath?: string, includeExternals = true) => {
      const fileScope = (alias: string) => rootPath
        ? `(${alias}.filePath = $rootPath OR ${alias}.filePath STARTS WITH $rootPathPrefix)`
        : 'true';
      const visibleFile = (alias: string) => includeExternals
        ? fileScope(alias)
        : `(${fileScope(alias)}) AND NOT (${lc(alias, 'External')})`;

      return `
        MATCH (f:File)
        WHERE ${visibleFile('f')}
        OPTIONAL MATCH (f)-[:CONTAINS]->(symbol)
        WHERE (${labelOr('symbol', [...SYMBOL_LABELS])})
        WITH f, count(DISTINCT symbol) AS symbolCount
        OPTIONAL MATCH (f)-[degreeEdge:IMPORTS]-(connected:File)
        WHERE ${visibleFile('connected')}
        WITH f, symbolCount, count(DISTINCT degreeEdge) AS degree,
             'File:' + f.filePath AS stableId
        ORDER BY CASE WHEN ${lc('f', 'External')} THEN 1 ELSE 0 END
        WITH stableId,
             head(collect(f)) AS f,
             head(collect(symbolCount)) AS symbolCount,
             head(collect(degree)) AS degree
        RETURN f, symbolCount, id(f) AS nodeIdentity
        ORDER BY degree DESC, stableId ASC
        SKIP $offset
        LIMIT $limit
      `;
    },

    GET_SELECTED_GRAPH_NODES: (rootPath?: string) => {
      const dashboardLabels = [...REFERENCEABLE_LABELS, 'Entity'];
      const requestedId = (alias: string) => `(
        (${lc(alias, 'File')} AND ('File:' + ${alias}.filePath) IN $ids)
        OR (NOT (${lc(alias, 'File')}) AND ${alias}.id IN $ids)
      )`;
      if (rootPath) {
        const withinRoot = (alias: string) =>
          `(${alias}.filePath = $rootPath OR ${alias}.filePath STARTS WITH $rootPathPrefix)`;
        return `
          MATCH (n)
          WHERE (${labelOr('n', dashboardLabels)}) AND ${requestedId('n')}
          OPTIONAL MATCH (n)-[:ABOUT]->(aboutTarget)
          OPTIONAL MATCH (n)-[:RELATES_TO]-(related:Entity)-[:ABOUT]->(relatedTarget)
          WITH n, aboutTarget, relatedTarget
          WHERE (
            (NOT (${lc('n', 'Entity')}) AND ${withinRoot('n')})
            OR (${lc('n', 'Entity')} AND (
              ${withinRoot('aboutTarget')} OR ${withinRoot('relatedTarget')}
            ))
          )
          WITH DISTINCT n, ${stableNodeId('n')} AS stableId
          ORDER BY CASE WHEN ${lc('n', 'External')} THEN 1 ELSE 0 END
          WITH stableId, head(collect(n)) AS n
          RETURN n, ${labelsExpr('n')} AS labels
        `;
      }

      return `
        MATCH (n)
        WHERE (${labelOr('n', dashboardLabels)}) AND ${requestedId('n')}
        WITH n, ${stableNodeId('n')} AS stableId
        ORDER BY CASE WHEN ${lc('n', 'External')} THEN 1 ELSE 0 END
        WITH stableId, head(collect(n)) AS n
        RETURN n, ${labelsExpr('n')} AS labels
      `;
    },

    GET_FILE_GRAPH_NODE_TOTAL: (rootPath?: string, includeExternals = true) => {
      const predicates = rootPath
        ? ['(f.filePath = $rootPath OR f.filePath STARTS WITH $rootPathPrefix)']
        : [];
      if (!includeExternals) predicates.push(`NOT (${lc('f', 'External')})`);
      const where = predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : '';
      return `MATCH (f:File) ${where} RETURN count(DISTINCT f.filePath) AS totalNodes`;
    },

    GET_FILE_GRAPH_EDGE_TOTAL: (rootPath?: string, includeExternals = true) => {
      const predicates = rootPath
        ? [
          '(a.filePath = $rootPath OR a.filePath STARTS WITH $rootPathPrefix)',
          '(b.filePath = $rootPath OR b.filePath STARTS WITH $rootPathPrefix)',
        ]
        : [];
      if (!includeExternals) {
        predicates.push(`NOT (${lc('a', 'External')})`, `NOT (${lc('b', 'External')})`);
      }
      const where = predicates.length > 0 ? `WHERE ${predicates.join(' AND ')}` : '';
      return `MATCH (a:File)-[r:IMPORTS]->(b:File) ${where} RETURN count(r) AS totalEdges`;
    },

    GET_FILE_GRAPH_EDGES: `
      MATCH (a:File)-[r:IMPORTS]->(b:File)
      WHERE id(a) IN $nodeIdentities AND id(b) IN $nodeIdentities
      RETURN a, r, b, 'IMPORTS' AS edgeType,
             ${labelsExpr('a')} AS fromLabels, ${labelsExpr('b')} AS toLabels
    `,

    GET_NODE_BY_PERSISTED_ID: `
      MATCH (center)
      WHERE (center.id = $id OR (${lc('center', 'File')} AND 'File:' + center.filePath = $id))
        AND (${labelOr('center', [...REFERENCEABLE_LABELS, 'Entity'])})
      RETURN center, ${labelsExpr('center')} AS labels, id(center) AS nodeIdentity
      LIMIT 1
    `,

    GET_NODE_NEIGHBORS: (direction: 'incoming' | 'outgoing') => {
      const pattern = direction === 'incoming'
        ? '(neighbor)-[]->(center)'
        : '(center)-[]->(neighbor)';
      return `
        MATCH (center)
        WHERE (center.id = $id OR (${lc('center', 'File')} AND 'File:' + center.filePath = $id))
        MATCH ${pattern}
        WHERE (${labelOr('neighbor', [...REFERENCEABLE_LABELS, 'Entity'])})
        WITH DISTINCT neighbor, ${stableNodeId('neighbor')} AS stableId
        RETURN neighbor, ${labelsExpr('neighbor')} AS labels, id(neighbor) AS nodeIdentity
        ORDER BY stableId ASC
        LIMIT $fetchLimit
      `;
    },

    GET_FULL_GRAPH_EDGES: `
        MATCH (a)-[r]->(b)
        WHERE id(a) IN $nodeIdentities
          AND id(b) IN $nodeIdentities
        RETURN a, r, b, ${typeExpr('r')} as edgeType,
               ${labelsExpr('a')} as fromLabels, ${labelsExpr('b')} as toLabels
      `,

    GET_FULL_GRAPH_WINDOW_EDGES: (sourceLabel: string) => {
      const sourceIdentity = sourceLabel === 'File' ? 'a.filePath' : 'a.id';
      return `
        MATCH (a:${sourceLabel})
        WHERE ${sourceIdentity} IN $sourceIds
          AND NOT id(a) IN $excludedNodeIdentities
        MATCH (a)-[r]->(b)
        WHERE ((b:File AND b.filePath IN $filePaths) OR b.id IN $persistedIds)
          AND NOT id(b) IN $excludedNodeIdentities
        RETURN ${stableNodeId('a')} AS source,
               ${stableNodeId('b')} AS target,
               ${typeExpr('r')} AS label
      `;
    },

    GET_FILE_SUBGRAPH: `
      MATCH (f:File {filePath: $filePath})-[:CONTAINS]->(e)
      OPTIONAL MATCH (e)-[r]-(related)
      RETURN f, e, r, related, ${labelsExpr('e')} as labels, ${labelsExpr('related')} as relatedLabels, ${typeExpr('r')} as edgeType
    `,

    GET_FILE_CONTAINED_SYMBOLS: `
      MATCH (:File {filePath: $filePath})-[:CONTAINS]->(n)
      WHERE (${labelOr('n', [...SYMBOL_LABELS])})
      RETURN DISTINCT n, ${labelsExpr('n')} as labels
      LIMIT $limit
    `,

    GET_FILE_IMPORTS: `
      MATCH (:File {filePath: $filePath})-[:IMPORTS]->(n:File)
      RETURN DISTINCT n, ${labelsExpr('n')} as labels
      LIMIT $limit
    `,

    GET_FILE_IMPORTERS: `
      MATCH (n:File)-[:IMPORTS]->(:File {filePath: $filePath})
      RETURN DISTINCT n, ${labelsExpr('n')} as labels
      LIMIT $limit
    `,

    GET_FILE_KNOWLEDGE_ENTITIES: `
      MATCH (n:Entity)-[:ABOUT]->(target)
      WHERE target.filePath = $filePath
      RETURN DISTINCT n, ${labelsExpr('n')} as labels
      LIMIT $limit
    `,

    COUNT_FILE_CONTAINED_SYMBOLS: `
      MATCH (:File {filePath: $filePath})-[:CONTAINS]->(n)
      WHERE (${labelOr('n', [...SYMBOL_LABELS])})
      RETURN count(DISTINCT n) AS total
    `,

    COUNT_FILE_IMPORTS: `
      MATCH (:File {filePath: $filePath})-[:IMPORTS]->(n:File)
      RETURN count(DISTINCT n) AS total
    `,

    COUNT_FILE_IMPORTERS: `
      MATCH (n:File)-[:IMPORTS]->(:File {filePath: $filePath})
      RETURN count(DISTINCT n) AS total
    `,

    COUNT_FILE_KNOWLEDGE_ENTITIES: `
      MATCH (n:Entity)-[:ABOUT]->(target)
      WHERE target.filePath = $filePath
      RETURN count(DISTINCT n) AS total
    `,

    GET_DEPENDENCY_TREE: `
      MATCH path = (root:File {filePath: $filePath})-[:IMPORTS*1..$depth]->(dep:File)
      RETURN path
    `,

    // Unfiltered on purpose. Restricting this to the seven code labels meant the
    // other six entries in nodesByType could never be anything but zero, so a
    // graph holding 200 commits still reported Commit: 0, and totalNodes counted
    // only part of the graph while being named for all of it.
    GET_STATS_NODES: `
      MATCH (n)
      RETURN ${firstLabel('n')} as label, count(n) as count
    `,

    GET_STATS_EDGES: `
      MATCH ()-[r]->()
      RETURN ${typeExpr('r')} as label, count(r) as count
    `,

    GET_LARGEST_FILES: `
      MATCH (f:File)-[:CONTAINS]->(e)
      RETURN f.filePath as path, count(e) as entityCount
      ORDER BY entityCount DESC
      LIMIT 10
    `,

    GET_MOST_CONNECTED: `
      MATCH (n)-[r]-()
      WHERE ${labelOr('n', ['Function', 'Class', 'Component'])}
      RETURN n.name as name, n.filePath as filePath, count(r) as connectionCount
      ORDER BY connectionCount DESC
      LIMIT 10
    `,
  };
}

// ============================================================================
// Symbol references
// ============================================================================

/** Edge kinds that mean "this code uses that symbol". */
export const REFERENCE_EDGE_TYPES = [
  'CALLS',
  'USES_TYPE',
  'EXTENDS',
  'IMPLEMENTS',
  'RENDERS',
] as const;

export type ReferenceEdgeType = (typeof REFERENCE_EDGE_TYPES)[number];

/** One place a symbol is used, and how. */
export interface SymbolReference {
  /** Persisted opaque id of the referencing symbol. */
  id: string;
  /** Name of the referencing symbol. */
  name: string;
  nodeType: string;
  filePath: string;
  startLine?: number | undefined;
  edgeType: ReferenceEdgeType;
  /** True when the reference lives in the same file as the declaration. */
  sameFile: boolean;
}

export interface SymbolReferencesResult {
  references: SymbolReference[];
  /** Files other than the declaring file that contain at least one reference. */
  referencingFiles: string[];
  /** True when the result hit the limit and more references exist. */
  truncated: boolean;
}

export interface SymbolReferenceQuery {
  /** Persisted opaque id of the declaration being referenced. */
  id: string;
  limit?: number | undefined;
}

export interface FileRelationshipsResult {
  filePath: string;
  containedSymbols: GraphNode[];
  imports: GraphNode[];
  importers: GraphNode[];
  knowledgeEntities: GraphNode[];
  totals: FileRelationshipCollectionCounts;
  truncated: Record<keyof FileRelationshipCollectionCounts, boolean>;
  limit: number;
}

export interface FileRelationshipCollectionCounts {
  containedSymbols: number;
  imports: number;
  importers: number;
  knowledgeEntities: number;
}

export interface GraphWindowNode {
  id: string;
  label: DashboardNodeLabel;
  displayName: string;
  filePath?: string;
  startLine?: number;
  degree: number;
  symbolCount?: number;
  /** @deprecated In-process CLI compatibility only. Not serialized in API responses. */
  data: Readonly<{ path: string }>;
}

export interface GraphWindowResult {
  nodes: GraphWindowNode[];
  edges: GraphWindowEdge[];
  totalNodes: number;
  totalEdges: number;
  windowOrder: 'degree-desc,id-asc';
  degreeScope: 'global';
  offset: number;
  limit: number;
  returned: number;
  hasMore: boolean;
  nextOffset: number | null;
  truncated: boolean;
}

export interface GraphWindowEdge {
  source: string;
  target: string;
  label: EdgeLabel;
  /** @deprecated In-process compatibility only. Not serialized in API responses. */
  id: string;
  /** @deprecated In-process compatibility only. Not serialized in API responses. */
  data: Readonly<{ type: string; from: string; to: string }>;
}

export interface FileGraphNode {
  id: string;
  displayName: string;
  filePath: string;
  symbolCount: number;
  label: 'File';
}

export interface FileGraphResult {
  nodes: FileGraphNode[];
  edges: GraphEdge[];
  totalNodes: number;
  totalEdges: number;
  windowOrder: 'degree-desc,id-asc';
  offset: number;
  limit: number;
  returned: number;
  hasMore: boolean;
  nextOffset: number | null;
  truncated: boolean;
}

export interface NodeNeighborsResult extends GraphData {
  centerId: string;
  incomingTruncated: boolean;
  outgoingTruncated: boolean;
  limit: number;
}

// ============================================================================
// Query Operations Interface
// ============================================================================

/**
 * Graph query operations interface
 */
export interface GraphQueries {
  /**
   * Get the full graph (limited)
   * @param limit - Maximum number of nodes to return
   * @param rootPath - Optional project root path to filter by
   */
  getFullGraph(limit?: number, rootPath?: string, offset?: number): Promise<GraphWindowResult>;

  /** Get the bounded File-to-File IMPORTS graph, optionally scoped by root path. */
  getFileGraph(
    limit?: number,
    rootPath?: string,
    offset?: number,
    includeExternals?: boolean,
  ): Promise<FileGraphResult>;

  /** Return edges induced among persisted ids, optionally scoped by root path. */
  getInducedEdges(ids: string[], rootPath?: string): Promise<GraphWindowEdge[]>;

  /** Get a node, its bounded direct neighbors, and their induced edges. */
  getNodeNeighbors(id: string, limit?: number): Promise<NodeNeighborsResult | undefined>;

  /**
   * Get subgraph for a specific file
   */
  getFileSubgraph(filePath: string): Promise<SubgraphData>;

  /** Get the categorized relationships shown for a File node. */
  getFileRelationships(filePath: string, limit?: number): Promise<FileRelationshipsResult>;

  /**
   * Get import dependency tree from a file
   */
  getDependencyTree(filePath: string, depth?: number): Promise<GraphData>;

  /**
   * Get graph statistics
   */
  getStats(): Promise<GraphStats>;

  /**
   * Find where a symbol is used: the callers, type users, subclasses,
   * implementers and renderers that point at it.
   */
  getSymbolReferences(query: SymbolReferenceQuery): Promise<SymbolReferencesResult>;
}

// ============================================================================
// Query Operations Implementation
// ============================================================================

function rowsToGraphNodes(
  rows: Array<{ n: Record<string, unknown>; labels: string[] }>,
  dialect: CypherDialect,
): GraphNode[] {
  const nodes = new Map<string, GraphNode>();
  for (const row of rows) {
    const node = nodeToGraphNode(row.n, row.labels, dialect);
    nodes.set(node.id, node);
  }
  return [...nodes.values()];
}

function pathNodes(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter((node): node is Record<string, unknown> => (
      node !== null && typeof node === 'object' && !Array.isArray(node)
    ));
  }
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const nodes = (value as Record<string, unknown>)['nodes'];
    if (Array.isArray(nodes)) {
      return nodes.filter((node): node is Record<string, unknown> => (
        node !== null && typeof node === 'object' && !Array.isArray(node)
      ));
    }
  }
  return [];
}

class GraphQueriesImpl implements GraphQueries {
  private readonly dialect: CypherDialect;
  private readonly templates: ReturnType<typeof buildCypherTemplates>;

  constructor(private readonly client: GraphClient) {
    this.dialect = client.dialect;
    this.templates = buildCypherTemplates(this.dialect);
  }

  @trace()
  async getFullGraph(limit = 1000, rootPath?: string, offset = 0): Promise<GraphWindowResult> {
    const nodes: GraphWindowNode[] = [];
    const edges: GraphWindowEdge[] = [];
    const nodeIds = new Set<string>();
    let normalizedRootPath = rootPath || undefined;
    while (normalizedRootPath && normalizedRootPath.endsWith('/')) {
      normalizedRootPath = normalizedRootPath.slice(0, -1) || undefined;
    }
    const rootPathPrefix = normalizedRootPath ? `${normalizedRootPath}/` : undefined;
    const scopeParams = normalizedRootPath && rootPathPrefix
      ? { rootPath: normalizedRootPath, rootPathPrefix }
      : {};

    const [totalsResult, nodesResult, entityIdentitiesResult, excludedIdentitiesResult] = await Promise.all([
      this.client.roQuery<{ totalNodes: number }>(
        this.templates.GET_FULL_GRAPH_TOTALS(normalizedRootPath),
        { params: scopeParams },
      ),
      this.client.roQuery<{
        n: Record<string, unknown>;
        labels: string[];
        nodeIdentity: number;
        degree: number;
      }>(this.templates.GET_FULL_GRAPH_NODES(normalizedRootPath), {
        params: { limit, offset, ...scopeParams },
      }),
      this.client.roQuery<{ nodeIdentities: number[] }>(
        this.templates.GET_SCOPED_ENTITY_IDENTITIES(normalizedRootPath),
        { params: scopeParams },
      ),
      this.client.roQuery<{ nodeIdentities: number[] }>(
        this.templates.GET_SHADOWED_EXTERNAL_IDENTITIES(normalizedRootPath),
        { params: scopeParams },
      ),
    ]);
    const totalNodes = totalsResult.data[0]?.totalNodes ?? 0;
    const entityNodeIdentities = entityIdentitiesResult.data[0]?.nodeIdentities ?? [];
    const excludedNodeIdentities = excludedIdentitiesResult.data[0]?.nodeIdentities ?? [];

    const edgeSourceIds = new Map<string, string[]>();
    const filePaths: string[] = [];
    const persistedIds: string[] = [];

    for (const row of nodesResult.data ?? []) {
      const node = nodeToGraphWindowNode(row.n, row.labels, row.degree, this.dialect);
      if (!nodeIds.has(node.id)) {
        nodes.push(node);
        nodeIds.add(node.id);
        const props = extractNodeProps(row.n, this.dialect);
        const sourceLabel = row.labels.includes('File')
          ? 'File'
          : row.labels.includes('Entity')
            ? 'Entity'
            : REFERENCEABLE_LABELS.find((label) => row.labels.includes(label));
        const sourceId = sourceLabel === 'File' ? props['filePath'] : props['id'];
        if (sourceLabel && typeof sourceId === 'string') {
          const ids = edgeSourceIds.get(sourceLabel) ?? [];
          ids.push(sourceId);
          edgeSourceIds.set(sourceLabel, ids);
        }
        if (node.label === 'File' && node.filePath) {
          filePaths.push(node.filePath);
        } else {
          persistedIds.push(node.id);
        }
      }
    }

    const [edgeTotalResult, edgeResults] = await Promise.all([
      this.client.roQuery<{ totalEdges: number }>(
        this.templates.GET_FULL_GRAPH_EDGE_TOTAL(normalizedRootPath),
        {
          params: {
            ...scopeParams,
            entityNodeIdentities,
            excludedNodeIdentities,
          },
        },
      ),
      Promise.all([...edgeSourceIds.entries()].map(([sourceLabel, sourceIds]) => (
        this.client.roQuery<{
          source: string;
          target: string;
          label: string;
        }>(this.templates.GET_FULL_GRAPH_WINDOW_EDGES(sourceLabel), {
          params: { sourceIds, filePaths, persistedIds, excludedNodeIdentities },
        })
      ))),
    ]);
    const totalEdges = edgeTotalResult.data[0]?.totalEdges ?? 0;

    for (const edgesResult of edgeResults) {
      for (const row of edgesResult.data ?? []) {
        const edge = projectedWindowEdge(row.source, row.target, row.label);
        if (nodeIds.has(edge.source) && nodeIds.has(edge.target)) {
          edges.push(edge);
        }
      }
    }

    const returned = nodes.length;
    const hasMore = offset + returned < totalNodes;
    return {
      nodes,
      edges,
      totalNodes,
      totalEdges,
      windowOrder: 'degree-desc,id-asc',
      degreeScope: 'global',
      offset,
      limit,
      returned,
      hasMore,
      nextOffset: hasMore ? offset + returned : null,
      truncated: nodes.length < totalNodes,
    };
  }

  @trace()
  async getFileGraph(
    limit = 1000,
    rootPath?: string,
    offset = 0,
    includeExternals = true,
  ): Promise<FileGraphResult> {
    let normalizedRootPath = rootPath || undefined;
    while (normalizedRootPath && normalizedRootPath.endsWith('/')) {
      normalizedRootPath = normalizedRootPath.slice(0, -1) || undefined;
    }
    const rootPathPrefix = normalizedRootPath ? `${normalizedRootPath}/` : undefined;
    const scopeParams = normalizedRootPath && rootPathPrefix
      ? { rootPath: normalizedRootPath, rootPathPrefix }
      : {};

    const [nodeTotalResult, edgeTotalResult, nodesResult] = await Promise.all([
      this.client.roQuery<{ totalNodes: number }>(
        this.templates.GET_FILE_GRAPH_NODE_TOTAL(normalizedRootPath, includeExternals),
        { params: scopeParams },
      ),
      this.client.roQuery<{ totalEdges: number }>(
        this.templates.GET_FILE_GRAPH_EDGE_TOTAL(normalizedRootPath, includeExternals),
        { params: scopeParams },
      ),
      this.client.roQuery<{
        f: Record<string, unknown>;
        symbolCount: number;
        nodeIdentity: number;
      }>(this.templates.GET_FILE_GRAPH_NODES(normalizedRootPath, includeExternals), {
        params: { ...scopeParams, limit, offset },
      }),
    ]);

    const nodes: FileGraphNode[] = [];
    const nodeIdentities: number[] = [];
    for (const row of nodesResult.data ?? []) {
      const props = extractNodeProps(row.f, this.dialect);
      const filePath = typeof props['filePath'] === 'string' ? props['filePath'] : '';
      nodes.push({
        id: `File:${filePath}`,
        displayName: typeof props['name'] === 'string' ? props['name'] : filePath,
        filePath,
        symbolCount: row.symbolCount,
        label: 'File',
      });
      nodeIdentities.push(row.nodeIdentity);
    }

    const edgesResult = await this.client.roQuery<{
      a: Record<string, unknown>;
      r: Record<string, unknown>;
      b: Record<string, unknown>;
      edgeType: string;
      fromLabels: string[];
      toLabels: string[];
    }>(this.templates.GET_FILE_GRAPH_EDGES, { params: { nodeIdentities } });
    const edges = (edgesResult.data ?? []).map((row) => edgeToGraphEdge(
      extractNodeProps(row.a, this.dialect),
      extractNodeProps(row.b, this.dialect),
      row.edgeType,
      row.r,
      row.fromLabels,
      row.toLabels,
    ));

    const totalNodes = nodeTotalResult.data[0]?.totalNodes ?? 0;
    const returned = nodes.length;
    const hasMore = offset + returned < totalNodes;
    return {
      nodes,
      edges,
      totalNodes,
      totalEdges: edgeTotalResult.data[0]?.totalEdges ?? 0,
      windowOrder: 'degree-desc,id-asc',
      offset,
      limit,
      returned,
      hasMore,
      nextOffset: hasMore ? offset + returned : null,
      truncated: nodes.length < totalNodes,
    };
  }

  @trace()
  async getInducedEdges(ids: string[], rootPath?: string): Promise<GraphWindowEdge[]> {
    const requestedIds = [...new Set(ids)];
    if (requestedIds.length === 0) return [];

    let normalizedRootPath = rootPath || undefined;
    while (normalizedRootPath && normalizedRootPath.endsWith('/')) {
      normalizedRootPath = normalizedRootPath.slice(0, -1) || undefined;
    }
    const rootPathPrefix = normalizedRootPath ? `${normalizedRootPath}/` : undefined;
    const scopeParams = normalizedRootPath && rootPathPrefix
      ? { rootPath: normalizedRootPath, rootPathPrefix }
      : {};

    const [nodesResult, excludedIdentitiesResult] = await Promise.all([
      this.client.roQuery<{ n: Record<string, unknown>; labels: string[] }>(
        this.templates.GET_SELECTED_GRAPH_NODES(normalizedRootPath),
        { params: { ids: requestedIds, ...scopeParams } },
      ),
      this.client.roQuery<{ nodeIdentities: number[] }>(
        this.templates.GET_SHADOWED_EXTERNAL_IDENTITIES(normalizedRootPath),
        { params: scopeParams },
      ),
    ]);

    const edgeSourceIds = new Map<string, string[]>();
    const filePaths: string[] = [];
    const persistedIds: string[] = [];
    for (const row of nodesResult.data ?? []) {
      const props = extractNodeProps(row.n, this.dialect);
      const sourceLabel = row.labels.includes('File')
        ? 'File'
        : row.labels.includes('Entity')
          ? 'Entity'
          : REFERENCEABLE_LABELS.find((label) => row.labels.includes(label));
      const sourceId = sourceLabel === 'File' ? props['filePath'] : props['id'];
      if (!sourceLabel || typeof sourceId !== 'string') continue;

      const sourceIds = edgeSourceIds.get(sourceLabel) ?? [];
      sourceIds.push(sourceId);
      edgeSourceIds.set(sourceLabel, sourceIds);
      if (sourceLabel === 'File') {
        filePaths.push(sourceId);
      } else {
        persistedIds.push(sourceId);
      }
    }

    const excludedNodeIdentities = excludedIdentitiesResult.data[0]?.nodeIdentities ?? [];
    const results = await Promise.all([...edgeSourceIds.entries()].map(([sourceLabel, sourceIds]) => (
      this.client.roQuery<{ source: string; target: string; label: string }>(
        this.templates.GET_FULL_GRAPH_WINDOW_EDGES(sourceLabel),
        { params: { sourceIds, filePaths, persistedIds, excludedNodeIdentities } },
      )
    )));

    return results.flatMap((result) => (result.data ?? []).map((row) => (
      projectedWindowEdge(row.source, row.target, row.label)
    )));
  }

  @trace()
  async getNodeNeighbors(id: string, limit = 100): Promise<NodeNeighborsResult | undefined> {
    const safeLimit = Math.min(Math.max(limit, 1), 1000);
    type NodeRow = {
      center?: Record<string, unknown>;
      neighbor?: Record<string, unknown>;
      labels: string[];
      nodeIdentity: number;
    };

    const centerResult = await this.client.roQuery<NodeRow>(
      this.templates.GET_NODE_BY_PERSISTED_ID,
      { params: { id } },
    );
    const centerRow = centerResult.data[0];
    if (!centerRow?.center) return undefined;

    const fetchLimit = safeLimit + 1;
    const [incomingResult, outgoingResult] = await Promise.all([
      this.client.roQuery<NodeRow>(this.templates.GET_NODE_NEIGHBORS('incoming'), {
        params: { id, fetchLimit },
      }),
      this.client.roQuery<NodeRow>(this.templates.GET_NODE_NEIGHBORS('outgoing'), {
        params: { id, fetchLimit },
      }),
    ]);
    const incomingRows = (incomingResult.data ?? []).slice(0, safeLimit);
    const outgoingRows = (outgoingResult.data ?? []).slice(0, safeLimit);

    const centerNode = nodeToGraphNode(centerRow.center, centerRow.labels, this.dialect);
    const nodes = [centerNode];
    const nodeIds = new Set([centerNode.id]);
    const nodeIdentities = [centerRow.nodeIdentity];
    for (const row of [...incomingRows, ...outgoingRows]) {
      if (!row.neighbor) continue;
      const node = nodeToGraphNode(row.neighbor, row.labels, this.dialect);
      if (nodeIds.has(node.id)) continue;
      nodeIds.add(node.id);
      nodes.push(node);
      nodeIdentities.push(row.nodeIdentity);
    }

    const edgesResult = await this.client.roQuery<{
      a: Record<string, unknown>;
      r: Record<string, unknown>;
      b: Record<string, unknown>;
      edgeType: string;
      fromLabels: string[];
      toLabels: string[];
    }>(this.templates.GET_FULL_GRAPH_EDGES, { params: { nodeIdentities } });
    const edges = (edgesResult.data ?? []).map((row) => edgeToGraphEdge(
      extractNodeProps(row.a, this.dialect),
      extractNodeProps(row.b, this.dialect),
      row.edgeType,
      row.r,
      row.fromLabels,
      row.toLabels,
    ));

    return {
      centerId: centerNode.id,
      nodes,
      edges,
      incomingTruncated: (incomingResult.data?.length ?? 0) > safeLimit,
      outgoingTruncated: (outgoingResult.data?.length ?? 0) > safeLimit,
      limit: safeLimit,
    };
  }

  @trace()
  async getFileSubgraph(filePath: string): Promise<FileSubgraphResult> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeIds = new Set<string>();
    const identityErrors: FileSubgraphIdentityError[] = [];

    const result = await this.client.roQuery<{
      f: Record<string, unknown>;
      e: Record<string, unknown>;
      r: Record<string, unknown> | null;
      related: Record<string, unknown> | null;
      labels: string[];
      relatedLabels: string[] | null;
      edgeType: string | null;
    }>(this.templates.GET_FILE_SUBGRAPH, { params: { filePath } });

    let centerId: string | undefined;

    for (const row of result.data ?? []) {
      // Add file node
      const fileNode = nodeToGraphNode(row.f, ['File'], this.dialect);
      if (!nodeIds.has(fileNode.id)) {
        nodes.push(fileNode);
        nodeIds.add(fileNode.id);
        centerId = fileNode.id;
      }

      // Add contained entity
      if (row.e) {
        let entityNode: GraphNode;
        try {
          entityNode = nodeToGraphNode(row.e, row.labels, this.dialect);
        } catch (error) {
          if (!isMissingPersistedNodeIdError(error)) throw error;
          identityErrors.push({
            labels: row.labels,
            edgeType: 'CONTAINS',
            message: error.message,
          });
          continue;
        }
        if (!nodeIds.has(entityNode.id)) {
          nodes.push(entityNode);
          nodeIds.add(entityNode.id);
        }

        // Add CONTAINS edge
        edges.push({
          id: JSON.stringify(['CONTAINS', fileNode.id, entityNode.id]),
          source: fileNode.id,
          target: entityNode.id,
          label: 'CONTAINS',
          data: { type: 'CONTAINS', from: fileNode.id, to: entityNode.id },
        } as GraphEdge);
      }

      // Add related entities and edges
      if (row.related && row.relatedLabels && row.edgeType && row.r) {
        let relatedNode: GraphNode;
        try {
          relatedNode = nodeToGraphNode(row.related, row.relatedLabels, this.dialect);
        } catch (error) {
          if (!isMissingPersistedNodeIdError(error)) throw error;
          identityErrors.push({
            labels: row.relatedLabels,
            edgeType: row.edgeType,
            message: error.message,
          });
          continue;
        }
        if (!nodeIds.has(relatedNode.id)) {
          nodes.push(relatedNode);
          nodeIds.add(relatedNode.id);
        }

        const entityProps = extractNodeProps(row.e, this.dialect);
        const relatedProps = extractNodeProps(row.related, this.dialect);
        const edge = edgeToGraphEdge(
          entityProps,
          relatedProps,
          row.edgeType,
          row.r,
          row.labels,
          row.relatedLabels,
        );

        // Avoid duplicate edges
        if (!edges.some((e) => e.id === edge.id)) {
          edges.push(edge);
        }
      }
    }

    if (centerId !== undefined) {
      return {
        nodes,
        edges,
        centerId,
        ...(identityErrors.length > 0 ? { identityErrors } : {}),
      };
    }
    return {
      nodes,
      edges,
      ...(identityErrors.length > 0 ? { identityErrors } : {}),
    };
  }

  @trace()
  async getFileRelationships(filePath: string, limit = 100): Promise<FileRelationshipsResult> {
    type NodeRow = { n: Record<string, unknown>; labels: string[] };
    type CountRow = { total: number };
    const options = { params: { filePath, limit } };
    const countOptions = { params: { filePath } };
    const [
      containedResult,
      importsResult,
      importersResult,
      knowledgeResult,
      containedCount,
      importsCount,
      importersCount,
      knowledgeCount,
    ] = await Promise.all([
      this.client.roQuery<NodeRow>(this.templates.GET_FILE_CONTAINED_SYMBOLS, options),
      this.client.roQuery<NodeRow>(this.templates.GET_FILE_IMPORTS, options),
      this.client.roQuery<NodeRow>(this.templates.GET_FILE_IMPORTERS, options),
      this.client.roQuery<NodeRow>(this.templates.GET_FILE_KNOWLEDGE_ENTITIES, options),
      this.client.roQuery<CountRow>(this.templates.COUNT_FILE_CONTAINED_SYMBOLS, countOptions),
      this.client.roQuery<CountRow>(this.templates.COUNT_FILE_IMPORTS, countOptions),
      this.client.roQuery<CountRow>(this.templates.COUNT_FILE_IMPORTERS, countOptions),
      this.client.roQuery<CountRow>(this.templates.COUNT_FILE_KNOWLEDGE_ENTITIES, countOptions),
    ]);

    const containedSymbols = rowsToGraphNodes(containedResult.data ?? [], this.dialect);
    const imports = rowsToGraphNodes(importsResult.data ?? [], this.dialect);
    const importers = rowsToGraphNodes(importersResult.data ?? [], this.dialect);
    const knowledgeEntities = rowsToGraphNodes(knowledgeResult.data ?? [], this.dialect);
    const totals: FileRelationshipCollectionCounts = {
      containedSymbols: containedCount.data[0]?.total ?? 0,
      imports: importsCount.data[0]?.total ?? 0,
      importers: importersCount.data[0]?.total ?? 0,
      knowledgeEntities: knowledgeCount.data[0]?.total ?? 0,
    };

    return {
      filePath,
      containedSymbols,
      imports,
      importers,
      knowledgeEntities,
      totals,
      truncated: {
        containedSymbols: containedSymbols.length < totals.containedSymbols,
        imports: imports.length < totals.imports,
        importers: importers.length < totals.importers,
        knowledgeEntities: knowledgeEntities.length < totals.knowledgeEntities,
      },
      limit,
    };
  }

  @trace()
  async getDependencyTree(filePath: string, depth = 5): Promise<GraphData> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeIds = new Set<string>();

    // FalkorDB doesn't support variable-length path parameters
    const depthParam = Math.min(depth, 10);

    const result = await this.client.roQuery<{ path: unknown }>(
      this.templates.GET_DEPENDENCY_TREE.replace('$depth', String(depthParam)), {
      params: { filePath },
    });

    for (const row of result.data ?? []) {
      const nodesInPath = pathNodes(row.path);
      for (let i = 0; i < nodesInPath.length; i++) {
        const node = nodesInPath[i]!;
        const graphNode = nodeToGraphNode(node, ['File'], this.dialect);
        if (!nodeIds.has(graphNode.id)) {
          nodes.push(graphNode);
          nodeIds.add(graphNode.id);
        }

        // Create edge to next node in path
        if (i < nodesInPath.length - 1) {
          const nextNode = nodesInPath[i + 1]!;
          const nextProps = extractNodeProps(nextNode, this.dialect);
          const fromId = graphNode.id;
          const toId = persistedNodeId(nextProps);
          const edgeId = JSON.stringify(['IMPORTS', fromId, toId]);

          if (!edges.some((e) => e.id === edgeId)) {
            edges.push({
              id: edgeId,
              source: fromId,
              target: toId,
              label: 'IMPORTS',
              data: { type: 'IMPORTS', from: fromId, to: toId },
            } as GraphEdge);
          }
        }
      }
    }

    return { nodes, edges };
  }

  @trace()
  async getStats(): Promise<GraphStats> {
    // Get node counts by type
    const nodesResult = await this.client.roQuery<{
      label: string;
      count: number;
    }>(this.templates.GET_STATS_NODES);

    const nodesByType: Record<NodeLabel, number> = {
      File: 0,
      Function: 0,
      Class: 0,
      Interface: 0,
      Variable: 0,
      Type: 0,
      Component: 0,
      Import: 0,
      Commit: 0,
      MarkdownDocument: 0,
      Section: 0,
      CodeBlock: 0,
      Link: 0,
    };

    // totalNodes counts every node. nodesByType breaks down the labels we name,
    // so the two do not have to agree: a graph can hold nodes of a kind this
    // list does not enumerate, and hiding those from the total would misreport it.
    let totalNodes = 0;
    for (const row of nodesResult.data ?? []) {
      totalNodes += row.count;
      const label = row.label as NodeLabel;
      if (label in nodesByType) {
        nodesByType[label] = row.count;
      }
    }

    // Get edge counts by type
    const edgesResult = await this.client.roQuery<{
      label: string;
      count: number;
    }>(this.templates.GET_STATS_EDGES);

    const edgesByType: Record<EdgeLabel, number> = {
      CONTAINS: 0,
      IMPORTS: 0,
      IMPORTS_SYMBOL: 0,
      CALLS: 0,
      EXTENDS: 0,
      IMPLEMENTS: 0,
      USES_TYPE: 0,
      RETURNS: 0,
      HAS_PARAM: 0,
      HAS_METHOD: 0,
      HAS_PROPERTY: 0,
      RENDERS: 0,
      INTRODUCED_IN: 0,
      MODIFIED_IN: 0,
      DELETED_IN: 0,
      EXPORTS: 0,
      PARENT_SECTION: 0,
      ABOUT: 0,
    };

    let totalEdges = 0;
    for (const row of edgesResult.data ?? []) {
      const label = row.label as EdgeLabel;
      if (label in edgesByType) {
        edgesByType[label] = row.count;
        totalEdges += row.count;
      }
    }

    // Get largest files
    const largestFilesResult = await this.client.roQuery<{
      path: string;
      entityCount: number;
    }>(this.templates.GET_LARGEST_FILES);

    const largestFiles = (largestFilesResult.data ?? []).map((row) => ({
      path: row.path,
      entityCount: row.entityCount,
    }));

    // Get most connected entities
    const mostConnectedResult = await this.client.roQuery<{
      name: string;
      filePath: string;
      connectionCount: number;
    }>(this.templates.GET_MOST_CONNECTED);

    const mostConnected = (mostConnectedResult.data ?? []).map((row) => ({
      name: row.name,
      filePath: row.filePath,
      connectionCount: row.connectionCount,
    }));

    return {
      totalNodes,
      totalEdges,
      nodesByType,
      edgesByType,
      largestFiles,
      mostConnected,
    };
  }

  @trace()
  async getSymbolReferences(query: SymbolReferenceQuery): Promise<SymbolReferencesResult> {
    const limit = Math.min(Math.max(query.limit ?? 200, 1), 1000);
    const cypher = `
      MATCH (selected)
      WHERE selected.id = $id AND (${REFERENCEABLE_LABELS.map((label) => this.dialect.labelCheckExpr('selected', label)).join(' OR ')})
      MATCH (target)
      WHERE target.id = selected.id
      MATCH (source)-[r:${REFERENCE_EDGE_TYPES.join('|')}]->(target)
      WHERE source.id IS NOT NULL AND source.name IS NOT NULL
      RETURN DISTINCT
        source.id AS id,
        source.name AS name,
        labels(source)[0] AS nodeType,
        source.filePath AS filePath,
        source.startLine AS startLine,
        type(r) AS edgeType,
        selected.filePath AS declaringFilePath
      LIMIT ${limit + 1}
    `;

    const result = await this.client.roQuery<{
      id: string;
      name: string;
      nodeType: string;
      filePath: string | null;
      startLine: number | null;
      edgeType: ReferenceEdgeType;
      declaringFilePath: string | null;
    }>(cypher, { params: { id: query.id } });

    const rows = result.data ?? [];
    const truncated = rows.length > limit;
    const references: SymbolReference[] = rows.slice(0, limit).map((row) => ({
      id: row.id,
      name: row.name,
      nodeType: row.nodeType,
      filePath: row.filePath ?? '',
      startLine: row.startLine ?? undefined,
      edgeType: row.edgeType,
      sameFile: row.filePath != null
        && row.declaringFilePath != null
        && row.filePath === row.declaringFilePath,
    }));

    const referencingFiles = Array.from(
      new Set(references.filter((r) => !r.sameFile && r.filePath !== '').map((r) => r.filePath)),
    );

    return { references, referencingFiles, truncated };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create graph queries instance from client
 *
 * @example
 * ```typescript
 * const client = await createClient();
 * const queries = createQueries(client);
 *
 * const graph = await queries.getFullGraph(500);
 * console.log(`Loaded ${graph.nodes.length} nodes`);
 *
 * const stats = await queries.getStats();
 * console.log(`Total nodes: ${stats.totalNodes}`);
 * ```
 */
export function createQueries(client: GraphClient): GraphQueries {
  return new GraphQueriesImpl(client);
}
