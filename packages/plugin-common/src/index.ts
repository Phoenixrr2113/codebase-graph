/**
 * @codegraph/plugin-common
 * Shared utilities for CodeGraph language plugins (QUAL.10)
 *
 * Eliminates duplicated AST traversal, ID generation, and grammar
 * helper functions across 6+ language plugins.
 */

import type { SyntaxNode } from '@codegraph/types';

// ============================================================================
// Complexity Analysis (universal, all languages)
// ============================================================================

export {
  calculateComplexity,
  calculateCyclomatic,
  calculateCognitive,
  calculateNestingDepth,
  classifyComplexity,
  COMPLEXITY_THRESHOLDS,
  type ComplexityMetrics,
} from './complexity';

// ============================================================================
// AST Traversal
// ============================================================================

/**
 * Recursively find all AST nodes matching the given type names.
 * Used by every language plugin for entity extraction.
 */
export function findNodesOfType(root: SyntaxNode, types: string[]): SyntaxNode[] {
  const results: SyntaxNode[] = [];

  function visit(node: SyntaxNode) {
    if (types.includes(node.type)) {
      results.push(node);
    }
    for (const child of node.children) {
      visit(child);
    }
  }

  visit(root);
  return results;
}

// ============================================================================
// Entity ID Generation
// ============================================================================

/**
 * Generate a deterministic entity ID from file path, entity type, name, and line.
 * Format: `filePath:type:name:line`
 */
export function generateEntityId(filePath: string, type: string, name: string, line: number): string {
  return `${filePath}:${type}:${name}:${line}`;
}

// ============================================================================
// Grammar Helpers Factory
// ============================================================================

/** Grammar helper functions returned by createGrammarHelpers */
export interface GrammarHelpers {
  getGrammarForExtension(ext: string): unknown | undefined;
  getSupportedExtensions(): string[];
  isSupported(ext: string): boolean;
}

/**
 * Create grammar lookup helpers from an extension-to-grammar mapping.
 * Eliminates duplicated getGrammarForExtension/getSupportedExtensions/isSupported
 * across every language plugin.
 */
export function createGrammarHelpers(extensionToGrammar: Record<string, unknown>): GrammarHelpers {
  function getGrammarForExtension(ext: string): unknown | undefined {
    const normalizedExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
    return extensionToGrammar[normalizedExt];
  }

  function getSupportedExtensions(): string[] {
    return Object.keys(extensionToGrammar);
  }

  function isSupported(ext: string): boolean {
    return getGrammarForExtension(ext) !== undefined;
  }

  return { getGrammarForExtension, getSupportedExtensions, isSupported };
}

