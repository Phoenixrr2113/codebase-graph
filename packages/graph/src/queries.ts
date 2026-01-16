/**
 * @codegraph/graph - Query Operations
 * Graph query functions for retrieving and searching graph data
 * Based on CodeGraph MVP Specification Section 6.2
 */

import type { GraphClient } from './client.js';
import { trace } from '@codegraph/logger';
import type {
  GraphData,
  GraphNode,
  GraphEdge,
  SubgraphData,
  GraphStats,
  SearchResult,
  FunctionEntity,
  NodeLabel,
  EdgeLabel,
} from '@codegraph/types';

// ============================================================================
// Cypher Query Templates
// ============================================================================

const CYPHER = {
  // Get full graph with limit
  GET_FULL_GRAPH_NODES: `
    MATCH (n)
    WHERE n:File OR n:Function OR n:Class OR n:Interface OR n:Variable OR n:Type OR n:Component
    RETURN n, labels(n) as labels
    LIMIT $limit
  `,

  GET_FULL_GRAPH_EDGES: `
    MATCH (a)-[r]->(b)
    WHERE (a:File OR a:Function OR a:Class OR a:Interface OR a:Variable OR a:Type OR a:Component)
      AND (b:File OR b:Function OR b:Class OR b:Interface OR b:Variable OR b:Type OR b:Component)
    RETURN a, r, b, type(r) as edgeType
    LIMIT $limit
  `,

  // Get file subgraph
  GET_FILE_SUBGRAPH: `
    MATCH (f:File {path: $path})-[:CONTAINS]->(e)
    OPTIONAL MATCH (e)-[r]-(related)
    RETURN f, e, r, related, labels(e) as labels, labels(related) as relatedLabels, type(r) as edgeType
  `,

  // Get function callers
  GET_FUNCTION_CALLERS: `
    MATCH (caller:Function)-[c:CALLS]->(target:Function {name: $name})
    RETURN caller, c.line as line
  `,

  // Get dependency tree
  GET_DEPENDENCY_TREE: `
    MATCH path = (root:File {path: $path})-[:IMPORTS*1..$depth]->(dep:File)
    RETURN path
  `,

  // Get graph statistics
  GET_STATS_NODES: `
    MATCH (n)
    WHERE n:File OR n:Function OR n:Class OR n:Interface OR n:Variable OR n:Type OR n:Component
    RETURN labels(n)[0] as label, count(n) as count
  `,

  GET_STATS_EDGES: `
    MATCH ()-[r]->()
    RETURN type(r) as label, count(r) as count
  `,

  GET_LARGEST_FILES: `
    MATCH (f:File)-[:CONTAINS]->(e)
    RETURN f.path as path, count(e) as entityCount
    ORDER BY entityCount DESC
    LIMIT 10
  `,

  GET_MOST_CONNECTED: `
    MATCH (n)-[r]-()
    WHERE n:Function OR n:Class OR n:Component
    RETURN n.name as name, n.filePath as filePath, count(r) as connectionCount
    ORDER BY connectionCount DESC
    LIMIT 10
  `,

  // Search by name
  SEARCH_FULLTEXT: `
    CALL db.idx.fulltext.queryNodes($indexName, $term) YIELD node, score
    RETURN node, labels(node) as labels, score
    LIMIT $limit
  `,

  SEARCH_BY_NAME: `
    MATCH (n)
    WHERE (n:Function OR n:Class OR n:Interface OR n:Component OR n:Variable OR n:Type)
      AND toLower(n.name) CONTAINS toLower($term)
    RETURN n, labels(n) as labels
    LIMIT $limit
  `,
};

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
  ];
  const found = labels.find((l) => validLabels.includes(l as NodeLabel));
  return (found as NodeLabel) ?? 'File';
}

/**
 * Extract node properties from FalkorDB result
 * FalkorDB returns nodes as { id, labels, properties: {...} }
 */
function extractNodeProps(node: Record<string, unknown>): Record<string, unknown> {
  // If node has a 'properties' object, use that; otherwise assume flat structure
  if (node['properties'] && typeof node['properties'] === 'object') {
    return node['properties'] as Record<string, unknown>;
  }
  return node;
}

/**
 * Extract labels from FalkorDB node
 */
function extractLabels(node: Record<string, unknown>, providedLabels: string[]): string[] {
  // FalkorDB returns labels in the node object
  if (node['labels'] && Array.isArray(node['labels'])) {
    return node['labels'] as string[];
  }
  return providedLabels;
}

function nodeToGraphNode(node: Record<string, unknown>, labels: string[]): GraphNode {
  const actualLabels = extractLabels(node, labels);
  const props = extractNodeProps(node);
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
// Query Operations Interface
// ============================================================================

/**
 * Graph query operations interface
 */
export interface GraphQueries {
  /**
   * Get the full graph (limited)
   */
  getFullGraph(limit?: number): Promise<GraphData>;

  /**
   * Get subgraph for a specific file
   */
  getFileSubgraph(filePath: string): Promise<SubgraphData>;

  /**
   * Get all functions that call a given function
   */
  getFunctionCallers(funcName: string): Promise<FunctionEntity[]>;

  /**
   * Get import dependency tree from a file
   */
  getDependencyTree(filePath: string, depth?: number): Promise<GraphData>;

  /**
   * Get graph statistics
   */
  getStats(): Promise<GraphStats>;

  /**
   * Search for entities by name
   */
  search(term: string, types?: NodeLabel[], limit?: number): Promise<SearchResult[]>;
}

// ============================================================================
// Query Operations Implementation
// ============================================================================

class GraphQueriesImpl implements GraphQueries {
  constructor(private readonly client: GraphClient) {}

  @trace()
  async getFullGraph(limit = 1000): Promise<GraphData> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeIds = new Set<string>();

    // Get nodes
    const nodesResult = await this.client.roQuery<{
      n: Record<string, unknown>;
      labels: string[];
    }>(CYPHER.GET_FULL_GRAPH_NODES, { params: { limit } });

    for (const row of nodesResult.data ?? []) {
      const node = nodeToGraphNode(row.n, row.labels);
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
    }>(CYPHER.GET_FULL_GRAPH_EDGES, { params: { limit } });

    for (const row of edgesResult.data ?? []) {
      // Extract properties from FalkorDB node format
      const fromProps = extractNodeProps(row.a);
      const toProps = extractNodeProps(row.b);
      const fromLabels = extractLabels(row.a, []);
      const toLabels = extractLabels(row.b, []);

      // Get labels from nodes
      const fromNode = nodes.find((n) => {
        return (
          n.filePath === fromProps['path'] ||
          (n.displayName === fromProps['name'] && n.filePath === fromProps['filePath'])
        );
      });
      const toNode = nodes.find((n) => {
        return (
          n.filePath === toProps['path'] ||
          (n.displayName === toProps['name'] && n.filePath === toProps['filePath'])
        );
      });

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
    }>(CYPHER.GET_FILE_SUBGRAPH, { params: { path: filePath } });

    let centerId: string | undefined;

    for (const row of result.data ?? []) {
      // Add file node
      const fileNode = nodeToGraphNode(row.f, ['File']);
      if (!nodeIds.has(fileNode.id)) {
        nodes.push(fileNode);
        nodeIds.add(fileNode.id);
        centerId = fileNode.id;
      }

      // Add contained entity
      if (row.e) {
        const entityNode = nodeToGraphNode(row.e, row.labels);
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
        const relatedNode = nodeToGraphNode(row.related, row.relatedLabels);
        if (!nodeIds.has(relatedNode.id)) {
          nodes.push(relatedNode);
          nodeIds.add(relatedNode.id);
        }

        const edge = edgeToGraphEdge(
          row.e,
          row.related,
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

    // If no centerId found, use an empty object without it (SubgraphData extends GraphData)
    if (centerId !== undefined) {
      return { nodes, edges, centerId };
    }
    return { nodes, edges };
  }

  @trace()
  async getFunctionCallers(funcName: string): Promise<FunctionEntity[]> {
    const result = await this.client.roQuery<{
      caller: Record<string, unknown>;
      line: number;
    }>(CYPHER.GET_FUNCTION_CALLERS, { params: { name: funcName } });

    return (result.data ?? []).map((row): FunctionEntity => {
      const returnType = row.caller['returnType'] as string | undefined;
      const docstring = row.caller['docstring'] as string | undefined;
      const entity: FunctionEntity = {
        name: row.caller['name'] as string,
        filePath: row.caller['filePath'] as string,
        startLine: row.caller['startLine'] as number,
        endLine: row.caller['endLine'] as number,
        isExported: row.caller['isExported'] as boolean,
        isAsync: row.caller['isAsync'] as boolean,
        isArrow: row.caller['isArrow'] as boolean,
        params: JSON.parse((row.caller['params'] as string) ?? '[]') as FunctionEntity['params'],
      };
      if (returnType !== undefined) {
        entity.returnType = returnType;
      }
      if (docstring !== undefined) {
        entity.docstring = docstring;
      }
      return entity;
    });
  }

  @trace()
  async getDependencyTree(filePath: string, depth = 5): Promise<GraphData> {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const nodeIds = new Set<string>();

    // FalkorDB doesn't support variable-length path parameters
    // We need to run multiple depth queries
    const depthParam = Math.min(depth, 10);

    const result = await this.client.roQuery<{
      path: Array<Record<string, unknown>>;
    }>(CYPHER.GET_DEPENDENCY_TREE.replace('$depth', String(depthParam)), {
      params: { path: filePath },
    });

    for (const row of result.data ?? []) {
      const pathNodes = row.path;
      for (let i = 0; i < pathNodes.length; i++) {
        const node = pathNodes[i]!;
        const graphNode = nodeToGraphNode(node, ['File']);
        if (!nodeIds.has(graphNode.id)) {
          nodes.push(graphNode);
          nodeIds.add(graphNode.id);
        }

        // Create edge to next node in path
        if (i < pathNodes.length - 1) {
          const nextNode = pathNodes[i + 1]!;
          const fromId = graphNode.id;
          const toId = generateNodeIdFromProps('File', nextNode);
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
    }>(CYPHER.GET_STATS_NODES);

    const nodesByType: Record<NodeLabel, number> = {
      File: 0,
      Function: 0,
      Class: 0,
      Interface: 0,
      Variable: 0,
      Type: 0,
      Component: 0,
      Import: 0,
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
    }>(CYPHER.GET_STATS_EDGES);

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
    }>(CYPHER.GET_LARGEST_FILES);

    const largestFiles = (largestFilesResult.data ?? []).map((row) => ({
      path: row.path,
      entityCount: row.entityCount,
    }));

    // Get most connected entities
    const mostConnectedResult = await this.client.roQuery<{
      name: string;
      filePath: string;
      connectionCount: number;
    }>(CYPHER.GET_MOST_CONNECTED);

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
  async search(term: string, types?: NodeLabel[], limit = 50): Promise<SearchResult[]> {
    // Use simple name matching (fulltext search may not be available on all indexes)
    const result = await this.client.roQuery<{
      n: Record<string, unknown>;
      labels: string[];
    }>(CYPHER.SEARCH_BY_NAME, { params: { term, limit } });

    const results: SearchResult[] = [];

    for (const row of result.data ?? []) {
      const label = getLabelFromLabels(row.labels);

      // Filter by types if specified
      if (types && !types.includes(label)) {
        continue;
      }

      results.push({
        id: generateNodeIdFromProps(label, row.n),
        name: (row.n['name'] as string) ?? (row.n['path'] as string) ?? 'unknown',
        type: label,
        filePath: (row.n['filePath'] as string) ?? (row.n['path'] as string) ?? '',
        line: (row.n['startLine'] as number) ?? (row.n['line'] as number),
      });
    }

    return results;
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
 * const callers = await queries.getFunctionCallers('processPayment');
 * console.log(`Found ${callers.length} callers`);
 *
 * const stats = await queries.getStats();
 * console.log(`Total nodes: ${stats.totalNodes}`);
 * ```
 */
export function createQueries(client: GraphClient): GraphQueries {
  return new GraphQueriesImpl(client);
}
