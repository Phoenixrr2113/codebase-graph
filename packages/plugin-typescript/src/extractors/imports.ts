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
 * Represents a single re-exported symbol from an `export ... from '...'`
 * statement (a "barrel" re-export). Only re-exports that carry a source
 * module are captured here: `export { local }` (no `from`) is a plain local
 * export, not a re-export, and produces no entry.
 */
export interface ReExportEntity {
  /**
   * The name as exported from the source module. `'*'` denotes a star
   * re-export (`export * from '...'` or `export * as ns from '...'`), where
   * every name the source module exports flows through under its own name.
   */
  exportedName: string;
  /**
   * Local alias this re-export is bound to in this (barrel) file: set for
   * `export { x as y } from '...'` and `export * as ns from '...'`. Absent
   * when the re-exported name is used as-is (`export { x } from '...'`, bare
   * `export * from '...'`).
   */
  localName?: string;
  /** Original (unresolved) import source string, e.g. './origin'. */
  source: string;
  /** Resolved absolute path of the source file, if resolvable. */
  sourceResolvedPath?: string;
}

/**
 * Where a name is actually declared: the file that owns the declaration, and
 * the name it is declared under there (which may differ from the local alias
 * a given file imported or re-exported it as).
 *
 * Canonical shape shared by the barrel-chain resolver in @codegraph/core's
 * pipeline and by the type-ref extractor's cross-file resolution context.
 */
export interface ResolvedImportTarget {
  /** Absolute path of the file that actually declares the export (barrel chains already followed). */
  filePath: string;
  /** The name as declared at the origin file, not the local alias a consumer imported it as. */
  exportedName: string;
}

/** Local imported name (as used in the current file) mapped to its true origin. */
export type ResolvedImportMap = ReadonlyMap<string, ResolvedImportTarget>;

/** Declaration node types whose exported name lives in a single `name` field. */
const NAMED_DECLARATION_TYPES = new Set([
  'function_declaration',
  'generator_function_declaration',
  'class_declaration',
  'abstract_class_declaration',
  'interface_declaration',
  'type_alias_declaration',
  'enum_declaration',
]);

/**
 * Extract the names a file exports via a LOCAL declaration or a source-less
 * `export { x }` / `export { x as y }` clause: not names it re-exports FROM
 * another module (see `extractReExports` for that).
 *
 * Used as the base case for barrel-chain resolution: a file that both
 * re-exports from elsewhere (`export * from './other'`) AND declares its own
 * export under the walked name must stop at its own declaration, not keep
 * following an unrelated re-export just because it also has one.
 *
 * `export default ...` is intentionally not covered: a default export has no
 * single "declared name" to key on cheaply from the AST alone (the exported
 * value may be an anonymous expression), and no caller currently needs it.
 *
 * @param filePath - Unused internally (no path resolution needed for a purely
 *   local name), kept so this extractor's signature matches `extractReExports`
 *   for callers that walk a file's exports with both in one pass.
 */
export function extractLocalExportedNames(
  rootNode: Parser.SyntaxNode,
  filePath: string
): string[] {
  const names = new Set<string>();
  const exportNodes = findNodesOfType(rootNode, 'export_statement');

  for (const node of exportNodes) {
    if (node.childForFieldName('source')) continue; // re-export, handled by extractReExports

    const declaration = node.childForFieldName('declaration');
    if (declaration) {
      if (NAMED_DECLARATION_TYPES.has(declaration.type)) {
        const name = declaration.childForFieldName('name')?.text;
        if (name) names.add(name);
      } else if (declaration.type === 'lexical_declaration' || declaration.type === 'variable_declaration') {
        // export const a = 1, b = 2; -- one declarator per exported binding.
        for (const child of declaration.children) {
          if (child.type === 'variable_declarator') {
            const nameNode = child.childForFieldName('name');
            if (nameNode?.type === 'identifier') names.add(nameNode.text);
          }
        }
      }
      continue;
    }

    // export { a, b as c }; -- no `from`, so these are LOCAL bindings being
    // published under (possibly) a different public name.
    const exportClause = node.children.find((c) => c.type === 'export_clause');
    if (exportClause) {
      for (const specifier of exportClause.children) {
        if (specifier.type !== 'export_specifier') continue;
        const name = specifier.childForFieldName('name')?.text;
        const alias = specifier.childForFieldName('alias')?.text;
        const published = alias ?? name;
        if (published) names.add(published);
      }
    }
  }

  return Array.from(names);
}

/**
 * Extract barrel re-exports (`export * from '...'`, `export { x } from '...'`,
 * `export { x as y } from '...'`, `export * as ns from '...'`) from a syntax
 * tree. Plain local exports (`export { x }`, `export function f() {}`, no
 * `from` clause) are not re-exports and are skipped.
 *
 * This is a standalone walk, separate from `extractAllEntities`'s single-pass
 * collection: re-exports feed the cross-file barrel-chain resolution pass in
 * @codegraph/core's pipeline, not per-file entity extraction, so keeping this
 * pure and independent keeps that boundary clean.
 */
export function extractReExports(
  rootNode: Parser.SyntaxNode,
  filePath: string
): ReExportEntity[] {
  const reExports: ReExportEntity[] = [];
  const exportNodes = findNodesOfType(rootNode, 'export_statement');

  for (const node of exportNodes) {
    const sourceNode = node.childForFieldName('source');
    if (!sourceNode) continue; // local export, not a re-export

    const source = sourceNode.text.replace(/['"]/g, '');
    const resolvedPath = resolveImportPath(source, filePath);

    const namespaceExport = node.children.find((c) => c.type === 'namespace_export');
    if (namespaceExport) {
      // export * as ns from '...'
      const alias = namespaceExport.children.find((c) => c.type === 'identifier')?.text;
      const entry: ReExportEntity = { exportedName: '*', source };
      if (alias) entry.localName = alias;
      if (resolvedPath) entry.sourceResolvedPath = resolvedPath;
      reExports.push(entry);
      continue;
    }

    const exportClause = node.children.find((c) => c.type === 'export_clause');
    if (exportClause) {
      // export { x } from '...'; export { x as y } from '...'
      for (const specifier of exportClause.children) {
        if (specifier.type !== 'export_specifier') continue;
        const name = specifier.childForFieldName('name')?.text;
        if (!name) continue;
        const alias = specifier.childForFieldName('alias')?.text;
        const entry: ReExportEntity = { exportedName: name, source };
        if (alias) entry.localName = alias;
        if (resolvedPath) entry.sourceResolvedPath = resolvedPath;
        reExports.push(entry);
      }
      continue;
    }

    // Bare `export * from '...'`: no clause, no namespace binding.
    const entry: ReExportEntity = { exportedName: '*', source };
    if (resolvedPath) entry.sourceResolvedPath = resolvedPath;
    reExports.push(entry);
  }

  return reExports;
}

/**
 * Extract imports from pre-collected import_statement nodes (single-pass mode)
 */
export function extractImportsFromNodes(
  importNodes: Parser.SyntaxNode[],
  filePath: string
): ImportEntity[] {
  const imports: ImportEntity[] = [];
  for (const node of importNodes) {
    const importEntity = parseImportStatement(node, filePath);
    if (importEntity) {
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
