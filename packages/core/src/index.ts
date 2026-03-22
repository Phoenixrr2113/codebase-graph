/**
 * @codegraph/core — Shared infrastructure for CodeGraph
 *
 * Provides singleton graph client management, config persistence,
 * config-to-graph synchronization, project indexing, and schema docs.
 *
 * Consumers: @codegraph/mcp-server, @codegraph/api, @codegraph/cli
 */

// Client singletons
export { getGraphClient, closeGraphClient } from './graphClient';
export { getKnowledgeOps, resetKnowledgeOps } from './knowledgeClient';

// Config management
export {
  loadConfig,
  saveConfig,
  needsSetup,
  getActiveProjectPaths,
  setActiveProjects,
  updateLastUsed,
  getLastUsed,
  isStale,
  clearConfig,
  STALENESS_THRESHOLD_MS,
} from './config';
export type { MCPContextConfig, ProjectInfo } from './config';


// Indexer
export { indexProject, indexSingleFile, isProjectIndexed } from './indexer';
export type { IndexStats, IndexResult } from './indexer';

// Embedding pass (generates + stores embeddings during indexing pipeline)
export { embedParsedEntities, embedAllParsedEntities } from './embed-pass';
export type { EmbedPassResult } from './embed-pass';

// Retroactive embedding (generate embeddings for existing graph nodes)
export { embedAllNodes } from './embed-nodes';
export type { EmbedNodesOptions, EmbedNodesResult } from './embed-nodes';
export type { EmbeddableNodeType } from './embed-nodes';

// Search (enrichedSearchV2 is the only search)
export { enrichedSearchV2 } from './enrichedSearchV2';
export type { EnrichedV2Result, EnrichedV2Hit, EnrichedV2Options } from './enrichedSearchV2';

// Git history sync
export { syncGitHistory, getRepoInfo } from './gitSync';
export type { GitSyncResult, GitSyncOptions } from './gitSync';



// Pipeline — parser, extraction, language registry
export {
  initParser,
  parseCode,
  parseFile,
  disposeParser,
  getLanguageForExtension,
  registerPlugins,
  registerTier2Languages,
  createFileEntity,
  createFileEntityFromContent,
  extractEntitiesForFile,
  buildParsedFileEntities,
  countEntities,
  countEdges,
  getLanguageCategory,
  getSupportedExtensions,
  isMarkdownFile,
  DEFAULT_IGNORE_PATTERNS,
  MARKDOWN_EXTENSIONS,
  languageRegistry,
} from './pipeline';

export type { SyntaxTree, LanguageType, LanguageRegistry } from './pipeline';

// Markdown document processing (via @codegraph/plugin-markdown)
export {
  parseMarkdownFile,
  parseMarkdownContent,
  isSupported as isMarkdownSupported,
  getSupportedExtensions as getMarkdownExtensions,
  parseMarkdown,
} from '@codegraph/plugin-markdown';

export type {
  ParsedMarkdown,
} from '@codegraph/plugin-markdown';

// Source file reader
export { readSourceFile } from './sourceReader';
export type { ReadSourceOptions, SourceFileResult } from './sourceReader';


// File system watcher
export {
  WatchService,
  startWatching,
  stopWatching,
  stopWatchingProject,
  getActiveWatcher,
  getActiveWatchers,
} from './watchService';
export type {
  FileEventType,
  FileChangeEvent,
  FileChangedHandler,
  FileRemovedHandler,
  WatchServiceConfig,
} from './watchService';


// Service layer
export { codeGraphService, warmupSearch } from './service';
export type { CodeGraphService } from './service';
export type {
  EntityWithConnections,
  Pagination,
  PaginatedNodesResult,
  NodesQueryOptions,
  Direction,
  NeighborsResult,
  CypherResult,
} from './service';

// Knowledge graph service layer
export { knowledgeService } from './knowledgeService';
export type { KnowledgeService } from './knowledgeService';
export type {
  KnowledgeStoreResult,
  KnowledgeRelationshipStoreResult,
  KnowledgeRecallResult,
  KnowledgeFactResult,
  KnowledgeMaintenanceResult,
  KnowledgeStatsResult,
  ExtractAndStoreFn,
} from './knowledgeService';

// Re-export knowledge graph types from @codegraph/graph
export type {
  KnowledgeEntity,
  KnowledgeRelationship,
  EntitySearchResult,
  RelationshipResult,
  MemoryStats,
  DecayConfig,
} from '@codegraph/graph';

// Re-export graph traversal types from @codegraph/graph
export type { FileTreeOptions } from '@codegraph/graph';

// Re-export entity types from @codegraph/types
export type {
  FileEntity,
  ClassEntity,
  InterfaceEntity,
  FunctionEntity,
  VariableEntity,
  ImportEntity,
  TypeEntity,
  ComponentEntity,
  FunctionParam,
  ImportSpecifier,
  ParsedFileEntities,
  MarkdownDocumentEntity,
  SectionEntity,
  CodeBlockEntity,
  LinkEntity,
  ExtractedDocumentEntities,
  GraphData,
  SubgraphData,
} from '@codegraph/types';

// Re-export edge types from @codegraph/types
export type {
  CallsEdge,
  ContainsEdge,
  ImportsEdge,
  ExtendsEdge,
  ImplementsEdge,
  RendersEdge,
  UsesHookEdge,
} from '@codegraph/types';

// Re-export extractor types from @codegraph/plugin-typescript
export type {
  ExtractedEntities,
  SourceLocation,
  CallReference,
  RenderReference,
  ExtendsReference,
  ImplementsReference,
  InheritanceResult,
} from '@codegraph/plugin-typescript';

// Re-export extractor functions from @codegraph/plugin-typescript
export {
  extractImports,
  extractFunctions,
  extractClasses,
  extractVariables,
  extractTypes,
  extractInterfaces,
  extractComponents,
  extractCalls,
  extractRenders,
  extractInheritance,
  extractAllEntities,
  getLocation,
  findNodesOfType,
  generateEntityId,
} from '@codegraph/plugin-typescript';
