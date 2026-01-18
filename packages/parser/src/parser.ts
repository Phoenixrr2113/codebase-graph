/**
 * Tree-sitter Parser for Multiple Languages
 * Uses native tree-sitter Node.js bindings for maximum performance
 * Grammars are provided by language plugins
 */

import TreeSitter from 'tree-sitter';
import { grammars as tsGrammars } from '@codegraph/plugin-typescript';
import { getGrammar as getPythonGrammar } from '@codegraph/plugin-python';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { withTrace, createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'Parser' });

// ============================================================================
// Types
// ============================================================================

/** Supported language types */
export type LanguageType = 'typescript' | 'tsx' | 'javascript' | 'jsx' | 'python';

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

/** File extension to language mapping */
const EXTENSION_MAP: Record<string, LanguageType> = {
  // TypeScript/JavaScript
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  // Python
  '.py': 'python',
  '.pyw': 'python',
  '.pyi': 'python',
};

// ============================================================================
// Parser State (Module-level singleton)
// ============================================================================

const parser = new TreeSitter();

// Get grammars from language plugins
const { typescript: tsLanguage, tsx: tsxLanguage } = tsGrammars;
const pythonLanguage = getPythonGrammar();

let initialized = false;

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
 */
export function getLanguageForExtension(ext: string): LanguageType | undefined {
  return EXTENSION_MAP[ext.toLowerCase()];
}

/**
 * Parse source code string.
 * 
 * @param code - Source code to parse
 * @param language - LanguageType of the source code
 * @returns Parsed syntax tree
 * @throws Error if parser not initialized or parsing fails
 */
export function parseCode(code: string, language: LanguageType): SyntaxTree {
  if (!initialized) {
    // Auto-initialize for convenience
    initialized = true;
  }

  // Select the appropriate language grammar
  let lang: unknown;
  
  if (language === 'python') {
    lang = pythonLanguage;
  } else if (language === 'tsx' || language === 'jsx') {
    lang = tsxLanguage;
  } else {
    // TypeScript grammar handles both TS and JS
    lang = tsLanguage;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parser.setLanguage(lang as any);
  
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
      throw new Error(`Unsupported file extension: ${ext}. Supported: ${Object.keys(EXTENSION_MAP).join(', ')}`);
    }

    const code = await readFile(filePath, 'utf-8');

    const syntaxTree = parseCode(code, language);
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
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  });
}

/**
 * Clean up parser resources.
 * For native bindings, this resets the initialized flag.
 */
export function disposeParser(): void {
  initialized = false;
}
