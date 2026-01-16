/**
 * Import Entity Extractor
 * Extracts import statements from TypeScript/JavaScript AST
 */

import Parser from 'tree-sitter';
import type { ImportEntity, ImportSpecifier } from '@codegraph/types';
import { findNodesOfType, generateEntityId } from './types.js';

/**
 * Extract all import entities from a syntax tree
 */
export function extractImports(
  rootNode: Parser.SyntaxNode,
  filePath: string
): ImportEntity[] {
  const imports: ImportEntity[] = [];
  
  // Find all import_statement nodes
  const importNodes = findNodesOfType(rootNode, 'import_statement');
  
  for (const node of importNodes) {
    const importEntity = parseImportStatement(node, filePath);
    if (importEntity) {
      imports.push(importEntity);
    }
  }
  
  return imports;
}

/**
 * Parse a single import statement node
 */
function parseImportStatement(
  node: Parser.SyntaxNode,
  filePath: string
): ImportEntity | null {
  // Get the source (import path)
  const sourceNode = node.childForFieldName('source');
  if (!sourceNode) return null;
  
  // Remove quotes from the source
  const source = sourceNode.text.replace(/['"]/g, '');
  
  let isDefault = false;
  let isNamespace = false;
  let defaultAlias: string | undefined;
  let namespaceAlias: string | undefined;
  const specifiers: ImportSpecifier[] = [];
  
  // Traverse children to find import clauses
  for (const child of node.children) {
    if (child.type === 'import_clause') {
      parseImportClause(child, {
        setDefault: (name) => { isDefault = true; defaultAlias = name; },
        setNamespace: (name) => { isNamespace = true; namespaceAlias = name; },
        addSpecifier: (spec) => specifiers.push(spec),
      });
    }
  }
  
  // Generate ID
  const line = node.startPosition.row + 1;
  const id = generateEntityId(filePath, 'import', source, line);
  
  // Build entity with optional properties only when defined
  const entity: ImportEntity = {
    id,
    source,
    filePath,
    isDefault,
    isNamespace,
    specifiers,
  };
  
  if (defaultAlias) entity.defaultAlias = defaultAlias;
  if (namespaceAlias) entity.namespaceAlias = namespaceAlias;
  
  return entity;
}

/**
 * Parse import clause (the part between 'import' and 'from')
 */
function parseImportClause(
  node: Parser.SyntaxNode,
  handlers: {
    setDefault: (name: string) => void;
    setNamespace: (name: string) => void;
    addSpecifier: (spec: ImportSpecifier) => void;
  }
): void {
  for (const child of node.children) {
    switch (child.type) {
      case 'identifier':
        // Default import: import X from 'module'
        handlers.setDefault(child.text);
        break;
        
      case 'namespace_import':
        // Namespace import: import * as X from 'module'
        // The identifier is a direct child of namespace_import
        for (const subChild of child.children) {
          if (subChild.type === 'identifier') {
            handlers.setNamespace(subChild.text);
            break;
          }
        }
        break;
        
      case 'named_imports':
        // Named imports: import { a, b as c } from 'module'
        parseNamedImports(child, handlers.addSpecifier);
        break;
    }
  }
}

/**
 * Parse named imports { a, b as c }
 */
function parseNamedImports(
  node: Parser.SyntaxNode,
  addSpecifier: (spec: ImportSpecifier) => void
): void {
  for (const child of node.children) {
    if (child.type === 'import_specifier') {
      const name = child.childForFieldName('name');
      const alias = child.childForFieldName('alias');
      
      if (name) {
        const spec: ImportSpecifier = { name: name.text };
        if (alias) spec.alias = alias.text;
        addSpecifier(spec);
      }
    }
  }
}
