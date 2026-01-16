/**
 * Tree-sitter Parser for TypeScript/JavaScript/React
 * Uses native tree-sitter Node.js bindings for maximum performance
 */

import TreeSitter from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

// ============================================================================
// Types
// ============================================================================

/** Supported language types */
export type LanguageType = 'typescript' | 'tsx' | 'javascript' | 'jsx';

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
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
};

// ============================================================================
// Parser State (Module-level singleton)
// ============================================================================

const parser = new TreeSitter();

// Access typescript and tsx languages from the package
// tree-sitter-typescript exports both as named exports
// Note: TypeScript grammar handles JavaScript since TS is a superset
const { typescript: tsLanguage, tsx: tsxLanguage } = TypeScript;
// Use TypeScript grammar for JS since it's a superset and handles all JS syntax
const jsLanguage = tsLanguage;

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
  if (initialized) {
    return;
  }
  
  // Native parser is ready immediately
  initialized = true;
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
  
  if (language === 'tsx') {
    lang = tsxLanguage;
  } else if (language === 'typescript') {
    lang = tsLanguage;
  } else {
    // Use JavaScript grammar for JS and JSX
    lang = jsLanguage;
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
  if (!initialized) {
    await initParser();
  }

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
}

/**
 * Clean up parser resources.
 * For native bindings, this resets the initialized flag.
 */
export function disposeParser(): void {
  initialized = false;
}
