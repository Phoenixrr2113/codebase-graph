/**
 * Shared types for entity extractors
 */

import Parser from 'tree-sitter';

/** Location information in source code */
export interface SourceLocation {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startIndex: number;
  endIndex: number;
}

/** Helper to extract location from a tree-sitter node */
export function getLocation(node: Parser.SyntaxNode): SourceLocation {
  return {
    startLine: node.startPosition.row + 1, // Convert to 1-based
    startColumn: node.startPosition.column,
    endLine: node.endPosition.row + 1,
    endColumn: node.endPosition.column,
    startIndex: node.startIndex,
    endIndex: node.endIndex,
  };
}

/** Helper to get text of a child node by field name */
export function getChildText(node: Parser.SyntaxNode, fieldName: string): string | undefined {
  const child = node.childForFieldName(fieldName);
  return child?.text;
}

/** Helper to find all nodes of a given type */
export function findNodesOfType(
  rootNode: Parser.SyntaxNode,
  type: string
): Parser.SyntaxNode[] {
  const results: Parser.SyntaxNode[] = [];
  
  function walk(node: Parser.SyntaxNode): void {
    if (node.type === type) {
      results.push(node);
    }
    for (const child of node.children) {
      walk(child);
    }
  }
  
  walk(rootNode);
  return results;
}

/** Helper to find all nodes matching any of the given types */
export function findNodesOfTypes(
  rootNode: Parser.SyntaxNode,
  types: string[]
): Parser.SyntaxNode[] {
  const results: Parser.SyntaxNode[] = [];
  const typeSet = new Set(types);
  
  function walk(node: Parser.SyntaxNode): void {
    if (typeSet.has(node.type)) {
      results.push(node);
    }
    for (const child of node.children) {
      walk(child);
    }
  }
  
  walk(rootNode);
  return results;
}

/**
 * Collect all nodes matching any of the given types in a single walk.
 * Returns a Map from node type to array of matching nodes.
 * This replaces multiple findNodesOfType/findNodesOfTypes calls with one traversal.
 */
export function collectNodesByType(
  rootNode: Parser.SyntaxNode,
  types: string[]
): Map<string, Parser.SyntaxNode[]> {
  const typeSet = new Set(types);
  const result = new Map<string, Parser.SyntaxNode[]>();
  for (const t of types) {
    result.set(t, []);
  }

  function walk(node: Parser.SyntaxNode): void {
    if (typeSet.has(node.type)) {
      result.get(node.type)!.push(node);
    }
    for (const child of node.children) {
      walk(child);
    }
  }

  walk(rootNode);
  return result;
}

/** Generate a unique ID for an entity */
export function generateEntityId(filePath: string, kind: string, name: string, line: number): string {
  // Create a simple unique ID based on file, kind, name, and line
  const base = `${filePath}:${kind}:${name}:${line}`;
  // Simple hash-like ID
  return base.replace(/[^a-zA-Z0-9:_-]/g, '_');
}
