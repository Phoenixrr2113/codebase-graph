/**
 * Type Entity Extractor
 * Extracts type aliases, interfaces, and enums from TypeScript AST
 */

import Parser from 'tree-sitter';
import type { TypeEntity, InterfaceEntity } from '@codegraph/types';
import { findNodesOfType, getLocation, generateEntityId } from './types';

/**
 * Extract all type entities from a syntax tree
 */
export function extractTypes(
  rootNode: Parser.SyntaxNode,
  filePath: string
): TypeEntity[] {
  const types: TypeEntity[] = [];
  
  // Type aliases
  const typeAliasNodes = findNodesOfType(rootNode, 'type_alias_declaration');
  for (const node of typeAliasNodes) {
    const typeEntity = parseTypeAlias(node, filePath);
    if (typeEntity) {
      types.push(typeEntity);
    }
  }
  
  // Enums
  const enumNodes = findNodesOfType(rootNode, 'enum_declaration');
  for (const node of enumNodes) {
    const enumEntity = parseEnum(node, filePath);
    if (enumEntity) {
      types.push(enumEntity);
    }
  }
  
  return types;
}

/**
 * Extract all interface entities from a syntax tree
 */
export function extractInterfaces(
  rootNode: Parser.SyntaxNode,
  filePath: string
): InterfaceEntity[] {
  const interfaces: InterfaceEntity[] = [];
  
  const interfaceNodes = findNodesOfType(rootNode, 'interface_declaration');
  
  for (const node of interfaceNodes) {
    const interfaceEntity = parseInterface(node, filePath);
    if (interfaceEntity) {
      interfaces.push(interfaceEntity);
    }
  }
  
  return interfaces;
}

/**
 * Parse a type alias declaration
 */
function parseTypeAlias(
  node: Parser.SyntaxNode,
  filePath: string
): TypeEntity | null {
  const nameNode = node.childForFieldName('name');
  const name = nameNode?.text;
  if (!name) return null;
  
  const location = getLocation(node);
  const isExported = checkIsExported(node);
  const docstring = getDocstring(node);
  
  const id = generateEntityId(filePath, 'type', name, location.startLine);
  
  // Build entity with optional properties only when defined
  const entity: TypeEntity = {
    id,
    name,
    filePath,
    startLine: location.startLine,
    endLine: location.endLine,
    isExported,
    kind: 'type',
  };
  
  if (docstring) entity.docstring = docstring;
  
  return entity;
}

/**
 * Parse an enum declaration
 */
function parseEnum(
  node: Parser.SyntaxNode,
  filePath: string
): TypeEntity | null {
  const nameNode = node.childForFieldName('name');
  const name = nameNode?.text;
  if (!name) return null;
  
  const location = getLocation(node);
  const isExported = checkIsExported(node);
  const docstring = getDocstring(node);
  
  const id = generateEntityId(filePath, 'enum', name, location.startLine);
  
  // Build entity with optional properties only when defined
  const entity: TypeEntity = {
    id,
    name,
    filePath,
    startLine: location.startLine,
    endLine: location.endLine,
    isExported,
    kind: 'enum',
  };
  
  if (docstring) entity.docstring = docstring;
  
  return entity;
}

/**
 * Parse an interface declaration
 */
function parseInterface(
  node: Parser.SyntaxNode,
  filePath: string
): InterfaceEntity | null {
  const nameNode = node.childForFieldName('name');
  const name = nameNode?.text;
  if (!name) return null;
  
  const location = getLocation(node);
  const isExported = checkIsExported(node);
  const extendsList = getExtendsList(node);
  const docstring = getDocstring(node);
  
  const id = generateEntityId(filePath, 'interface', name, location.startLine);
  
  // Build entity with optional properties only when defined
  const entity: InterfaceEntity = {
    id,
    name,
    filePath,
    startLine: location.startLine,
    endLine: location.endLine,
    isExported,
  };
  
  if (extendsList.length > 0) entity.extends = extendsList;
  if (docstring) entity.docstring = docstring;
  
  return entity;
}

/**
 * Check if the type is exported
 */
function checkIsExported(node: Parser.SyntaxNode): boolean {
  const parent = node.parent;
  return parent?.type === 'export_statement';
}

/**
 * Get the list of extended interfaces
 */
function getExtendsList(node: Parser.SyntaxNode): string[] {
  const extendsList: string[] = [];
  
  for (const child of node.children) {
    if (child.type === 'extends_clause' || child.type === 'extends_type_clause') {
      for (const typeChild of child.children) {
        if (typeChild.type === 'type_identifier' ||
            typeChild.type === 'identifier') {
          extendsList.push(typeChild.text);
        }
      }
    }
  }
  
  return extendsList;
}

/**
 * Get JSDoc comment above the type
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
