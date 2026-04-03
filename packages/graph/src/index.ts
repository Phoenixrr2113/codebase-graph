/**
 * @codegraph/graph
 * Graph database operations for CodeGraph — FalkorDB primary engine
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

// FalkorDB driver (primary — remote, Docker)
export { FalkorDBDriver, falkorDialect } from './drivers/falkordb';

// FalkorDBLite driver (embedded — no Docker needed)
export { FalkorDBLiteDriver, type FalkorDBLiteConfig } from './drivers/falkordblite';

// Driver registry (pluggable driver system)
export { registerDriver, createDriver, getRegisteredDrivers, type DriverFactory } from './driver-registry';

// Auto-register built-in drivers on import
import './drivers/index';

// Operations exports
export { createOperations, type GraphOperations, type VectorSearchResult } from './operations';

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
  type AboutEdgeInput,
  type AboutEdgeResult,
  type AboutLinkMethod,
  type TemporalQueryResult,
  type TemporalChangeResult,
  type TimelineEntry,
  type FactSearchResult,
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
  type MarkdownDocumentNodeProps,
  type SectionNodeProps,
  type CodeBlockNodeProps,
  type LinkNodeProps,
  // Entity to node mappers
  fileToNodeProps,
  functionToNodeProps,
  classToNodeProps,
  interfaceToNodeProps,
  variableToNodeProps,
  typeToNodeProps,
  componentToNodeProps,
  markdownDocumentToNodeProps,
  sectionToNodeProps,
  codeBlockToNodeProps,
  linkToNodeProps,
  // ID generation
  generateNodeId,
  generateFileNodeId,
  generateEdgeId,
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
