/**
 * Type Entity Extractor
 * Extracts type aliases, interfaces, and enums from TypeScript AST
 */

import Parser from 'tree-sitter';
import type { TypeEntity, InterfaceEntity } from '@codegraph/types';
import { findNodesOfType, getLocation, symbolIdentityForNode } from './types';
import { buildLexicalScopeKey, occurrenceDisambiguator } from '@codegraph/plugin-common';

/**
 * Extract all type entities from a syntax tree
 */
export function extractTypes(
  rootNode: Parser.SyntaxNode,
  filePath: string
): TypeEntity[] {
  const typeAliasNodes = findNodesOfType(rootNode, 'type_alias_declaration');
  const enumNodes = findNodesOfType(rootNode, 'enum_declaration');
  return extractTypeDeclarationsFromNodes(typeAliasNodes, enumNodes, filePath);
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
  
  return mergeInterfaceDeclarations(interfaces);
}

/**
 * Extract types from pre-collected type alias and enum nodes (single-pass mode)
 */
export function extractTypesFromNodes(
  typeAliasNodes: Parser.SyntaxNode[],
  enumNodes: Parser.SyntaxNode[],
  filePath: string
): TypeEntity[] {
  return extractTypeDeclarationsFromNodes(typeAliasNodes, enumNodes, filePath);
}

function extractTypeDeclarationsFromNodes(
  typeAliasNodes: Parser.SyntaxNode[],
  enumNodes: Parser.SyntaxNode[],
  filePath: string,
): TypeEntity[] {
  const candidates = [
    ...typeAliasNodes.map((node) => ({ node, kind: 'type' as const })),
    ...enumNodes.map((node) => ({ node, kind: 'enum' as const })),
  ].flatMap((candidate) => {
    const name = candidate.node.childForFieldName('name')?.text;
    return name ? [{ ...candidate, name, scopeKey: buildLexicalScopeKey(candidate.node) }] : [];
  }).sort((left, right) => left.node.startIndex - right.node.startIndex);

  const groups = new Map<string, typeof candidates>();
  for (const candidate of candidates) {
    const key = `${candidate.scopeKey}\u0000${candidate.name}`;
    const group = groups.get(key) ?? [];
    group.push(candidate);
    groups.set(key, group);
  }

  const types: TypeEntity[] = [];
  for (const group of groups.values()) {
    const declarationsMerge = group.every((candidate) => candidate.kind === 'enum');
    for (let index = 0; index < group.length; index++) {
      const candidate = group[index]!;
      const disambiguator = group.length > 1 && !declarationsMerge
        ? occurrenceDisambiguator(index + 1)
        : '';
      const entity = candidate.kind === 'enum'
        ? parseEnum(candidate.node, filePath, disambiguator)
        : parseTypeAlias(candidate.node, filePath, disambiguator);
      if (entity) types.push(entity);
    }
  }
  return mergeTypeDeclarations(types);
}

/**
 * Extract interfaces from pre-collected interface nodes (single-pass mode)
 */
export function extractInterfacesFromNodes(
  interfaceNodes: Parser.SyntaxNode[],
  filePath: string
): InterfaceEntity[] {
  const interfaces: InterfaceEntity[] = [];
  for (const node of interfaceNodes) {
    const interfaceEntity = parseInterface(node, filePath);
    if (interfaceEntity) interfaces.push(interfaceEntity);
  }
  return mergeInterfaceDeclarations(interfaces);
}

/**
 * Parse a type alias declaration
 */
function parseTypeAlias(
  node: Parser.SyntaxNode,
  filePath: string,
  disambiguator: string,
): TypeEntity | null {
  const nameNode = node.childForFieldName('name');
  const name = nameNode?.text;
  if (!name) return null;
  
  const location = getLocation(node);
  const isExported = checkIsExported(node);
  const docstring = getDocstring(node);
  
  const identity = symbolIdentityForNode({
    node,
    filePath,
    label: 'Type',
    declaredName: name,
    disambiguator,
  });
  
  // Build entity with optional properties only when defined
  const entity: TypeEntity = {
    ...identity,
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
  filePath: string,
  disambiguator: string,
): TypeEntity | null {
  const nameNode = node.childForFieldName('name');
  const name = nameNode?.text;
  if (!name) return null;
  
  const location = getLocation(node);
  const isExported = checkIsExported(node);
  const docstring = getDocstring(node);
  
  const identity = symbolIdentityForNode({
    node,
    filePath,
    label: 'Type',
    declaredName: name,
    disambiguator,
  });
  
  // Build entity with optional properties only when defined
  const entity: TypeEntity = {
    ...identity,
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
  
  const identity = symbolIdentityForNode({
    node,
    filePath,
    label: 'Interface',
    declaredName: name,
  });
  
  // Build entity with optional properties only when defined
  const entity: InterfaceEntity = {
    ...identity,
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

function mergeInterfaceDeclarations(interfaces: InterfaceEntity[]): InterfaceEntity[] {
  const merged = new Map<string, InterfaceEntity>();
  for (const declaration of interfaces) {
    const existing = merged.get(declaration.id);
    if (!existing) {
      merged.set(declaration.id, declaration);
      continue;
    }
    existing.startLine = Math.min(existing.startLine, declaration.startLine);
    existing.endLine = Math.max(existing.endLine, declaration.endLine);
    existing.isExported ||= declaration.isExported;
    existing.extends = Array.from(new Set([...(existing.extends ?? []), ...(declaration.extends ?? [])]));
    if (!existing.docstring && declaration.docstring) existing.docstring = declaration.docstring;
  }
  return Array.from(merged.values());
}

function mergeTypeDeclarations(types: TypeEntity[]): TypeEntity[] {
  const merged = new Map<string, TypeEntity>();
  for (const declaration of types) {
    const existing = merged.get(declaration.id);
    if (!existing) {
      merged.set(declaration.id, declaration);
      continue;
    }
    existing.startLine = Math.min(existing.startLine, declaration.startLine);
    existing.endLine = Math.max(existing.endLine, declaration.endLine);
    existing.isExported ||= declaration.isExported;
    if (!existing.docstring && declaration.docstring) existing.docstring = declaration.docstring;
  }
  return Array.from(merged.values());
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
