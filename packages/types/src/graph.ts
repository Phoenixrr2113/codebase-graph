/**
 * CodeGraph Graph Data Types
 * Combined types for graph operations and visualization
 */

import type {
  NodeLabel,
  FileEntity,
  ClassEntity,
  InterfaceEntity,
  FunctionEntity,
  VariableEntity,
  ImportEntity,
  TypeEntity,
  ComponentEntity,
} from './nodes';
import type { Edge, EdgeLabel } from './edges';

// ============================================================================
// Graph Node (for visualization)
// ============================================================================

/** Base graph node with common visualization properties */
export interface GraphNodeBase {
  /** Unique node identifier */
  id: string;
  /** Node label/type */
  label: NodeLabel;
  /** Display name */
  displayName: string;
  /** File path for navigation */
  filePath?: string;
}

/** Graph node for File entities */
export interface FileGraphNode extends GraphNodeBase {
  label: 'File';
  data: FileEntity;
}

/** Graph node for Class entities */
export interface ClassGraphNode extends GraphNodeBase {
  label: 'Class';
  data: ClassEntity;
}

/** Graph node for Interface entities */
export interface InterfaceGraphNode extends GraphNodeBase {
  label: 'Interface';
  data: InterfaceEntity;
}

/** Graph node for Function entities */
export interface FunctionGraphNode extends GraphNodeBase {
  label: 'Function';
  data: FunctionEntity;
}

/** Graph node for Variable entities */
export interface VariableGraphNode extends GraphNodeBase {
  label: 'Variable';
  data: VariableEntity;
}

/** Graph node for Import entities */
export interface ImportGraphNode extends GraphNodeBase {
  label: 'Import';
  data: ImportEntity;
}

/** Graph node for Type entities */
export interface TypeGraphNode extends GraphNodeBase {
  label: 'Type';
  data: TypeEntity;
}

/** Graph node for Component entities */
export interface ComponentGraphNode extends GraphNodeBase {
  label: 'Component';
  data: ComponentEntity;
}

/** Union of all graph node types */
export type GraphNode =
  | FileGraphNode
  | ClassGraphNode
  | InterfaceGraphNode
  | FunctionGraphNode
  | VariableGraphNode
  | ImportGraphNode
  | TypeGraphNode
  | ComponentGraphNode;

// ============================================================================
// Graph Edge (for visualization)
// ============================================================================

/** Graph edge with visualization properties */
export interface GraphEdge {
  /** Unique edge identifier */
  id: string;
  /** Source node ID */
  source: string;
  /** Target node ID */
  target: string;
  /** Edge label/type */
  label: EdgeLabel;
  /** Original edge data */
  data: Edge;
}

// ============================================================================
// Graph Data
// ============================================================================

/** Complete graph data for visualization */
export interface GraphData {
  /** All nodes in the graph */
  nodes: GraphNode[];
  /** All edges in the graph */
  edges: GraphEdge[];
}

/** Partial graph data (for subgraph queries) */
export interface SubgraphData extends GraphData {
  /** Center node ID (for file/entity-focused queries) */
  centerId?: string;
}

// ============================================================================
// Graph Statistics
// ============================================================================

/** Statistics about the graph */
export interface GraphStats {
  /** Total number of nodes */
  totalNodes: number;
  /** Total number of edges */
  totalEdges: number;
  /** Node counts by type */
  nodesByType: Record<NodeLabel, number>;
  /** Edge counts by type */
  edgesByType: Record<EdgeLabel, number>;
  /** Top files by entity count */
  largestFiles: Array<{ path: string; entityCount: number }>;
  /** Most connected entities */
  mostConnected: Array<{ name: string; filePath: string; connectionCount: number }>;
}

// ============================================================================
// Query Types
// ============================================================================

/** Search result item */
export interface SearchResult {
  /** Entity ID */
  id: string;
  /** Entity name */
  name: string;
  /** Entity type */
  type: NodeLabel;
  /** File path */
  filePath: string;
  /** Line number (if applicable) */
  line?: number;
  /** Match score (for ranking) */
  score?: number;
}

/** Parse operation statistics */
export interface ParseStats {
  /** Number of files parsed */
  files: number;
  /** Number of entities extracted */
  entities: number;
  /** Number of edges created */
  edges: number;
  /** Duration in milliseconds */
  durationMs: number;
}

/** Parse operation result */
export interface ParseResult {
  /** Operation status */
  status: 'processing' | 'complete' | 'error';
  /** Parse statistics */
  stats?: ParseStats;
  /** Error message (if status is 'error') */
  error?: string;
}

// ============================================================================
// Re-exports
// ============================================================================

export type {
  Entity,
  NodeLabel,
  FileEntity,
  ClassEntity,
  InterfaceEntity,
  FunctionEntity,
  VariableEntity,
  ImportEntity,
  TypeEntity,
  ComponentEntity,
  FunctionParam,
  ComponentProp,
  ImportSpecifier,
  VariableKind,
  TypeKind,
} from './nodes';

export type {
  Edge,
  EdgeLabel,
  BaseEdge,
  ContainsEdge,
  ImportsEdge,
  ImportsSymbolEdge,
  CallsEdge,
  ExtendsEdge,
  ImplementsEdge,
  UsesTypeEdge,
  ReturnsEdge,
  HasParamEdge,
  HasMethodEdge,
  HasPropertyEdge,
  RendersEdge,
  UsesHookEdge,
  Visibility,
} from './edges';
