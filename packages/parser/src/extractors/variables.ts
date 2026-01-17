/**
 * Variable Entity Extractor
 * Extracts variable declarations from TypeScript/JavaScript AST
 */

import Parser from 'tree-sitter';
import type { VariableEntity, VariableKind } from '@codegraph/types';
import { findNodesOfTypes, generateEntityId } from './types';

/** Node types for variable declarations */
const VARIABLE_TYPES = [
  'variable_declaration',
  'lexical_declaration',
];

/**
 * Extract all variable entities from a syntax tree
 */
export function extractVariables(
  rootNode: Parser.SyntaxNode,
  filePath: string
): VariableEntity[] {
  const variables: VariableEntity[] = [];
  
  const declarationNodes = findNodesOfTypes(rootNode, VARIABLE_TYPES);
  
  for (const node of declarationNodes) {
    const extracted = parseVariableDeclaration(node, filePath);
    variables.push(...extracted);
  }
  
  return variables;
}

/**
 * Parse a variable declaration node
 * Returns multiple entities since one declaration can have multiple declarators
 */
function parseVariableDeclaration(
  node: Parser.SyntaxNode,
  filePath: string
): VariableEntity[] {
  const variables: VariableEntity[] = [];
  
  // Determine the kind (const, let, var)
  const kind = getVariableKind(node);
  const isExported = checkIsExported(node);
  
  // Find all variable_declarator children
  for (const child of node.children) {
    if (child.type === 'variable_declarator') {
      const varEntity = parseVariableDeclarator(child, filePath, kind, isExported);
      if (varEntity) {
        variables.push(varEntity);
      }
    }
  }
  
  return variables;
}

/**
 * Get the kind of variable declaration
 */
function getVariableKind(node: Parser.SyntaxNode): VariableKind {
  // Look for the keyword child
  for (const child of node.children) {
    if (child.text === 'const') return 'const';
    if (child.text === 'let') return 'let';
    if (child.text === 'var') return 'var';
  }
  
  // Default based on node type
  if (node.type === 'lexical_declaration') {
    return 'const'; // or let, but default to const
  }
  return 'var';
}

/**
 * Check if the variable is exported
 */
function checkIsExported(node: Parser.SyntaxNode): boolean {
  const parent = node.parent;
  return parent?.type === 'export_statement';
}

/**
 * Parse a single variable declarator
 */
function parseVariableDeclarator(
  node: Parser.SyntaxNode,
  filePath: string,
  kind: VariableKind,
  isExported: boolean
): VariableEntity | null {
  // Get the variable name
  const nameNode = node.childForFieldName('name');
  const name = nameNode?.text;
  if (!name) return null;
  
  // Skip object destructuring patterns for now
  if (nameNode.type === 'object_pattern' || nameNode.type === 'array_pattern') {
    return null;
  }
  
  const line = node.startPosition.row + 1;
  
  // Get type annotation if present
  const typeAnnotation = node.childForFieldName('type');
  const type = typeAnnotation?.text?.replace(/^:\s*/, '');
  
  const id = generateEntityId(filePath, 'variable', name, line);
  
  // Build entity with optional properties only when defined
  const entity: VariableEntity = {
    id,
    name,
    filePath,
    line,
    kind,
    isExported,
  };
  
  if (type) entity.type = type;
  
  return entity;
}
