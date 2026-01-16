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
} from './parser.js';

export type { SyntaxTree, LanguageType } from './parser.js';

// Entity extractors
export {
  extractImports,
  extractFunctions,
  extractClasses,
  extractVariables,
  extractTypes,
  extractInterfaces,
  extractComponents,
  extractAllEntities,
  getLocation,
  findNodesOfType,
  generateEntityId,
} from './extractors/index.js';

export type { ExtractedEntities, SourceLocation } from './extractors/index.js';

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
