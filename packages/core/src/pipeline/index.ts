/**
 * Pipeline module exports
 * Moved from @codegraph/parser in Phase 3B-3
 *
 * Contains the parser, extraction pipeline, language registry,
 * and pipeline orchestration (Task wrapper + Runner).
 */

// Task wrapper & Pipeline runner (WS13)
export { Task } from './task';
export type { TaskResult } from './task';
export { PipelineRunner } from './runner';
export type { PipelineResult } from './runner';
export type {
  TaskConfig,
  PipelineEvent,
  PipelineEventType,
  PipelineRunConfig,
  ProvenanceMetadata,
  Provenanceable,
  IncrementalState,
  FileProcessingState,
} from './types';

// Pipeline tasks (WS13.4 — Task-wrapped extraction pipeline)
export {
  createParseTask,
  createExtractTask,
  createExtractionPipeline,
} from './pipeline-tasks';
export type {
  ParsedFile,
  ExtractionPipelineConfig,
} from './pipeline-tasks';

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
  registerTier2Languages,
  createFileEntity,
  createFileEntityFromContent,
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
export { languageRegistry } from './registry';
export type { LanguageRegistry } from './registry';
