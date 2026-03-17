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

// Config sync
export { syncConfigToGraph, initialSync, syncIfNeeded } from './configSync';

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

// Hybrid search orchestration
export { hybridSearch, extractSearchTerms } from './hybridSearch';
export type {
  HybridSearchHit,
  HybridSearchResult,
  HybridSearchOptions,
  RelatedHit,
  CodeNodeType,
} from './hybridSearch';

// Enriched search (hybrid + non-LLM enrichment signals)
export { enrichedSearch } from './enrichedSearch';
export type {
  EnrichedSearchHit,
  EnrichedSearchResult,
  EnrichedSearchOptions,
  EnrichmentData,
  DocSnippet,
} from './enrichedSearch';

// Enriched search V2 (clean incremental build)
export { enrichedSearchV2 } from './enrichedSearchV2';
export type { EnrichedV2Result, EnrichedV2Hit, EnrichedV2Options } from './enrichedSearchV2';

// Search strategy registry (WS12)
export {
  SearchRegistry,
  createSearchRegistry,
  createDefaultSearchRegistry,
} from './search';
export {
  HybridSearchStrategy,
  GraphAnswerStrategy,
  NLToCypherStrategy,
  SmartSearchStrategy,
  ContextWalkStrategy,
  EnrichedSearchStrategy,
} from './search';
export type {
  SearchType,
  SearchContext,
  SearchRequest,
  SearchResponse,
  SearchResultItem,
  SearchRelatedItem,
  SearchStrategy,
} from './search';

// Git history sync
export { syncGitHistory, getRepoInfo } from './gitSync';
export type { GitSyncResult, GitSyncOptions } from './gitSync';

// Token estimation (WS3)
export {
  estimateTokens,
  tokensToChars,
  fitsTokenBudget,
  truncateToTokenBudget,
} from './tokenEstimator';

// Schema docs
export { getSchemaDocumentation, getShortSchema } from './schema';

// Analysis module (moved from @codegraph/parser in Phase 3B-2)

// Analysis - Complexity
export {
  calculateComplexity,
  calculateCyclomatic,
  calculateCognitive,
  calculateNestingDepth,
  classifyComplexity,
  COMPLEXITY_THRESHOLDS,
} from './analysis';

export type { ComplexityMetrics } from './analysis';

// Analysis - Security
export {
  scanForVulnerabilities,
  scanFile,
  sortBySeverity,
  severityToNumber,
} from './analysis';

export type {
  SecurityFinding,
  SecuritySeverity,
  ScanOptions,
} from './analysis';

// Analysis - Impact
export {
  analyzeImpact,
  classifyRisk,
  calculateRiskScore,
  getDirectCallersQuery,
  getTransitiveCallersQuery,
  getAffectedTestsQuery,
  isTestFile,
  getAffectedFiles,
  groupCallersByFile,
  getImpactSummary,
  RISK_WEIGHTS,
  RISK_THRESHOLDS,
} from './analysis';

export type {
  ImpactAnalysisResult,
  ImpactAnalysisInput,
  ImpactAnalysisOptions,
  CallerInfo,
  TestInfo,
} from './analysis';

// Analysis - Refactoring
export {
  analyzeRefactoring,
  classifyCouplingLevel,
  calculateCouplingScore,
  isSafeToExtract,
  getExtractionCandidatesQuery,
  getInternalCallsQuery,
  getExtractionOrder,
  getRefactoringSummary,
  needsRefactoring,
  DEFAULT_EXTRACTION_THRESHOLD,
  COUPLING_THRESHOLDS,
} from './analysis';

export type {
  FunctionCoupling,
  Responsibility,
  RefactoringAnalysisResult,
  RefactoringAnalysisInput,
  RefactoringAnalysisOptions,
} from './analysis';

// Analysis - Dataflow
export {
  analyzeDataflow,
  isTaintSource,
  isTaintSink,
  isSanitizer,
  getTaintSourcePatterns,
  getTaintSinkPatterns,
  getSanitizerPatterns,
  getDataflowSummary,
} from './analysis';

export type {
  TaintSource,
  TaintSink,
  TaintSourceCategory,
  TaintSinkCategory,
  FlowStep,
  DataFlowPath,
  DataflowAnalysisResult,
  DataflowAnalysisOptions,
} from './analysis';

// Pipeline module (moved from @codegraph/parser in Phase 3B-3)

// Pipeline orchestration (WS13)
export { Task, PipelineRunner, createExtractionPipeline, createParseTask, createExtractTask } from './pipeline';
export type { ParsedFile, ExtractionPipelineConfig } from './pipeline';
export type {
  TaskConfig,
  TaskResult,
  PipelineResult,
  PipelineEvent,
  PipelineEventType,
  PipelineRunConfig,
  ProvenanceMetadata,
  Provenanceable,
} from './pipeline';

// Parser core
export {
  initParser,
  isInitialized,
  parseCode,
  parseFile,
  parseFiles,
  disposeParser,
  getLanguageForExtension,
} from './pipeline';

export type { SyntaxTree, LanguageType } from './pipeline';

// Extraction pipeline
export {
  registerPlugins,
  registerTier2Languages,
  createFileEntity,
  extractEntitiesForFile,
  enrichFunctionsWithComplexity,
  buildParsedFileEntities,
  countEntities,
  countEdges,
  getLanguageCategory,
  getSupportedExtensions,
  getExtensionsForLanguage,
  isPythonFile,
  isCSharpFile,
  isMarkdownFile,
  SUPPORTED_EXTENSIONS,
  DEFAULT_IGNORE_PATTERNS,
  PYTHON_EXTENSIONS,
  CSHARP_EXTENSIONS,
  MARKDOWN_EXTENSIONS,
} from './pipeline';

export type { PipelineOptions } from './pipeline';

// Language registry
export { languageRegistry } from './pipeline';
export type { LanguageRegistry } from './pipeline';

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

// Change detection
export {
  calculateFileHash,
  detectChanges,
  getFilesToProcess,
  getFilesToRemove,
  getRenamedFiles,
  hasChanges,
  formatChangeSummary,
} from './changeDetection';
export type {
  ChangeType,
  FileChange,
  ChangeSummary,
  StoredFileInfo,
  ChangeDetectionOptions,
} from './changeDetection';

// File system watcher
export {
  WatchService,
  startWatching,
  stopWatching,
  getActiveWatcher,
} from './watchService';
export type {
  FileEventType,
  FileChangeEvent,
  FileChangedHandler,
  FileRemovedHandler,
  WatchServiceConfig,
} from './watchService';

// Two-pass resolution (re-exported from analysis)
export {
  SymbolRegistry,
  collectSymbols,
  resolveRelationships,
  twoPassResolve,
  isBuiltIn,
  getResolutionSummary,
} from './analysis';
export type {
  SymbolInfo,
  UnresolvedCall,
  ResolutionResult,
  TwoPassOptions,
} from './analysis';

// Service layer (Phase 3A)
export { codeGraphService, warmupSearch } from './service';
export type { CodeGraphService } from './service';
export type {
  ServiceSearchResult,
  ServiceSymbolResult,
  ServiceCodeSearchResult,
  ServiceEntityContext,
  ServiceRelatedEntity,
  ServiceDependencyInfo,
  ServiceComplexityHotspot,
  ServiceComplexitySummary,
  ServiceProjectInfo,
  ServiceChangeInfo,
  ServiceImpactResult,
  ServiceExtractionCandidate,
  ServiceResponsibility,
  ServiceRefactoringResult,
  // New consolidated types
  ServiceScanOptions,
  ServiceVulnerability,
  ServiceScanResult,
  ServiceDataflowResult,
  // API model replacement types
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
