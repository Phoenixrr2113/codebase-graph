/**
 * Class Entity Extractor
 * Extracts class declarations from TypeScript/JavaScript AST
 */

import Parser from 'tree-sitter';
import type { ClassEntity } from '@codegraph/types';
import { findNodesOfType, getLocation, generateEntityId } from './types';

/**
 * Extract all class entities from a syntax tree
 */
export function extractClasses(
  rootNode: Parser.SyntaxNode,
  filePath: string
): ClassEntity[] {
  const classes: ClassEntity[] = [];
  
  const classNodes = findNodesOfType(rootNode, 'class_declaration');
  
  for (const node of classNodes) {
    const classEntity = parseClassNode(node, filePath);
    if (classEntity) {
      classes.push(classEntity);
    }
  }
  
  // Also find class expressions
  const classExprNodes = findNodesOfType(rootNode, 'class');
  for (const node of classExprNodes) {
    const classEntity = parseClassNode(node, filePath);
    if (classEntity) {
      classes.push(classEntity);
    }
  }
  
  return classes;
}

/**
 * Parse a class node into a ClassEntity
 */
function parseClassNode(
  node: Parser.SyntaxNode,
  filePath: string
): ClassEntity | null {
  // Get class name
  const nameNode = node.childForFieldName('name');
  const name = nameNode?.text;
  if (!name) return null; // Skip anonymous classes
  
  const location = getLocation(node);
  const isExported = checkIsExported(node);
  const isAbstract = checkIsAbstract(node);
  const extendsClass = getExtendsClass(node);
  const implementsList = getImplementsList(node);
  const docstring = getDocstring(node);
  
  const id = generateEntityId(filePath, 'class', name, location.startLine);
  
  // Build entity with optional properties only when defined
  const entity: ClassEntity = {
    id,
    name,
    filePath,
    startLine: location.startLine,
    endLine: location.endLine,
    isExported,
    isAbstract,
  };
  
  if (extendsClass) entity.extends = extendsClass;
  if (implementsList && implementsList.length > 0) entity.implements = implementsList;
  if (docstring) entity.docstring = docstring;
  
  return entity;
}

/**
 * Check if the class is exported
 */
function checkIsExported(node: Parser.SyntaxNode): boolean {
  const parent = node.parent;
  return parent?.type === 'export_statement';
}

/**
 * Check if the class is abstract
 */
function checkIsAbstract(node: Parser.SyntaxNode): boolean {
  // Look for abstract keyword
  for (const child of node.children) {
    if (child.type === 'abstract') return true;
  }
  
  // Also check parent for abstract modifier
  const parent = node.parent;
  if (parent) {
    for (const sibling of parent.children) {
      if (sibling.text === 'abstract') return true;
    }
  }
  
  return false;
}

/**
 * Get the extended class name
 */
function getExtendsClass(node: Parser.SyntaxNode): string | undefined {
  // Find class_heritage node
  for (const child of node.children) {
    if (child.type === 'class_heritage') {
      // Look for extends_clause
      for (const heritageChild of child.children) {
        if (heritageChild.type === 'extends_clause') {
          // Get the extended type
          const typeNode = heritageChild.childForFieldName('value') ||
            heritageChild.children.find(c => c.type === 'identifier' || c.type === 'type_identifier');
          return typeNode?.text;
        }
      }
    }
  }
  return undefined;
}

/**
 * Get the list of implemented interfaces
 */
function getImplementsList(node: Parser.SyntaxNode): string[] {
  const implementsList: string[] = [];
  
  for (const child of node.children) {
    if (child.type === 'class_heritage') {
      for (const heritageChild of child.children) {
        if (heritageChild.type === 'implements_clause') {
          // Get all implemented types
          for (const typeChild of heritageChild.children) {
            if (typeChild.type === 'type_identifier' ||
                typeChild.type === 'identifier') {
              implementsList.push(typeChild.text);
            }
          }
        }
      }
    }
  }
  
  return implementsList;
}

/**
 * Get JSDoc comment above the class
 */
function getDocstring(node: Parser.SyntaxNode): string | undefined {
  const parent = node.parent;
  if (!parent) return undefined;
  
  const siblings = parent.children;
  const index = siblings.indexOf(node);
  
  if (index > 0) {
    const prevSibling = siblings[index - 1];
    if (prevSibling && prevSibling.type === 'comment' &&
        prevSibling.text.startsWith('/**')) {
      return prevSibling.text;
    }
  }
  
  return undefined;
}
