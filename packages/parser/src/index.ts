/**
 * @codegraph/parser
 * Tree-sitter based code parsing for TypeScript/JavaScript/React
 */

// Parser core
export {
  initParser,
  isInitialized,
  parseCode,
  parseFile,
  parseFiles,
  disposeParser,
  getLanguageForExtension,
} from './parser';

export type { SyntaxTree, LanguageType } from './parser';

// Entity extractors
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
} from './extractors';

export type {
  ExtractedEntities,
  SourceLocation,
  CallReference,
  RenderReference,
  ExtendsReference,
  ImplementsReference,
  InheritanceResult,
} from './extractors';

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

// Analysis module - Complexity
export {
  calculateComplexity,
  calculateCyclomatic,
  calculateCognitive,
  calculateNestingDepth,
  classifyComplexity,
  COMPLEXITY_THRESHOLDS,
} from './analysis';

export type { ComplexityMetrics } from './analysis';

// Analysis module - Impact
export {
  analyzeImpact,
  classifyRisk,
  calculateRiskScore,
  getDirectCallersQuery,
  getTransitiveCallersQuery,
  getAffectedTestsQuery,
  isTestFile,
  getAffectedFiles,
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

// Analysis module - Dataflow
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

// Analysis module - Security
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
