/**
 * @codegraph/graph
 * Graph database operations for CodeGraph — supports FalkorDB and Kuzu backends
 */

// Client exports
export {
  createClient,
  type GraphClient,
  type FalkorConfig,
  type GraphConfig,
  type QueryOptions,
  type QueryResult,
  GraphClientError,
} from './client';

// Driver exports
export {
  type DatabaseDriver,
  type DriverConfig,
  type CypherDialect,
} from './driver';

// Driver implementations (kuzu native module is NOT eagerly loaded — safe to import)
export { FalkorDBDriver, falkorDialect } from './drivers/falkordb';
export { KuzuDriver, kuzuDialect } from './drivers/kuzu';

// Schema DDL exports
export {
  NODE_TABLES,
  KNOWLEDGE_NODE_TABLES,
  REL_TABLES,
  KNOWLEDGE_REL_TABLES,
  VECTOR_INDEX_STMTS,
  ALL_DDL,
} from './drivers/kuzu-schema';

// Operations exports
export { createOperations, type GraphOperations } from './operations';

// Query exports
export { createQueries, type GraphQueries } from './queries';

// Knowledge graph exports (NLC merger)
export {
  createKnowledgeOperations,
  type KnowledgeOperations,
  type KnowledgeEntity,
  type KnowledgeRelationship,
  type DecayConfig,
  type MemoryStats,
  type EntitySearchResult,
  type RelationshipResult,
} from './knowledge-operations';

// File tree exports
export { buildFileTree, getIndexSummary, type FileTreeOptions } from './fileTree';

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
  generatePrimaryKey,
  // Parsed file type
  type ParsedFileEntities,
} from './schema';

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
