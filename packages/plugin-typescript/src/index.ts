/**
 * @codegraph/plugin-typescript
 * TypeScript/JavaScript/React language plugin for CodeGraph
 *
 * Provides grammar lookup and entity extraction for TS/JS/React files.
 */

import TypeScript from 'tree-sitter-typescript';

// Access typescript and tsx languages from the package
const { typescript: tsLanguage, tsx: tsxLanguage } = TypeScript;

/** Extension to grammar mapping */
const extensionToGrammar: Record<string, unknown> = {
  '.ts': tsLanguage,
  '.mts': tsLanguage,
  '.cts': tsLanguage,
  '.tsx': tsxLanguage,
  '.js': tsLanguage,
  '.mjs': tsLanguage,
  '.cjs': tsLanguage,
  '.jsx': tsxLanguage,
};

/** Extension to language ID mapping */
const extensionToId: Record<string, string> = {
  '.ts': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.jsx': 'jsx',
};

/** Get the tree-sitter grammar for a file extension */
export function getGrammarForExtension(ext: string): unknown | undefined {
  const normalizedExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return extensionToGrammar[normalizedExt];
}

/** Get all supported extensions */
export function getSupportedExtensions(): string[] {
  return Object.keys(extensionToGrammar);
}

/** Check if an extension is supported */
export function isSupported(ext: string): boolean {
  return getGrammarForExtension(ext) !== undefined;
}

/** Get language ID for an extension */
export function getLanguageIdForExtension(ext: string): string | undefined {
  const normalizedExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return extensionToId[normalizedExt];
}

// Re-export grammars for direct access
export const grammars = {
  typescript: tsLanguage,
  tsx: tsxLanguage,
  javascript: tsLanguage,
  jsx: tsxLanguage,
};

// Import extractors for plugin object
import {
  extractImports as _extractImports,
  extractFunctions as _extractFunctions,
  extractClasses as _extractClasses,
  extractVariables as _extractVariables,
  extractTypes as _extractTypes,
  extractInterfaces as _extractInterfaces,
  extractComponents as _extractComponents,
  extractCalls as _extractCalls,
  extractRenders as _extractRenders,
  extractInheritance as _extractInheritance,
  extractAllEntities as _extractAllEntities,
} from './extractors';

// Plugin object implementing LanguagePlugin interface
export const typescriptPlugin = {
  id: 'typescript',
  displayName: 'TypeScript/JavaScript',
  extensions: ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'],
  getGrammar() {
    // Default to TypeScript grammar; use getGrammarForExtension for specific extensions
    return tsLanguage;
  },
  getGrammarForExtension(ext: string) {
    const normalizedExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
    return extensionToGrammar[normalizedExt] ?? tsLanguage;
  },
  extractors: {
    extractFunctions: _extractFunctions,
    extractClasses: _extractClasses,
    extractVariables: _extractVariables,
    extractImports: _extractImports,
    extractInterfaces: _extractInterfaces,
    extractTypes: _extractTypes,
    extractComponents: _extractComponents,
    extractCalls: _extractCalls,
    extractRenders: _extractRenders,
    extractInheritance: _extractInheritance,
  },
  extractAllEntities: _extractAllEntities,
};

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

// Complexity metrics (used by function extractor and analysis pipeline)
export {
  calculateComplexity,
  calculateCyclomatic,
  calculateCognitive,
  calculateNestingDepth,
  classifyComplexity,
  COMPLEXITY_THRESHOLDS,
} from './complexity';

export type { ComplexityMetrics } from './complexity';
