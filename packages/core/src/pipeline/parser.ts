/**
 * Tree-sitter Parser for Multiple Languages
 * Uses native tree-sitter Node.js bindings for maximum performance
 *
 * Grammars are resolved dynamically from the language registry.
 * No hardcoded language imports — adding a language requires only
 * registering a plugin with the registry.
 */

import TreeSitter from 'tree-sitter';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { withTrace, createLogger, toErrorMessage } from '@codegraph/logger';
import { languageRegistry } from './registry';

const logger = createLogger({ namespace: 'Parser' });

// ============================================================================
// Types
// ============================================================================

/**
 * Language identifier string.
 * No longer a fixed union — any registered plugin ID is valid.
 * Common values: 'typescript', 'tsx', 'javascript', 'jsx', 'python',
 * 'csharp', 'java', 'go', 'rust', 'php', etc.
 */
export type LanguageType = string;

/** Syntax tree wrapper with metadata */
export interface SyntaxTree {
  /** The tree-sitter tree */
  tree: TreeSitter.Tree;
  /** Root node of the tree */
  rootNode: TreeSitter.SyntaxNode;
  /** Source code that was parsed */
  sourceCode: string;
  /** Language used for parsing */
  language: LanguageType;
  /** File path (if parsed from file) */
  filePath?: string;
}

// ============================================================================
// Parser State (Module-level singleton)
// ============================================================================

const parser = new TreeSitter();

/** Cache grammars by extension to avoid repeated plugin lookups */
const grammarCache = new Map<string, unknown>();

let initialized = false;

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Get the tree-sitter grammar for a file extension from the registry.
 * Uses plugin.getGrammarForExtension() if available (e.g., TypeScript
 * needs different grammars for .ts vs .tsx), otherwise falls back
 * to plugin.getGrammar().
 */
function resolveGrammar(ext: string): unknown | undefined {
  const normalizedExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;

  if (grammarCache.has(normalizedExt)) {
    return grammarCache.get(normalizedExt);
  }

  const plugin = languageRegistry.getForExtension(normalizedExt);
  if (!plugin) return undefined;

  const grammar = plugin.getGrammarForExtension
    ? plugin.getGrammarForExtension(normalizedExt)
    : plugin.getGrammar();

  if (grammar) {
    grammarCache.set(normalizedExt, grammar);
  }

  return grammar;
}

/**
 * Resolve a language ID for a file extension from the registry.
 */
function resolveLanguageId(ext: string): string | undefined {
  const normalizedExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return languageRegistry.getForExtension(normalizedExt)?.id;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Initialize the Tree-sitter parser.
 * For native bindings, this is essentially a no-op but kept for API consistency.
 * Safe to call multiple times.
 */
export async function initParser(): Promise<void> {
  return withTrace('initParser', async () => {
    if (initialized) {
      return;
    }

    // Native parser is ready immediately
    initialized = true;
    logger.debug('Parser initialized');
  });
}

/**
 * Check if the parser has been initialized.
 */
export function isInitialized(): boolean {
  return initialized;
}

/**
 * Get the language for a file extension.
 * Queries the language registry dynamically.
 */
export function getLanguageForExtension(ext: string): LanguageType | undefined {
  return resolveLanguageId(ext);
}

/**
 * Parse source code string.
 *
 * @param code - Source code to parse
 * @param language - Language ID (plugin ID from the registry, e.g., 'python', 'typescript')
 * @param ext - Optional file extension to resolve the correct grammar variant
 *              (e.g., '.tsx' to select TSX grammar from the TypeScript plugin)
 * @returns Parsed syntax tree
 * @throws Error if parser not initialized or language not registered
 */
export function parseCode(code: string, language: LanguageType, ext?: string): SyntaxTree {
  if (!initialized) {
    // Auto-initialize for convenience
    initialized = true;
  }

  // Resolve grammar — prefer extension-specific grammar if ext is provided
  let grammar: unknown;

  if (ext) {
    grammar = resolveGrammar(ext);
  }

  if (!grammar) {
    // Fall back to looking up by language ID
    const plugin = languageRegistry.getById(language);
    if (plugin) {
      grammar = plugin.getGrammar();
    }
  }

  // Backward compatibility: if language looks like a filename (e.g. 'test.ts'),
  // extract the extension and try to resolve the grammar from it.
  if (!grammar && language.includes('.')) {
    const dotIdx = language.lastIndexOf('.');
    const inferredExt = language.slice(dotIdx);
    grammar = resolveGrammar(inferredExt);
  }

  if (!grammar) {
    const registered = languageRegistry.getRegisteredPlugins().map(p => p.id).join(', ');
    throw new Error(
      `No grammar found for language '${language}'${ext ? ` (ext: ${ext})` : ''}. ` +
      `Registered languages: ${registered || 'none — call registerPlugins() first'}`,
    );
  }

  // Grammar returned as `unknown` from plugin interface; tree-sitter expects Language
  parser.setLanguage(grammar as TreeSitter.Language);

  const tree = parser.parse(code);

  return {
    tree,
    rootNode: tree.rootNode,
    sourceCode: code,
    language,
  };
}

/**
 * Parse a file from disk.
 *
 * @param filePath - Path to the file to parse
 * @returns Parsed syntax tree
 * @throws Error if file cannot be read, extension not supported, or parsing fails
 */
export async function parseFile(filePath: string): Promise<SyntaxTree> {
  return withTrace('parseFile', async () => {
    if (!initialized) {
      await initParser();
    }

    const ext = extname(filePath);
    const language = getLanguageForExtension(ext);

    if (!language) {
      const supported = languageRegistry.getSupportedExtensions().join(', ');
      throw new Error(`Unsupported file extension: ${ext}. Supported: ${supported || 'none — call registerPlugins() first'}`);
    }

    const code = await readFile(filePath, 'utf-8');

    const syntaxTree = parseCode(code, language, ext);
    syntaxTree.filePath = filePath;

    return syntaxTree;
  });
}

/**
 * Parse multiple files.
 *
 * @param filePaths - Paths to files to parse
 * @returns Array of parsed syntax trees (or errors)
 */
export async function parseFiles(
  filePaths: string[]
): Promise<Array<{ filePath: string; tree?: SyntaxTree; error?: string }>> {
  return withTrace('parseFiles', async () => {
    if (!initialized) {
      await initParser();
    }

    logger.info(`Parsing ${filePaths.length} files`);
    const results: Array<{ filePath: string; tree?: SyntaxTree; error?: string }> = [];

    for (const filePath of filePaths) {
      try {
        const tree = await parseFile(filePath);
        results.push({ filePath, tree });
      } catch (error) {
        results.push({
          filePath,
          error: toErrorMessage(error),
        });
      }
    }

    return results;
  });
}

/**
 * Clean up parser resources.
 * For native bindings, this resets the initialized flag and grammar cache.
 */
export function disposeParser(): void {
  initialized = false;
  grammarCache.clear();
}
