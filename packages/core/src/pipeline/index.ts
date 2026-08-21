/**
 * Pipeline module — parser, extraction, language registry
 */

// Parser
export {
  initParser,
  parseCode,
  parseFile,
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
  buildParsedFileEntities,
  buildReExportIndex,
  buildLocalExportsIndex,
  buildResolvedImportMap,
  resolveReExportChain,
  countEntities,
  countEdges,
  getLanguageCategory,
  getSupportedExtensions,
  isMarkdownFile,
  DEFAULT_IGNORE_PATTERNS,
  MARKDOWN_EXTENSIONS,
} from './pipeline';
export type { PipelineOptions } from './pipeline';

// Language registry
export { languageRegistry } from './registry';
export type { LanguageRegistry } from './registry';
