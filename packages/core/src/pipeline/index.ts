/**
 * Pipeline module exports
 * Moved from @codegraph/parser in Phase 3B-3
 *
 * Contains the parser, extraction pipeline, and language registry.
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

// Extraction pipeline
export {
  registerPlugins,
  createFileEntity,
  extractEntitiesForFile,
  enrichFunctionsWithComplexity,
  buildParsedFileEntities,
  countEntities,
  countEdges,
  getLanguageCategory,
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
export { languageRegistry } from './registry';
export type { LanguageRegistry } from './registry';
