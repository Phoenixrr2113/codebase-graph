/**
 * @codegraph/plugin-typescript
 * TypeScript/JavaScript/React language plugin for CodeGraph
 * 
 * Phase 1: Provides grammar lookup only
 * Phase 2: Will include extractors (future migration)
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
