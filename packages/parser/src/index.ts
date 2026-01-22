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

// Analysis module
export {
  calculateComplexity,
  calculateCyclomatic,
  calculateCognitive,
  calculateNestingDepth,
  classifyComplexity,
  COMPLEXITY_THRESHOLDS,
} from './analysis';

export type { ComplexityMetrics } from './analysis';
