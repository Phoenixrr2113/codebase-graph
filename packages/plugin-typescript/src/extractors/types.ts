/**
 * Shared types for entity extractors
 */

import Parser from 'tree-sitter';
import {
  buildLexicalScopeKey,
  buildSymbolIdentity,
  type SourceSymbolLabel,
  type SymbolIdentity,
} from '@codegraph/plugin-common';

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

/** Helper to find all nodes of a given type (cursor-based) */
export function findNodesOfType(
  rootNode: Parser.SyntaxNode,
  type: string
): Parser.SyntaxNode[] {
  const results: Parser.SyntaxNode[] = [];
  const cursor = rootNode.walk();
  let reachedRoot = false;

  while (!reachedRoot) {
    if (cursor.nodeType === type) {
      results.push(cursor.currentNode);
    }
    if (cursor.gotoFirstChild()) continue;
    if (cursor.gotoNextSibling()) continue;
    while (true) {
      if (!cursor.gotoParent()) { reachedRoot = true; break; }
      if (cursor.gotoNextSibling()) break;
    }
  }

  return results;
}

/** Helper to find all nodes matching any of the given types (cursor-based) */
export function findNodesOfTypes(
  rootNode: Parser.SyntaxNode,
  types: string[]
): Parser.SyntaxNode[] {
  const results: Parser.SyntaxNode[] = [];
  const typeSet = new Set(types);
  const cursor = rootNode.walk();
  let reachedRoot = false;

  while (!reachedRoot) {
    if (typeSet.has(cursor.nodeType)) {
      results.push(cursor.currentNode);
    }
    if (cursor.gotoFirstChild()) continue;
    if (cursor.gotoNextSibling()) continue;
    while (true) {
      if (!cursor.gotoParent()) { reachedRoot = true; break; }
      if (cursor.gotoNextSibling()) break;
    }
  }

  return results;
}

/**
 * Collect all nodes matching any of the given types in a single walk.
 * Returns a Map from node type to array of matching nodes.
 * This replaces multiple findNodesOfType/findNodesOfTypes calls with one traversal.
 *
 * Uses tree-sitter's TreeCursor API for faster traversal — avoids allocating
 * intermediate `.children` arrays at every node (major GC pressure reduction).
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

  const cursor = rootNode.walk();
  let reachedRoot = false;

  while (!reachedRoot) {
    const nodeType = cursor.nodeType;

    if (typeSet.has(nodeType)) {
      result.get(nodeType)!.push(cursor.currentNode);
    }

    // Depth-first: try to go to first child
    if (cursor.gotoFirstChild()) {
      continue;
    }

    // No children: try next sibling
    if (cursor.gotoNextSibling()) {
      continue;
    }

    // No siblings: walk up until we find a next sibling or reach root
    while (true) {
      if (!cursor.gotoParent()) {
        reachedRoot = true;
        break;
      }
      if (cursor.gotoNextSibling()) {
        break;
      }
    }
  }

  return result;
}

/** Generate a unique ID for an entity */
export function generateEntityId(filePath: string, kind: string, name: string, line: number): string {
  // Create a simple unique ID based on file, kind, name, and line
  const base = `${filePath}:${kind}:${name}:${line}`;
  // Simple hash-like ID
  return base.replace(/[^a-zA-Z0-9:_-]/g, '_');
}

/** Build the canonical identity fields for a TypeScript source symbol node. */
export function symbolIdentityForNode(options: {
  node: Parser.SyntaxNode;
  filePath: string;
  label: SourceSymbolLabel;
  declaredName: string;
  disambiguator?: string;
  includeBlockScopes?: boolean;
  scopeKeyOverride?: string;
}): SymbolIdentity {
  return buildSymbolIdentity({
    label: options.label,
    filePath: options.filePath,
    scopeKey: options.scopeKeyOverride ?? buildLexicalScopeKey(options.node, {
      includeBlockScopes: options.includeBlockScopes ?? false,
    }),
    declaredName: options.declaredName,
    disambiguator: options.disambiguator ?? '',
  });
}
