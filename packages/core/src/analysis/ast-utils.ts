import type Parser from 'tree-sitter';

/**
 * Walk AST nodes recursively and call visitor for each
 */
export function walkNode(
  node: Parser.SyntaxNode,
  visitor: (node: Parser.SyntaxNode) => void
): void {
  visitor(node);
  for (const child of node.children) {
    walkNode(child, visitor);
  }
}

/**
 * Extract method name from call expression text
 * e.g., "db.query" -> "query", "knex.raw" -> "raw"
 */
export function getMethodName(text: string): string {
  const parts = text.split('.');
  return parts[parts.length - 1] || text;
}

/**
 * Extract property name from member expression
 * e.g., "element.innerHTML" -> "innerHTML"
 */
export function getPropertyName(text: string): string {
  const parts = text.split('.');
  return parts[parts.length - 1] || text;
}
