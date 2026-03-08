/**
 * Import Entity Extractor
 * Extracts import statements from TypeScript/JavaScript AST
 */

import Parser from 'tree-sitter';
import { existsSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import type { ImportEntity, ImportSpecifier } from '@codegraph/types';
import { findNodesOfType, generateEntityId } from './types';

/** File extensions to try when resolving imports */
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];

/**
 * Resolve an import source to an absolute file path
 * @param source - The import source (e.g., './utils', 'react')
 * @param importingFilePath - Absolute path of the file containing the import
 * @returns Resolved absolute path or undefined if unresolvable
 */
function resolveImportPath(source: string, importingFilePath: string): string | undefined {
  // Skip package imports (no leading . or /)
  if (!source.startsWith('.') && !source.startsWith('/')) {
    return undefined;
  }

  const dir = dirname(importingFilePath);
  const basePath = resolve(dir, source);

  // If already has extension, check directly OR try swapping .js -> .ts
  const sourceExt = extname(source);
  if (sourceExt) {
    // Direct check
    if (existsSync(basePath)) return basePath;

    // TypeScript uses .js in imports but the source files are .ts/.tsx
    // Try swapping .js/.jsx/.mjs/.cjs -> .ts/.tsx/.mts/.cts
    const extMap: Record<string, string[]> = {
      '.js': ['.ts', '.tsx'],
      '.jsx': ['.tsx', '.ts'],
      '.mjs': ['.mts', '.ts'],
      '.cjs': ['.cts', '.ts'],
    };
    const alternates = extMap[sourceExt];
    if (alternates) {
      const baseWithoutExt = basePath.slice(0, -sourceExt.length);
      for (const alt of alternates) {
        const altPath = baseWithoutExt + alt;
        if (existsSync(altPath)) return altPath;
      }
    }
    return undefined;
  }

  // Try with various extensions
  for (const ext of RESOLVE_EXTENSIONS) {
    const fullPath = basePath + ext;
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }

  // Try as directory with index file
  for (const ext of RESOLVE_EXTENSIONS) {
    const indexPath = resolve(basePath, `index${ext}`);
    if (existsSync(indexPath)) {
      return indexPath;
    }
  }

  return undefined;
}

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
      // Resolve the import path (only set if resolved successfully)
      const resolved = resolveImportPath(importEntity.source, filePath);
      if (resolved) {
        importEntity.resolvedPath = resolved;
      }
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
