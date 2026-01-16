/**
 * @codegraph/graph
 * FalkorDB graph database operations for CodeGraph
 */

// Client exports
export {
  createClient,
  type GraphClient,
  type FalkorConfig,
  type QueryOptions,
  type QueryResult,
  GraphClientError,
} from './client.js';

// Operations exports
export { createOperations, type GraphOperations } from './operations.js';

// Query exports
export { createQueries, type GraphQueries } from './queries.js';

// Schema exports
export {
  // Node property types
  type FileNodeProps,
  type FunctionNodeProps,
  type ClassNodeProps,
  type InterfaceNodeProps,
  type VariableNodeProps,
  type TypeNodeProps,
  type ComponentNodeProps,
  // Entity to node mappers
  fileToNodeProps,
  functionToNodeProps,
  classToNodeProps,
  interfaceToNodeProps,
  variableToNodeProps,
  typeToNodeProps,
  componentToNodeProps,
  // ID generation
  generateNodeId,
  generateFileNodeId,
  generateEdgeId,
  // Parsed file type
  type ParsedFileEntities,
} from './schema.js';

// Re-export types from @codegraph/types for convenience
export type {
  FileEntity,
  FunctionEntity,
  ClassEntity,
  InterfaceEntity,
  VariableEntity,
  TypeEntity,
  ComponentEntity,
  ImportEntity,
  NodeLabel,
  EdgeLabel,
  GraphData,
  SubgraphData,
  GraphStats,
  SearchResult,
} from '@codegraph/types';
