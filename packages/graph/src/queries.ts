/**
 * @codegraph/graph - Query Operations
 * Graph query functions for retrieving and searching graph data
 * Based on CodeGraph MVP Specification Section 6.2
 */

import type { GraphClient } from './client';
import type { CypherDialect } from './driver';
import { trace } from '@codegraph/logger';
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

function getLabelFromLabels(labels: string[]): NodeLabel {
  const validLabels: NodeLabel[] = [
    'File',
    'Function',
    'Class',
    'Interface',
    'Variable',
    'Type',
    'Component',
    'Import',
    'Commit',
    'MarkdownDocument',
    'Section',
    'CodeBlock',
    'Link',
  ];

  // First check for specific valid labels (File, Interface, etc.)
  // This ensures External File nodes return 'File', not 'Class'
  const found = labels.find((l) => validLabels.includes(l as NodeLabel));
  if (found) {
    return found as NodeLabel;
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

function nodeToGraphNode(node: Record<string, unknown>, labels: string[], dialect?: CypherDialect): GraphNode {
  const actualLabels = extractLabels(node, labels, dialect);
  const props = extractNodeProps(node, dialect);
  const label = getLabelFromLabels(actualLabels);
  const id = generateNodeIdFromProps(label, props);

  return {
    id,
    label,
    displayName: (props['name'] as string) ?? (props['path'] as string) ?? 'unknown',
    filePath: (props['filePath'] as string) ?? (props['path'] as string),
    data: props,
  } as unknown as GraphNode;
}

function generateNodeIdFromProps(label: NodeLabel, node: Record<string, unknown>): string {
  if (label === 'File') {
    return `File:${node['path'] ?? ''}`;
  }
  const name = node['name'] ?? '';
  const filePath = node['filePath'] ?? '';
  const line = node['startLine'] ?? node['line'] ?? 0;
  return `${label}:${filePath}:${name}:${line}`;
}


function edgeToGraphEdge(
  fromNode: Record<string, unknown>,
  toNode: Record<string, unknown>,
  edgeType: string,
  edgeProps: Record<string, unknown>,
  fromLabels: string[],
  toLabels: string[]
): GraphEdge {
  const fromId = generateNodeIdFromProps(getLabelFromLabels(fromLabels), fromNode);
  const toId = generateNodeIdFromProps(getLabelFromLabels(toLabels), toNode);

  return {
    id: `${edgeType}:${fromId}->${toId}`,
    source: fromId,
    target: toId,
    label: edgeType as EdgeLabel,
    data: {
      type: edgeType,
      from: fromId,
      to: toId,
      ...edgeProps,
    },
  } as GraphEdge;
}

// ============================================================================
// Cypher Template Builders (dialect-aware)
// ============================================================================

function buildCypherTemplates(dialect: CypherDialect) {
  const labelsExpr = dialect.labelsExpr;
  const firstLabel = dialect.firstLabelExpr;
  const typeExpr = dialect.typeExpr;
  const lc = dialect.labelCheckExpr.bind(dialect);
  const lcase = dialect.labelCaseExpr.bind(dialect);

  /** Build OR-separated label checks for WHERE clauses */
  function labelOr(alias: string, labels: string[]): string {
    return labels.map(l => lc(alias, l)).join(' OR ');
  }

  return {
    GET_FULL_GRAPH_NODES: (rootPath?: string) => {
      const pathFilter = rootPath
        ? `AND (CASE WHEN ${lcase('n', 'File')} THEN n.path ELSE n.filePath END) STARTS WITH $rootPath`
        : '';

      return `
        MATCH (n)
        WHERE (${labelOr('n', ['File', 'Function', 'Class', 'Interface', 'Variable', 'Type', 'Component', 'External'])})
          ${pathFilter}
        RETURN n, ${labelsExpr('n')} as labels
        LIMIT $limit
      `;
    },

    GET_FULL_GRAPH_EDGES: (rootPath?: string) => {
      const edgesPathFilter = rootPath
        ? `AND (CASE WHEN ${lcase('a', 'File')} THEN a.path ELSE a.filePath END) STARTS WITH $rootPath
           AND ((CASE WHEN ${lcase('b', 'File')} THEN b.path ELSE b.filePath END) STARTS WITH $rootPath
                OR b.filePath = 'external'
                OR (${lc('b', 'File')} AND b.path STARTS WITH 'external:'))`
        : '';

      return `
        MATCH (a)-[r]->(b)
        WHERE (${labelOr('a', ['File', 'Function', 'Class', 'Interface', 'Variable', 'Type', 'Component'])})
          AND (${labelOr('b', ['File', 'Function', 'Class', 'Interface', 'Variable', 'Type', 'Component', 'External'])})
          ${edgesPathFilter}
        RETURN a, r, b, ${typeExpr('r')} as edgeType, ${labelsExpr('b')} as toLabels
        LIMIT $limit
      `;
    },

    GET_FILE_SUBGRAPH: `
      MATCH (f:File {path: $path})-[:CONTAINS]->(e)
      OPTIONAL MATCH (e)-[r]-(related)
      RETURN f, e, r, related, ${labelsExpr('e')} as labels, ${labelsExpr('related')} as relatedLabels, ${typeExpr('r')} as edgeType
    `,

    GET_DEPENDENCY_TREE: `
      MATCH path = (root:File {path: $path})-[:IMPORTS*1..$depth]->(dep:File)
      RETURN path
    `,

    GET_STATS_NODES: `
      MATCH (n)
      WHERE ${labelOr('n', ['File', 'Function', 'Class', 'Interface', 'Variable', 'Type', 'Component'])}
      RETURN ${firstLabel('n')} as label, count(n) as count
    `,

    GET_STATS_EDGES: `
      MATCH ()-[r]->()
      RETURN ${typeExpr('r')} as label, count(r) as count
    `,

    GET_LARGEST_FILES: `
      MATCH (f:File)-[:CONTAINS]->(e)
      RETURN f.path as path, count(e) as entityCount
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
  getFullGraph(limit?: number, rootPath?: string): Promise<GraphData>;

  /**
   * Get subgraph for a specific file
   */
  getFileSubgraph(filePath: string): Promise<SubgraphData>;

  /**
   * Get import dependency tree from a file
   */
  getDependencyTree(filePath: string, depth?: number): Promise<GraphData>;

  /**
   * Get graph statistics
   */
  getStats(): Promise<GraphStats>;
}

// ============================================================================
// Query Operations Implementation
// ============================================================================

class GraphQueriesImpl implements GraphQueries {
  private readonly dialect: CypherDialect;
  private readonly templates: ReturnType<typeof buildCypherTemplates>;

  constructor(private readonly client: GraphClient) {
    this.dialect = client.dialect;
    this.templates = buildCypherTemplates(this.dialect);
  }

  @trace()
  async getFullGraph(limit = 1000, rootPath?: string): Promise<GraphData> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeIds = new Set<string>();

    // Get nodes
    const nodesResult = await this.client.roQuery<{
      n: Record<string, unknown>;
      labels: string[];
    }>(this.templates.GET_FULL_GRAPH_NODES(rootPath), { params: { limit, ...(rootPath && { rootPath }) } });

    for (const row of nodesResult.data ?? []) {
      const node = nodeToGraphNode(row.n, row.labels, this.dialect);
      if (!nodeIds.has(node.id)) {
        nodes.push(node);
        nodeIds.add(node.id);
      }
    }

    // Get edges
    const edgesResult = await this.client.roQuery<{
      a: Record<string, unknown>;
      r: Record<string, unknown>;
      b: Record<string, unknown>;
      edgeType: string;
      toLabels: string[];
    }>(this.templates.GET_FULL_GRAPH_EDGES(rootPath), { params: { limit, ...(rootPath && { rootPath }) } });

    for (const row of edgesResult.data ?? []) {
      const fromProps = extractNodeProps(row.a, this.dialect);
      const toProps = extractNodeProps(row.b, this.dialect);
      const fromLabels = extractLabels(row.a, [], this.dialect);
      const toLabels = row.toLabels ?? extractLabels(row.b, [], this.dialect);

      // Get source node from our nodes array
      const fromNode = nodes.find((n) => {
        return (
          n.filePath === fromProps['path'] ||
          (n.displayName === fromProps['name'] && n.filePath === fromProps['filePath'])
        );
      });

      // Get target node - or create External node if needed
      let toNode = nodes.find((n) => {
        return (
          n.filePath === toProps['path'] ||
          (n.displayName === toProps['name'] && n.filePath === toProps['filePath'])
        );
      });

      // If target is External and not in nodes, add it
      const isExternalTarget = toLabels.includes('External') ||
        (typeof toProps['path'] === 'string' && toProps['path'].startsWith('external:'));

      if (!toNode && isExternalTarget) {
        const externalNode = nodeToGraphNode(row.b, toLabels, this.dialect);
        if (!nodeIds.has(externalNode.id)) {
          nodes.push(externalNode);
          nodeIds.add(externalNode.id);
        }
        toNode = externalNode;
      }

      if (fromNode && toNode) {
        const edge = edgeToGraphEdge(
          fromProps,
          toProps,
          row.edgeType,
          row.r,
          fromLabels.length > 0 ? fromLabels : [fromNode.label],
          toLabels.length > 0 ? toLabels : [toNode.label]
        );
        edges.push(edge);
      }
    }

    return { nodes, edges };
  }

  @trace()
  async getFileSubgraph(filePath: string): Promise<SubgraphData> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeIds = new Set<string>();

    const result = await this.client.roQuery<{
      f: Record<string, unknown>;
      e: Record<string, unknown>;
      r: Record<string, unknown> | null;
      related: Record<string, unknown> | null;
      labels: string[];
      relatedLabels: string[] | null;
      edgeType: string | null;
    }>(this.templates.GET_FILE_SUBGRAPH, { params: { path: filePath } });

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
        const entityNode = nodeToGraphNode(row.e, row.labels, this.dialect);
        if (!nodeIds.has(entityNode.id)) {
          nodes.push(entityNode);
          nodeIds.add(entityNode.id);
        }

        // Add CONTAINS edge
        edges.push({
          id: `CONTAINS:${fileNode.id}->${entityNode.id}`,
          source: fileNode.id,
          target: entityNode.id,
          label: 'CONTAINS',
          data: { type: 'CONTAINS', from: fileNode.id, to: entityNode.id },
        } as GraphEdge);
      }

      // Add related entities and edges
      if (row.related && row.relatedLabels && row.edgeType && row.r) {
        const relatedNode = nodeToGraphNode(row.related, row.relatedLabels, this.dialect);
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
          row.relatedLabels
        );

        // Avoid duplicate edges
        if (!edges.some((e) => e.id === edge.id)) {
          edges.push(edge);
        }
      }
    }

    if (centerId !== undefined) {
      return { nodes, edges, centerId };
    }
    return { nodes, edges };
  }

  @trace()
  async getDependencyTree(filePath: string, depth = 5): Promise<GraphData> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeIds = new Set<string>();

    // FalkorDB doesn't support variable-length path parameters
    const depthParam = Math.min(depth, 10);

    const result = await this.client.roQuery<{
      path: Array<Record<string, unknown>>;
    }>(this.templates.GET_DEPENDENCY_TREE.replace('$depth', String(depthParam)), {
      params: { path: filePath },
    });

    for (const row of result.data ?? []) {
      const pathNodes = row.path;
      for (let i = 0; i < pathNodes.length; i++) {
        const node = pathNodes[i]!;
        const graphNode = nodeToGraphNode(node, ['File'], this.dialect);
        if (!nodeIds.has(graphNode.id)) {
          nodes.push(graphNode);
          nodeIds.add(graphNode.id);
        }

        // Create edge to next node in path
        if (i < pathNodes.length - 1) {
          const nextNode = pathNodes[i + 1]!;
          const nextProps = extractNodeProps(nextNode, this.dialect);
          const fromId = graphNode.id;
          const toId = generateNodeIdFromProps('File', nextProps);
          const edgeId = `IMPORTS:${fromId}->${toId}`;

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

    let totalNodes = 0;
    for (const row of nodesResult.data ?? []) {
      const label = row.label as NodeLabel;
      if (label in nodesByType) {
        nodesByType[label] = row.count;
        totalNodes += row.count;
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
      USES_HOOK: 0,
      INTRODUCED_IN: 0,
      MODIFIED_IN: 0,
      DELETED_IN: 0,
      READS: 0,
      WRITES: 0,
      FLOWS_TO: 0,
      EXPORTS: 0,
      INSTANTIATES: 0,
      HAS_SECTION: 0,
      PARENT_SECTION: 0,
      CONTAINS_CODE: 0,
      LINKS_TO: 0,
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
