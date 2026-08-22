/**
 * @codegraph/plugin-rust
 * Rust language plugin for CodeGraph
 *
 * Extracts structs (→ Class), traits (→ Interface), functions, methods,
 * variables (const/static), imports (use), type aliases/enums, and call
 * references from Rust source files using tree-sitter-rust.
 *
 * Rust Mapping:
 *   struct → ClassEntity
 *   trait → InterfaceEntity
 *   fn (top-level) → FunctionEntity
 *   impl methods → FunctionEntity (receiver encoded in id)
 *   const/static → VariableEntity
 *   use → ImportEntity
 *   type alias → TypeEntity (kind: 'type')
 *   enum → TypeEntity (kind: 'enum')
 *   impl Trait for Struct → InheritanceReference (implements)
 *   trait X: Y → InheritanceReference (extends)
 */

import Rust from 'tree-sitter-rust';
import { existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import type {
  FunctionEntity,
  ClassEntity,
  InterfaceEntity,
  VariableEntity,
  ImportEntity,
  TypeEntity,
  InheritanceReference,
  CallReference,
  CallExtractionContext,
  SyntaxNode,
  HasMethodEdgeDescriptor,
  HasPropertyEdgeDescriptor,
  HasParamEdgeDescriptor,
  ReturnsEdgeDescriptor,
  UsesTypeEdgeDescriptor,
  Visibility,
} from '@codegraph/types';
import type { TypeRefEntity } from '@codegraph/types';
import {
  buildLexicalScopeKey,
  buildSymbolIdentity,
  calculateComplexity,
  findNodesOfType,
  generateEntityId,
  resolveTypeIdentity,
  type SourceSymbolLabel,
} from '@codegraph/plugin-common';
import { createLanguagePlugin } from '@codegraph/plugin-generic';

export function getGrammar(): unknown {
  return Rust;
}

/**
 * Check if a Rust item has `pub` visibility.
 */
function isPublic(node: SyntaxNode): boolean {
  return node.children.some((c: SyntaxNode) => c.type === 'visibility_modifier');
}

function sourceIdentity(
  node: SyntaxNode,
  filePath: string,
  label: SourceSymbolLabel,
  declaredName: string,
  scopeKeyOverride?: string,
) {
  return buildSymbolIdentity({
    label,
    filePath,
    scopeKey: scopeKeyOverride ?? buildLexicalScopeKey(node),
    declaredName,
    disambiguator: '',
  });
}

// ============================================================================
// Doc Comment Extraction
// ============================================================================

/**
 * Extract Rust doc comments from a declaration node.
 * Rust doc comments are /// line comments or block comments
 * immediately preceding the declaration.
 */
function extractDocComment(node: SyntaxNode): string | undefined {
  const commentLines: string[] = [];
  let current = node.previousSibling;

  while (current) {
    if (current.type === 'line_comment') {
      const text = current.text;
      if (text.startsWith('///')) {
        // Doc comment — strip prefix
        commentLines.unshift(text.slice(3).trim());
      } else if (text.startsWith('//')) {
        // Regular comment — stop collecting
        break;
      }
      current = current.previousSibling;
    } else if (current.type === 'block_comment') {
      const text = current.text;
      if (text.startsWith('/**')) {
        // Doc block comment — strip delimiters
        const cleaned = text
          .slice(3, -2)
          .split('\n')
          .map((line) => line.replace(/^\s*\*\s?/, '').trim())
          .filter((line) => line.length > 0)
          .join('\n');
        if (cleaned) commentLines.unshift(cleaned);
      }
      break;
    } else {
      break;
    }
  }

  return commentLines.length > 0 ? commentLines.join('\n') : undefined;
}

// ============================================================================
// Struct Extraction (→ ClassEntity)
// ============================================================================

/**
 * Extract struct declarations from Rust AST.
 *
 * Rust AST shape:
 *   struct_item {name, body}
 *     visibility_modifier?
 *     type_identifier (name)
 *     field_declaration_list (body)
 */
export function extractClasses(root: SyntaxNode, filePath: string): ClassEntity[] {
  const classes: ClassEntity[] = [];
  const structItems = findNodesOfType(root, ['struct_item']);

  for (const node of structItems) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const isExported = isPublic(node);
    const docstring = extractDocComment(node);
    const identity = sourceIdentity(node, filePath, 'Class', name);

    const entity: ClassEntity = {
      ...identity,
      name,
      filePath,
      startLine,
      endLine,
      isExported,
      isAbstract: false, // Rust structs are never abstract
    };

    if (docstring) entity.docstring = docstring;
    classes.push(entity);
  }

  return classes;
}

// ============================================================================
// Trait Extraction (→ InterfaceEntity)
// ============================================================================

/**
 * Extract trait declarations from Rust AST.
 *
 * Rust AST shape:
 *   trait_item {name, body}
 *     visibility_modifier?
 *     type_identifier (name)
 *     trait_bounds? (supertraits: ": Handler + Send")
 *     declaration_list (body)
 */
export function extractInterfaces(root: SyntaxNode, filePath: string): InterfaceEntity[] {
  const interfaces: InterfaceEntity[] = [];
  const traitItems = findNodesOfType(root, ['trait_item']);

  for (const node of traitItems) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const isExported = isPublic(node);
    const docstring = extractDocComment(node);
    const identity = sourceIdentity(node, filePath, 'Interface', name);

    // Extract supertraits (trait bounds)
    const extendsList: string[] = [];
    const boundsNode = node.children.find((c: SyntaxNode) => c.type === 'trait_bounds');
    if (boundsNode) {
      for (const child of boundsNode.children) {
        if (child.type === 'type_identifier') {
          extendsList.push(child.text);
        }
      }
    }

    const entity: InterfaceEntity = {
      ...identity,
      name,
      filePath,
      startLine,
      endLine,
      isExported,
    };

    if (extendsList.length > 0) entity.extends = extendsList;
    if (docstring) entity.docstring = docstring;

    interfaces.push(entity);
  }

  return interfaces;
}

// ============================================================================
// Function & Method Extraction
// ============================================================================

/**
 * Extract function and method declarations from Rust AST.
 *
 * Rust AST shapes:
 *   function_item {name, parameters, return_type, body}
 *     visibility_modifier?
 *     identifier (name)
 *     parameters
 *     type (return_type)
 *     block (body)
 *
 * Methods are function_item nodes inside impl_item > declaration_list.
 */
export function extractFunctions(root: SyntaxNode, filePath: string): FunctionEntity[] {
  const functions: FunctionEntity[] = [];

  // Top-level functions (direct children of source_file)
  const topLevelFuncs = root.children.filter((c: SyntaxNode) => c.type === 'function_item');
  for (const node of topLevelFuncs) {
    const fn = extractFunctionFromNode(node, filePath, undefined);
    if (fn) functions.push(fn);
  }

  // Methods inside impl blocks
  const implItems = findNodesOfType(root, ['impl_item']);
  for (const impl of implItems) {
    const typeNode = impl.childForFieldName('type');
    const implTypeName = typeNode?.text;

    const bodyNode = impl.childForFieldName('body');
    if (!bodyNode) continue;

    for (const child of bodyNode.children) {
      if (child.type === 'function_item') {
        const fn = extractFunctionFromNode(child, filePath, implTypeName);
        if (fn) functions.push(fn);
      }
    }
  }

  return functions;
}

/**
 * Extract a single function entity from a function_item node.
 */
function extractFunctionFromNode(
  node: SyntaxNode,
  filePath: string,
  implType: string | undefined,
): FunctionEntity | undefined {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return undefined;

  const name = nameNode.text;
  const startLine = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const isExported = isPublic(node);
  const params = extractRustParams(node);
  const returnType = extractRustReturnType(node);
  const docstring = extractDocComment(node);

  const identity = sourceIdentity(
    node,
    filePath,
    'Function',
    name,
    implType ? `Impl:${implType}` : undefined,
  );

  const entity: FunctionEntity = {
    ...identity,
    name,
    filePath,
    startLine,
    endLine,
    isExported,
    isAsync: node.children.some(
      (c: SyntaxNode) => c.type === 'function_modifiers' && c.text.includes('async'),
    ),
    isArrow: false,
    params,
  };

  if (returnType) entity.returnType = returnType;
  if (docstring) entity.docstring = docstring;

  // Universal complexity metrics
  const metrics = calculateComplexity(node);
  entity.complexity = metrics.cyclomatic;
  entity.cognitiveComplexity = metrics.cognitive;
  entity.nestingDepth = metrics.nestingDepth;

  return entity;
}

/**
 * Extract parameters from a Rust function.
 */
function extractRustParams(
  funcNode: SyntaxNode,
): { name: string; type?: string; optional?: boolean }[] {
  const params: { name: string; type?: string; optional?: boolean }[] = [];

  const paramList = funcNode.childForFieldName('parameters');
  if (!paramList) return params;

  for (const child of paramList.children) {
    if (child.type === 'parameter') {
      const patternNode = child.childForFieldName('pattern');
      const typeNode = child.childForFieldName('type');

      const paramName = patternNode?.text || '_';
      const p: { name: string; type?: string } = { name: paramName };
      if (typeNode) p.type = typeNode.text;
      params.push(p);
    } else if (child.type === 'self_parameter') {
      params.push({ name: 'self', type: child.text });
    }
  }

  return params;
}

/**
 * Extract return type from a Rust function.
 */
function extractRustReturnType(funcNode: SyntaxNode): string | undefined {
  const returnTypeNode = funcNode.childForFieldName('return_type');
  if (!returnTypeNode) return undefined;
  return returnTypeNode.text;
}

// ============================================================================
// Variable Extraction (const, static)
// ============================================================================

/**
 * Extract const and static declarations from Rust AST.
 *
 * Rust AST shapes:
 *   const_item: const NAME: TYPE = VALUE;
 *   static_item: static NAME: TYPE = VALUE;
 */
export function extractVariables(root: SyntaxNode, filePath: string): VariableEntity[] {
  const variables: VariableEntity[] = [];

  // const items
  const constItems = findNodesOfType(root, ['const_item']);
  for (const node of constItems) {
    extractVarFromNode(node, filePath, 'const', variables);
  }

  // static items
  const staticItems = findNodesOfType(root, ['static_item']);
  for (const node of staticItems) {
    extractVarFromNode(node, filePath, 'let', variables);
  }

  return variables;
}

/**
 * Extract a variable entity from a const_item or static_item.
 */
function extractVarFromNode(
  node: SyntaxNode,
  filePath: string,
  kind: 'const' | 'let',
  variables: VariableEntity[],
): void {
  // Name is the identifier child (not a field in tree-sitter-rust for const/static)
  const nameNode = node.children.find(
    (c: SyntaxNode) => c.type === 'identifier',
  );
  if (!nameNode) return;

  const name = nameNode.text;
  const line = node.startPosition.row + 1;
  const isExported = isPublic(node);
  const identity = sourceIdentity(node, filePath, 'Variable', name);

  // Find type annotation (the node after ':')
  const colonIndex = node.children.findIndex((c: SyntaxNode) => c.type === ':');
  let typeText: string | undefined;
  if (colonIndex >= 0 && colonIndex + 1 < node.children.length) {
    const typeNode = node.children[colonIndex + 1];
    if (typeNode && typeNode.type !== '=' && typeNode.type !== ';') {
      typeText = typeNode.text;
    }
  }

  const entity: VariableEntity = {
    ...identity,
    name,
    filePath,
    line,
    kind,
    isExported,
  };
  if (typeText) entity.type = typeText;
  variables.push(entity);
}

// ============================================================================
// Import Extraction (use declarations)
// ============================================================================

/**
 * Extract use declarations from Rust AST.
 *
 * Rust AST shapes:
 *   use_declaration
 *     scoped_identifier → simple path: use std::collections::HashMap
 *     scoped_use_list → grouped: use std::io::{Read, Write}
 *     use_wildcard → glob: use std::io::*
 *     use_as_clause → aliased: use std::io::Read as MyRead
 *     identifier → single crate: use serde
 */
export function extractImports(root: SyntaxNode, filePath: string): ImportEntity[] {
  const imports: ImportEntity[] = [];
  const useDecls = findNodesOfType(root, ['use_declaration']);

  for (const decl of useDecls) {
    extractUseDecl(decl, filePath, imports);
  }

  return imports;
}

function extractUseDecl(
  decl: SyntaxNode,
  filePath: string,
  imports: ImportEntity[],
): void {
  // Find the use argument (skip 'use', 'pub', ';')
  for (const child of decl.children) {
    if (child.type === 'scoped_identifier') {
      // Simple path: use std::collections::HashMap
      const fullPath = child.text;
      const parts = fullPath.split('::');
      const lastName = parts[parts.length - 1] || fullPath;
      const line = decl.startPosition.row + 1;
      const id = generateEntityId(filePath, 'import', fullPath, line);

      imports.push({
        id,
        filePath,
        source: fullPath,
        isDefault: false,
        isNamespace: false,
        specifiers: [{ name: lastName }],
      });
    } else if (child.type === 'scoped_use_list') {
      // Grouped: use std::io::{Read, Write}
      extractScopedUseList(child, decl, filePath, imports);
    } else if (child.type === 'use_wildcard') {
      // Glob: use std::io::*
      const path = child.text.replace('::*', '');
      const line = decl.startPosition.row + 1;
      const id = generateEntityId(filePath, 'import', path, line);

      imports.push({
        id,
        filePath,
        source: path,
        isDefault: false,
        isNamespace: true,
        specifiers: [],
      });
    } else if (child.type === 'use_as_clause') {
      // Aliased: use std::io::Read as MyRead
      const pathNode = child.children.find(
        (c: SyntaxNode) => c.type === 'scoped_identifier' || c.type === 'identifier',
      );
      const aliasNode = child.childForFieldName('alias');

      if (pathNode) {
        const fullPath = pathNode.text;
        const parts = fullPath.split('::');
        const lastName = parts[parts.length - 1] || fullPath;
        const line = decl.startPosition.row + 1;
        const id = generateEntityId(filePath, 'import', fullPath, line);

        const spec: { name: string; alias?: string } = { name: lastName };
        if (aliasNode) spec.alias = aliasNode.text;

        imports.push({
          id,
          filePath,
          source: fullPath,
          isDefault: false,
          isNamespace: false,
          specifiers: [spec],
        });
      }
    } else if (child.type === 'identifier') {
      // Single crate: use serde
      const name = child.text;
      const line = decl.startPosition.row + 1;
      const id = generateEntityId(filePath, 'import', name, line);

      imports.push({
        id,
        filePath,
        source: name,
        isDefault: false,
        isNamespace: false,
        specifiers: [{ name }],
      });
    }
  }
}

function extractScopedUseList(
  node: SyntaxNode,
  decl: SyntaxNode,
  filePath: string,
  imports: ImportEntity[],
): void {
  // scoped_use_list: scoped_identifier :: use_list
  const scopeNode = node.children.find(
    (c: SyntaxNode) => c.type === 'scoped_identifier' || c.type === 'identifier',
  );
  const useListNode = node.children.find(
    (c: SyntaxNode) => c.type === 'use_list',
  );

  const basePath = scopeNode?.text || '';

  if (useListNode) {
    // Each item in the use_list is either an identifier, scoped_identifier,
    // use_as_clause, or self
    const specifiers: { name: string; alias?: string }[] = [];

    for (const item of useListNode.children) {
      if (item.type === 'identifier') {
        specifiers.push({ name: item.text });
      } else if (item.type === 'self') {
        specifiers.push({ name: 'self' });
      } else if (item.type === 'use_as_clause') {
        const nameNode = item.children.find(
          (c: SyntaxNode) => c.type === 'identifier' || c.type === 'scoped_identifier',
        );
        const aliasNode = item.childForFieldName('alias');
        if (nameNode) {
          const spec: { name: string; alias?: string } = { name: nameNode.text };
          if (aliasNode) spec.alias = aliasNode.text;
          specifiers.push(spec);
        }
      }
    }

    const line = decl.startPosition.row + 1;
    const id = generateEntityId(filePath, 'import', basePath, line);

    imports.push({
      id,
      filePath,
      source: basePath,
      isDefault: false,
      isNamespace: false,
      specifiers,
    });
  }
}

// ============================================================================
// Type Extraction (type aliases, enums)
// ============================================================================

/**
 * Extract type aliases and enums from Rust AST.
 *
 * Rust AST shapes:
 *   type_item: type Callback = fn(i32) -> bool;
 *   enum_item: enum Color { Red, Green, Blue }
 */
export function extractTypes(root: SyntaxNode, filePath: string): TypeEntity[] {
  const types: TypeEntity[] = [];

  // Type aliases
  const typeItems = findNodesOfType(root, ['type_item']);
  for (const node of typeItems) {
    const nameNode = node.children.find(
      (c: SyntaxNode) => c.type === 'type_identifier',
    );
    if (!nameNode) continue;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const isExported = isPublic(node);
    const docstring = extractDocComment(node);
    const identity = sourceIdentity(node, filePath, 'Type', name);

    const entity: TypeEntity = {
      ...identity,
      name,
      filePath,
      startLine,
      endLine,
      isExported,
      kind: 'type',
    };
    if (docstring) entity.docstring = docstring;
    types.push(entity);
  }

  // Enums
  const enumItems = findNodesOfType(root, ['enum_item']);
  for (const node of enumItems) {
    const nameNode = node.children.find(
      (c: SyntaxNode) => c.type === 'type_identifier',
    );
    if (!nameNode) continue;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const isExported = isPublic(node);
    const docstring = extractDocComment(node);
    const identity = sourceIdentity(node, filePath, 'Type', name);

    const entity: TypeEntity = {
      ...identity,
      name,
      filePath,
      startLine,
      endLine,
      isExported,
      kind: 'enum',
    };
    if (docstring) entity.docstring = docstring;
    types.push(entity);
  }

  return types;
}

// ============================================================================
// Inheritance Extraction
// ============================================================================

/**
 * Extract inheritance-like relationships from Rust.
 *
 * - impl Trait for Struct → Struct implements Trait
 * - trait X: Y + Z → X extends Y, X extends Z (supertraits)
 */
export function extractInheritance(root: SyntaxNode, filePath: string): InheritanceReference[] {
  const refs: InheritanceReference[] = [];

  // impl Trait for Type → implements
  const implItems = findNodesOfType(root, ['impl_item']);
  for (const impl of implItems) {
    const traitNode = impl.childForFieldName('trait');
    const typeNode = impl.childForFieldName('type');

    if (traitNode && typeNode) {
      // This is: impl Trait for Type
      refs.push({
        childName: typeNode.text,
        parentName: traitNode.text,
        type: 'implements',
        filePath,
      });
    }
    // impl Type (no trait) → inherent impl, no inheritance
  }

  // Trait supertraits → extends
  const interfaces = extractInterfaces(root, filePath);
  for (const iface of interfaces) {
    if (iface.extends) {
      for (const parent of iface.extends) {
        refs.push({
          childName: iface.name,
          parentName: parent,
          type: 'extends',
          filePath,
        });
      }
    }
  }

  return refs;
}

// ============================================================================
// Call Extraction
// ============================================================================

/** Rust standard library and common macros to skip */
const RUST_BUILTINS = new Set([
  // Common macros (appear as macro_invocation, but some resolve to fn calls)
  'println', 'print', 'eprintln', 'eprint',
  'format', 'write', 'writeln',
  'vec', 'panic', 'todo', 'unimplemented', 'unreachable',
  'assert', 'assert_eq', 'assert_ne', 'debug_assert',
  // Common Result/Option methods
  'Ok', 'Err', 'Some', 'None',
  // Common trait methods that are too generic
  'clone', 'to_string', 'to_owned', 'into', 'from',
  'unwrap', 'expect', 'map', 'and_then', 'or_else',
  'collect', 'iter', 'into_iter', 'as_ref', 'as_mut',
  // Common std functions
  'drop', 'swap', 'replace',
]);

// ----------------------------------------------------------------------------
// Cross-file call resolution (mod / use path resolution)
//
// Rust's module system is directory-convention-based, so a `mod foo;` or
// `use crate::a::b::item;` path's target FILE is derivable from the
// importing file's own path plus the filesystem, with no project-wide index
// needed. Every resolution below is verified with existsSync before being
// trusted: an unresolved hop returns undefined rather than a guess, so a
// call that can't be honestly resolved is simply left unresolved (same-file
// gated, exactly like before this file's cross-file support existed).
//
// What stays UNRESOLVED, deliberately: any `use` path not anchored at
// `crate`, `self`, or `super` (an external crate name, or a bare name that
// relies on Cargo's crate registry, e.g. `use serde::Serialize;`) has no
// file derivable from directory convention alone, and per-file extraction
// has no access to Cargo.toml's `[dependencies]` table to look it up.
// ----------------------------------------------------------------------------

/**
 * Directory that holds the DIRECT SUBMODULES of `filePath`, per Rust's file
 * module convention:
 *  - mod.rs / lib.rs / main.rs declare submodules in their OWN directory
 *    (e.g. `src/lib.rs` + `mod foo;` resolves to `src/foo.rs`).
 *  - any other `name.rs` file declares submodules in a sibling directory
 *    named after itself (e.g. `src/foo.rs` + `mod bar;` resolves to
 *    `src/foo/bar.rs`).
 */
function rustSubmoduleDir(filePath: string): string {
  const dir = dirname(filePath);
  const stem = basename(filePath, '.rs');
  return stem === 'mod' || stem === 'lib' || stem === 'main' ? dir : join(dir, stem);
}

/**
 * Resolve a single module-path segment to its declaring file, relative to
 * `fromDir` (the directory holding that segment's siblings). Tries both file
 * module conventions Rust supports for a submodule named `segment`:
 * `<fromDir>/<segment>.rs` and `<fromDir>/<segment>/mod.rs`.
 */
function resolveRustModuleSegment(segment: string, fromDir: string): string | undefined {
  const asFile = join(fromDir, `${segment}.rs`);
  if (existsSync(asFile)) return asFile;
  const asModDir = join(fromDir, segment, 'mod.rs');
  if (existsSync(asModDir)) return asModDir;
  return undefined;
}

/**
 * Walk a list of module-path segments down from `startDir`, resolving each
 * hop's file and re-deriving the next hop's submodule directory from it.
 * Returns the final segment's file, or undefined the moment any hop fails
 * (no partial or guessed results).
 */
function descendRustModulePath(segments: string[], startDir: string): string | undefined {
  let dir = startDir;
  let file: string | undefined;
  for (const segment of segments) {
    file = resolveRustModuleSegment(segment, dir);
    if (!file) return undefined;
    dir = rustSubmoduleDir(file);
  }
  return file;
}

/** Try each crate-root filename in `dir`, in Rust's usual precedence order. */
function findRustCrateRootFile(dir: string): string | undefined {
  for (const candidate of ['lib.rs', 'main.rs', 'mod.rs']) {
    const p = join(dir, candidate);
    if (existsSync(p)) return p;
  }
  return undefined;
}

/**
 * Find this file's crate source directory by walking up for the nearest
 * ancestor containing Cargo.toml. Returns undefined, never a guess, when no
 * Cargo.toml is found or the crate has no `src` directory.
 */
function findRustCrateSrcDir(filePath: string): string | undefined {
  let dir = dirname(filePath);
  for (;;) {
    if (existsSync(join(dir, 'Cargo.toml'))) {
      const src = join(dir, 'src');
      return existsSync(src) ? src : undefined;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined; // reached filesystem root
    dir = parent;
  }
}

/**
 * Resolve the file that declares THIS file as a submodule, i.e. the file
 * containing `mod <this>;` for `filePath`. Used for `super::` paths. The
 * crate root (lib.rs / main.rs) has no parent module.
 */
function findRustParentModuleFile(filePath: string): string | undefined {
  const dir = dirname(filePath);
  const stem = basename(filePath, '.rs');

  if (stem === 'lib' || stem === 'main') return undefined;

  if (stem === 'mod') {
    // filePath is <parentDir>/<name>/mod.rs: the `mod <name>;` declaration
    // lives one level up, named after this directory.
    return resolveRustModuleSegment(basename(dir), dirname(dir));
  }

  // filePath is a leaf module file `<dir>/<stem>.rs`: its `mod <stem>;`
  // declaration lives in whichever file owns `dir` as its submodule directory.
  return findRustCrateRootFile(dir);
}

/**
 * Resolve a Rust `use` path (e.g. "crate::utils::helper", "self::inner::thing",
 * "super::sibmod::deep_item") to its callee-relevant target file(s), given the
 * importing file's own path. Only paths anchored at `crate`, `self`, or
 * `super` are resolvable per-file; anything else returns `{}`.
 *
 * Returns both interpretations of the path's last segment, since a `use`
 * statement doesn't say on its own whether the imported name is an item or a
 * module:
 *  - `itemFile`: the file expected to declare the LAST segment as an item
 *    (function, struct, ...). Used to resolve a bare call `name()` after
 *    `use path::name;`.
 *  - `moduleFile`: the file for the module the LAST segment itself names.
 *    Used to resolve a qualified call `name::other()` after `use path::name;`
 *    actually imports a module rather than a single item.
 * Either may be undefined if that interpretation doesn't resolve to a real file.
 */
function resolveRustUsePath(
  pathText: string,
  importingFilePath: string,
): { itemFile?: string; moduleFile?: string } {
  const parts = pathText.split('::').filter((p) => p.length > 0);
  const anchor = parts[0];
  if (!anchor) return {};

  let startDir: string | undefined;
  if (anchor === 'crate') {
    startDir = findRustCrateSrcDir(importingFilePath);
  } else if (anchor === 'self') {
    startDir = rustSubmoduleDir(importingFilePath);
  } else if (anchor === 'super') {
    const parentFile = findRustParentModuleFile(importingFilePath);
    startDir = parentFile ? rustSubmoduleDir(parentFile) : undefined;
  } else {
    return {}; // external crate or a bare name relying on Cargo's registry
  }
  if (!startDir) return {};
  const resolvedStartDir = startDir;

  const segments = parts.slice(1);
  if (segments.length === 0) {
    // e.g. `use crate::item;`: nothing between the anchor and the item, so
    // the item is expected to live directly in the anchor's own root file.
    const rootFile = findRustCrateRootFile(resolvedStartDir);
    return rootFile ? { itemFile: rootFile } : {};
  }

  const result: { itemFile?: string; moduleFile?: string } = {};

  // Interpretation A: every segment (including the last) is a module hop,
  // i.e. the last segment names a MODULE. Supports qualified calls `last::fn()`.
  const asModule = descendRustModulePath(segments, resolvedStartDir);
  if (asModule) result.moduleFile = asModule;

  // Interpretation B: all but the last segment are module hops, and the last
  // segment is an ITEM declared inside the resulting file. Supports bare
  // calls to that item's name.
  const moduleSegments = segments.slice(0, -1);
  const itemModuleFile =
    moduleSegments.length === 0
      ? findRustCrateRootFile(resolvedStartDir)
      : descendRustModulePath(moduleSegments, resolvedStartDir);
  if (itemModuleFile) result.itemFile = itemModuleFile;

  return result;
}

/**
 * Collect bare `mod foo;` declarations in this file (a module declared in a
 * SEPARATE file, as opposed to an inline `mod foo { ... }` block) and
 * resolve each to its declaring file via Rust's file module directory
 * convention. Used to resolve qualified calls `foo::bar()` where `foo`
 * names a sibling module declared in this same file.
 */
function collectRustModDeclarations(root: SyntaxNode, filePath: string): Map<string, string> {
  const modFileByName = new Map<string, string>();
  const submoduleDir = rustSubmoduleDir(filePath);

  for (const node of findNodesOfType(root, ['mod_item'])) {
    if (node.childForFieldName('body')) continue; // inline module, not a separate file
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;
    const resolved = resolveRustModuleSegment(nameNode.text, submoduleDir);
    if (resolved) modFileByName.set(nameNode.text, resolved);
  }

  return modFileByName;
}

/** A `use`-imported item's resolved target: the file it's declared in, and
 * the name it's declared under THERE (which may differ from the local
 * alias a call site uses to reach it). */
interface RustUseItemTarget {
  file: string;
  declaredName: string;
}

/**
 * Resolve this file's `use` imports to cross-file call targets, split into
 * two maps by how a resolved local name can be used at a call site:
 *  - `itemByName`: the local name resolves to an ITEM declared in the
 *    target file, under `declaredName` (equal to the local name unless the
 *    `use` aliased it with `as`). Supports bare calls `name()`: the callee
 *    at the target file is the DECLARED name, not the call-site alias, since
 *    edge creation matches Function nodes by (filePath, name) and no node is
 *    ever declared under the local alias.
 *  - `moduleFileByName`: the local name resolves to a MODULE itself. Supports
 *    qualified calls `name::other()`, where `other` is read verbatim from the
 *    call site and is already the real declared name (Rust has no syntax to
 *    rename an item accessed through a qualified path, only the module
 *    segment itself can be aliased), so no name substitution is needed here.
 *
 * Reconstructs each specifier's full `use` path from ImportEntity's `source`
 * and `specifiers` fields (rather than re-walking the AST): for a simple,
 * non-grouped `use` (`source` is already the full path, ending in the one
 * specifier's name) the source is used as-is; for a grouped `use` (`source`
 * is the shared prefix, e.g. "std::io" for `use std::io::{Read, Write};`)
 * each specifier's name is appended to it.
 */
function resolveRustUseImports(
  imports: ImportEntity[],
  filePath: string,
): { itemByName: Map<string, RustUseItemTarget>; moduleFileByName: Map<string, string> } {
  const itemByName = new Map<string, RustUseItemTarget>();
  const moduleFileByName = new Map<string, string>();

  for (const imp of imports) {
    for (const spec of imp.specifiers) {
      const pathText =
        imp.source === spec.name || imp.source.endsWith(`::${spec.name}`)
          ? imp.source
          : `${imp.source}::${spec.name}`;
      const localName = spec.alias ?? spec.name;
      const { itemFile, moduleFile } = resolveRustUsePath(pathText, filePath);
      if (itemFile) itemByName.set(localName, { file: itemFile, declaredName: spec.name });
      if (moduleFile) moduleFileByName.set(localName, moduleFile);
    }
  }

  return { itemByName, moduleFileByName };
}

/**
 * Extract function/method calls from Rust AST.
 *
 * Same-file calls (the callee is declared in this same file) always resolve
 * without a `calleeFilePath` (absent means same-file, see CallReference).
 * Cross-file calls resolve a `calleeFilePath` only through directory
 * conventions that are honestly derivable from this file's own path: a bare
 * `mod foo;` declaration (sibling file), or a `use` path anchored at
 * `crate::`, `self::`, or `super::`. Everything else stays unresolved rather
 * than guessed, see the resolver comments above.
 *
 * @param context Optional extraction context carrying this file's already-
 *   extracted imports (`context.imports`), so the pipeline doesn't pay for
 *   re-running extractImports per call-extraction pass. Falls back to
 *   extracting them here when absent, so direct callers (including this
 *   package's own tests, and any pipeline not yet passing context) keep
 *   working unchanged.
 */
export function extractCalls(
  root: SyntaxNode,
  filePath: string,
  context?: CallExtractionContext,
): CallReference[] {
  const calls: CallReference[] = [];

  // Get all functions in the file for local lookup
  const functions = extractFunctions(root, filePath);
  const localFunctionNames = new Set(functions.map((f) => f.name));

  const modFileByName = collectRustModDeclarations(root, filePath);
  const imports = context?.imports ?? extractImports(root, filePath);
  const { itemByName, moduleFileByName } = resolveRustUseImports(imports, filePath);

  // Find all function_item nodes (including in impl blocks) and search for calls in their bodies
  const allFuncNodes = findNodesOfType(root, ['function_item']);

  for (const funcNode of allFuncNodes) {
    const callerNameNode = funcNode.childForFieldName('name');
    if (!callerNameNode) continue;
    const callerName = callerNameNode.text;

    const bodyNode = funcNode.childForFieldName('body');
    if (!bodyNode) continue;

    // Find call_expression nodes in the body
    const callNodes = findNodesOfType(bodyNode, ['call_expression']);

    for (const callNode of callNodes) {
      const fnNode = callNode.childForFieldName('function');
      if (!fnNode) continue;

      let calleeName: string | undefined;
      let qualifier: string | undefined;
      let isBareIdentifier = false;

      if (fnNode.type === 'identifier') {
        // Direct function call: helper()
        calleeName = fnNode.text;
        isBareIdentifier = true;
      } else if (fnNode.type === 'field_expression') {
        // Method call: self.method() or obj.method()
        const fieldNode = fnNode.childForFieldName('field');
        calleeName = fieldNode?.text;
      } else if (fnNode.type === 'scoped_identifier') {
        // Qualified call: Type::method() or module::func()
        // Get the last component, and the segment right before it (the
        // immediate qualifier) for cross-file resolution.
        const parts = fnNode.text.split('::');
        calleeName = parts[parts.length - 1];
        if (parts.length >= 2) qualifier = parts[parts.length - 2];
      }

      if (!calleeName) continue;
      if (RUST_BUILTINS.has(calleeName)) continue;

      const line = callNode.startPosition.row + 1;

      // Same-file calls always win, and never carry calleeFilePath (absent
      // means same-file per the CallReference contract).
      if (localFunctionNames.has(calleeName)) {
        calls.push({ callerName, calleeName, line, filePath });
        continue;
      }

      if (qualifier) {
        // Qualified call: resolve the qualifier through a locally-declared
        // `mod` first, then through a `use`-imported module.
        const calleeFilePath = modFileByName.get(qualifier) ?? moduleFileByName.get(qualifier);
        if (calleeFilePath) {
          calls.push({ callerName, calleeName, line, filePath, calleeFilePath });
        }
        continue;
      }

      if (isBareIdentifier) {
        // Bare call: resolve through a `use`-imported item. Method calls
        // (field_expression) deliberately don't fall through here, since a
        // method name matching an unrelated free function import would be a
        // wrong edge, not a resolved one.
        const target = itemByName.get(calleeName);
        if (target) {
          // Emit the DECLARED name at the target file, not the call-site
          // identifier. When the `use` aliased the import (`... as h;`),
          // calleeName here is the alias ("h"), but no Function node is ever
          // declared "h": edge creation matches nodes by (filePath, name),
          // so the pair pushed here must be the pair the real node was
          // extracted with, i.e. target.declaredName in target.file.
          calls.push({
            callerName,
            calleeName: target.declaredName,
            line,
            filePath,
            calleeFilePath: target.file,
          });
        }
      }
    }
  }

  return calls;
}

// ============================================================================
// Import Resolution (Placeholder)
// ============================================================================

export function resolveRustImport(
  _importPath: string,
  _importingFilePath: string,
  _projectRoot: string,
): string | undefined {
  // TODO: Implement Rust import resolution (requires Cargo.toml parsing)
  return undefined;
}

// ============================================================================
// Plugin Export (via generic factory)
// ============================================================================

// Spread createLanguagePlugin's output and override `extractAllEntities`
// with the standalone version below — the generic factory's composed
// extractAllEntities skips impl block methods (extractFunctions returns
// only free functions per its contract). The standalone version merges
// methods back via extractStructsWithEdges.methodEntities.
export const rustPlugin = {
  ...createLanguagePlugin({
    id: 'rust',
    displayName: 'Rust',
    extensions: ['.rs'],
    grammar: Rust,
    nodeTypes: {
      functions: ['function_item'],
      classes: ['struct_item'],
      interfaces: ['trait_item'],
      variables: ['const_item', 'static_item'],
      imports: ['use_declaration'],
      calls: ['call_expression'],
    },
    overrides: {
      extractFunctions,
      extractClasses,
      extractInterfaces,
      extractVariables,
      extractImports,
      extractTypes,
      extractInheritance,
      extractCalls,
    },
  }),
  extractAllEntities,
};

// ============================================================================
// Struct Extraction with HAS_METHOD / HAS_PROPERTY edges
// ============================================================================

/** Result of extractStructsWithEdges */
export interface RustClassExtractionResult {
  classes: ClassEntity[];
  methodEntities: FunctionEntity[];
  propertyEntities: VariableEntity[];
  hasMethodEdges: HasMethodEdgeDescriptor[];
  hasPropertyEdges: HasPropertyEdgeDescriptor[];
}

/**
 * Rust visibility: 'public' if the node has a `pub` (visibility_modifier),
 * 'private' otherwise (Rust's default-private convention).
 */
function rustVisibility(node: SyntaxNode): Visibility {
  return node.children.some((c: SyntaxNode) => c.type === 'visibility_modifier')
    ? 'public'
    : 'private';
}

/**
 * Detect whether a Rust function_item is a static method.
 *
 * A method is instance (isStatic=false) when the first real parameter is a
 * self_parameter node (handles `self`, `&self`, `&mut self`).
 * Any other first parameter (or no parameters) means isStatic=true.
 */
function isRustStaticMethod(funcNode: SyntaxNode): boolean {
  const paramList = funcNode.childForFieldName('parameters');
  if (!paramList) return true; // no params → no self → static

  for (const child of paramList.children) {
    if (child.type === 'self_parameter') return false;
    // Skip punctuation/whitespace nodes that are just punctuation
    if (child.type === '(' || child.type === ')' || child.type === ',') continue;
    // First real parameter is not a self_parameter → static
    return true;
  }
  return true;
}

/**
 * Resolve the impl target type name from an impl_item node.
 *
 * Handles both:
 *   impl SomeStruct { ... }             → "SomeStruct"
 *   impl SomeTrait for SomeStruct { ... } → "SomeStruct"
 *
 * Uses the `type` field (the struct type), not the `trait` field.
 * Strips generic parameters for v1 (e.g., `Vec<T>` → "Vec").
 */
function resolveImplTargetName(implNode: SyntaxNode): string | undefined {
  const typeNode = implNode.childForFieldName('type');
  if (!typeNode) return undefined;

  const rawName = typeNode.text;
  // Strip generic params: "Foo<T, U>" → "Foo"
  const angleBracket = rawName.indexOf('<');
  return angleBracket >= 0 ? rawName.slice(0, angleBracket) : rawName;
}

/**
 * Extract struct declarations together with their field-Variable entities,
 * method-Function entities, and HAS_PROPERTY / HAS_METHOD edge descriptors.
 *
 * Rust-specific notes:
 *  - Structs (struct_item) are the Class analog.
 *  - Struct fields (field_declaration inside field_declaration_list) → VariableEntity
 *    with id `<classId>::prop::<fieldName>`.
 *  - Methods are function_item nodes inside impl_item blocks (top-level, not nested
 *    in the struct definition).
 *  - `isStatic` is true when the first parameter is NOT self/&self/&mut self.
 *  - Visibility: `pub` modifier → 'public'; no modifier → 'private'.
 *  - `isReadonly` is always false (mutability is bind-site in Rust, not field-level).
 *  - impl blocks for trait implementations (impl Trait for Struct) also produce
 *    HAS_METHOD edges pointing to the struct.
 *  - impl on an externally-defined type (not declared in this file) → skip edges,
 *    standalone FunctionEntity still extracted by extractFunctions.
 *
 * Rust AST shape for struct:
 *   struct_item
 *     visibility_modifier?
 *     name: type_identifier
 *     type_parameters?
 *     field_declaration_list
 *       field_declaration+
 *         visibility_modifier?
 *         field_identifier
 *         ':'
 *         type
 *
 * Rust AST shape for impl block:
 *   impl_item
 *     type_parameters?
 *     trait?: type_identifier | generic_type | scoped_identifier
 *     'for'?
 *     type: type_identifier | generic_type | ...
 *     body: declaration_list
 *       function_item+
 */
export function extractStructsWithEdges(
  root: SyntaxNode,
  filePath: string,
): RustClassExtractionResult {
  const classes: ClassEntity[] = [];
  const methodEntities: FunctionEntity[] = [];
  const propertyEntities: VariableEntity[] = [];
  const hasMethodEdges: HasMethodEdgeDescriptor[] = [];
  const hasPropertyEdges: HasPropertyEdgeDescriptor[] = [];

  // ---- Pass 1: collect structs and their fields ----
  const structItems = findNodesOfType(root, ['struct_item']);

  // Map from struct name → classId for impl-block lookup in pass 2
  const structIdByName = new Map<string, string>();

  for (const node of structItems) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const isExported = isPublic(node);
    const docstring = extractDocComment(node);
    const classIdentity = sourceIdentity(node, filePath, 'Class', name);
    const classId = classIdentity.id;
    structIdByName.set(name, classId);

    const entity: ClassEntity = {
      ...classIdentity,
      name,
      filePath,
      startLine,
      endLine,
      isExported,
      isAbstract: false,
    };
    if (docstring) entity.docstring = docstring;
    classes.push(entity);

    // ---- Extract field declarations → HAS_PROPERTY ----
    const fieldList = node.children.find(
      (c: SyntaxNode) => c.type === 'field_declaration_list',
    );
    if (!fieldList) continue;

    for (const field of fieldList.children) {
      if (field.type !== 'field_declaration') continue;

      const fieldNameNode = field.children.find(
        (c: SyntaxNode) => c.type === 'field_identifier',
      );
      if (!fieldNameNode) continue;

      const fieldName = fieldNameNode.text;
      const fieldLine = field.startPosition.row + 1;
      const fieldVisibility = rustVisibility(field);

      // Extract field type (the node after ':')
      const colonIdx = field.children.findIndex((c: SyntaxNode) => c.type === ':');
      let fieldType: string | undefined;
      if (colonIdx >= 0 && colonIdx + 1 < field.children.length) {
        const typeNode = field.children[colonIdx + 1];
        if (typeNode && typeNode.type !== ',') {
          fieldType = typeNode.text;
        }
      }

      const propIdentity = sourceIdentity(
        field,
        filePath,
        'Variable',
        fieldName,
        `Class:${name}`,
      );

      const propEntity: VariableEntity = {
        ...propIdentity,
        name: fieldName,
        filePath,
        line: fieldLine,
        kind: 'let',
        isExported: fieldVisibility === 'public',
      };
      if (fieldType) propEntity.type = fieldType;

      propertyEntities.push(propEntity);
      hasPropertyEdges.push({
        fromId: classId,
        toId: propIdentity.id,
        isStatic: false,
        visibility: fieldVisibility,
        isReadonly: false,
      });
    }
  }

  // ---- Pass 2: walk impl_item blocks, resolve target type → struct ----
  const implItems = findNodesOfType(root, ['impl_item']);

  for (const impl of implItems) {
    const targetName = resolveImplTargetName(impl);
    if (!targetName) continue;

    const classId = structIdByName.get(targetName);
    if (!classId) {
      // impl on a type not declared in this file — skip edges,
      // standalone FunctionEntity still extracted by extractFunctions.
      continue;
    }

    const bodyNode = impl.childForFieldName('body');
    if (!bodyNode) continue;

    for (const child of bodyNode.children) {
      if (child.type !== 'function_item') continue;

      const fnNameNode = child.childForFieldName('name');
      if (!fnNameNode) continue;

      const methodName = fnNameNode.text;

      // Use generateEntityId format matching extractFunctions (which uses implType.methodName).
      // This ensures HAS_METHOD edge toIds match the persisted node id after natural-key MERGE.
      const methodIdentity = sourceIdentity(
        child,
        filePath,
        'Function',
        methodName,
        `Impl:${targetName}`,
      );
      const startLine = child.startPosition.row + 1;
      const endLine = child.endPosition.row + 1;
      const isExported = isPublic(child);
      const visibility = rustVisibility(child);
      const isStatic = isRustStaticMethod(child);

      const params = extractRustParams(child);
      const returnType = extractRustReturnType(child);
      const docstring = extractDocComment(child);
      const metrics = calculateComplexity(child);

      const methodEntity: FunctionEntity = {
        ...methodIdentity,
        name: methodName,
        filePath,
        startLine,
        endLine,
        isExported,
        isAsync: child.children.some(
          (c: SyntaxNode) => c.type === 'function_modifiers' && c.text.includes('async'),
        ),
        isArrow: false,
        params,
        complexity: metrics.cyclomatic,
        cognitiveComplexity: metrics.cognitive,
        nestingDepth: metrics.nestingDepth,
      };
      if (returnType) methodEntity.returnType = returnType;
      if (docstring) methodEntity.docstring = docstring;

      methodEntities.push(methodEntity);
      hasMethodEdges.push({
        fromId: classId,
        toId: methodIdentity.id,
        isStatic,
        visibility,
      });
    }
  }

  return { classes, methodEntities, propertyEntities, hasMethodEdges, hasPropertyEdges };
}

// ============================================================================
// Type-Relationship Extractors (HAS_PARAM / RETURNS / USES_TYPE)
// ============================================================================

/**
 * Build a TypeRefEntity for the given type name scoped to the current file.
 * Primitives get a language-global id; user types get file-scoped ids.
 */
function makeRustTypeRef(name: string, filePath: string): TypeRefEntity {
  const identity = resolveTypeIdentity({
    language: 'rust',
    name,
    definingFile: filePath,
  });
  return {
    id: identity.id,
    name: identity.name,
    language: 'rust',
    isPrimitive: identity.isPrimitive,
    ...(identity.definingFile !== undefined ? { definingFile: identity.definingFile } : {}),
  };
}

export interface RustTypeRefsForFunction {
  typeRefs: TypeRefEntity[];
  hasParamEdges: HasParamEdgeDescriptor[];
  returnsEdges: ReturnsEdgeDescriptor[];
  usesTypeEdges: UsesTypeEdgeDescriptor[];
}

/**
 * Extract TypeRef entities + the three edge descriptor arrays for a single
 * Rust function_item AST node.
 *
 * - Parameters: skip self_parameter (method receiver, covered by HAS_METHOD).
 *   Each typed `parameter` node emits a HAS_PARAM edge. isOptional is always
 *   false (Rust has no optional params).
 * - Returns: if return_type field is present emit RETURNS to that type; if
 *   absent (unit return) emit RETURNS to `prim::rust::()`.
 * - isAsync: detected from presence of function_modifiers node containing "async".
 * - Body USES_TYPE: let_declaration with type annotation → 'annotation';
 *   type_cast_expression (x as T) → 'cast'; generic_type nodes → 'instantiation'.
 *   Deduplicates on (toId, kind) within a function.
 */
export function extractTypeRefsForRustFunction(
  funcNode: SyntaxNode,
  functionId: string,
  filePath: string,
): RustTypeRefsForFunction {
  const typeRefMap = new Map<string, TypeRefEntity>();
  const hasParamEdges: HasParamEdgeDescriptor[] = [];
  const returnsEdges: ReturnsEdgeDescriptor[] = [];
  const usesTypeEdges: UsesTypeEdgeDescriptor[] = [];

  function addTypeRef(ref: TypeRefEntity): void {
    if (!typeRefMap.has(ref.id)) {
      typeRefMap.set(ref.id, ref);
    }
  }

  // ── isAsync detection ─────────────────────────────────────────────────────
  // tree-sitter-rust wraps `async` inside a function_modifiers node
  const isAsync = funcNode.children.some(
    (c: SyntaxNode) => c.type === 'function_modifiers' && c.text.includes('async'),
  );

  // ── Parameters → HAS_PARAM ────────────────────────────────────────────────
  const paramList = funcNode.childForFieldName('parameters');
  if (paramList) {
    let position = 0;
    for (const child of paramList.children) {
      // Skip punctuation tokens
      if (child.type === '(' || child.type === ')' || child.type === ',') continue;

      // Skip self_parameter (&self, &mut self, self) — covered by HAS_METHOD
      if (child.type === 'self_parameter') continue;

      if (child.type === 'parameter') {
        const patternNode = child.childForFieldName('pattern');
        const typeNode = child.childForFieldName('type');

        const paramName = patternNode?.text ?? '_';
        const typeName = typeNode?.text?.trim();
        if (!typeName) {
          position++;
          continue;
        }

        const typeRef = makeRustTypeRef(typeName, filePath);
        addTypeRef(typeRef);
        hasParamEdges.push({
          fromId: functionId,
          toId: typeRef.id,
          position,
          name: paramName,
          isOptional: false, // Rust has no optional params
        });
        position++;
      }
    }
  }

  // ── Return type → RETURNS ─────────────────────────────────────────────────
  const returnTypeNode = funcNode.childForFieldName('return_type');
  if (returnTypeNode) {
    const typeName = returnTypeNode.text?.trim();
    if (typeName) {
      const typeRef = makeRustTypeRef(typeName, filePath);
      addTypeRef(typeRef);
      returnsEdges.push({ fromId: functionId, toId: typeRef.id, isAsync });
    }
  } else {
    // No explicit return type → unit type ()
    const unitRef = makeRustTypeRef('()', filePath);
    addTypeRef(unitRef);
    returnsEdges.push({ fromId: functionId, toId: unitRef.id, isAsync });
  }

  // ── Body USES_TYPE ────────────────────────────────────────────────────────
  const bodyNode = funcNode.childForFieldName('body');
  if (bodyNode) {
    const seen = new Set<string>();

    function collectBodyTypeUsages(node: SyntaxNode): void {
      // Don't descend into nested function bodies (their types belong to that function)
      if (node.type === 'closure_expression') return;

      // let_declaration with explicit type annotation: `let x: T = ...;`
      // childForFieldName('type') returns the type node when present.
      if (node.type === 'let_declaration') {
        const typeNode = node.childForFieldName('type');
        if (typeNode) {
          const typeName = typeNode.text?.trim();
          if (typeName) {
            const typeRef = makeRustTypeRef(typeName, filePath);
            addTypeRef(typeRef);
            const key = `${typeRef.id}::annotation`;
            if (!seen.has(key)) {
              seen.add(key);
              usesTypeEdges.push({ fromId: functionId, toId: typeRef.id, kind: 'annotation' });
            }
          }
        }
        // Still recurse into let_declaration body for casts/generics in the initializer
      }

      // type_cast_expression: `x as T`
      // The type is accessible via childForFieldName('type')
      if (node.type === 'type_cast_expression') {
        const typeNode = node.childForFieldName('type');
        if (typeNode) {
          const typeName = typeNode.text?.trim();
          if (typeName) {
            const typeRef = makeRustTypeRef(typeName, filePath);
            addTypeRef(typeRef);
            const key = `${typeRef.id}::cast`;
            if (!seen.has(key)) {
              seen.add(key);
              usesTypeEdges.push({ fromId: functionId, toId: typeRef.id, kind: 'cast' });
            }
          }
        }
      }

      // generic_type instantiations: `Vec<u32>`, `Option<String>`, etc.
      // tree-sitter-rust names these `generic_type`.
      if (node.type === 'generic_type') {
        const typeName = node.text?.trim();
        if (typeName) {
          const typeRef = makeRustTypeRef(typeName, filePath);
          addTypeRef(typeRef);
          const key = `${typeRef.id}::instantiation`;
          if (!seen.has(key)) {
            seen.add(key);
            usesTypeEdges.push({ fromId: functionId, toId: typeRef.id, kind: 'instantiation' });
          }
        }
        // Don't recurse further into the generic_type itself — its children
        // are type args that would double-count the inner types.
        return;
      }

      for (const child of node.children) {
        collectBodyTypeUsages(child);
      }
    }

    collectBodyTypeUsages(bodyNode);
  }

  return {
    typeRefs: Array.from(typeRefMap.values()),
    hasParamEdges,
    returnsEdges,
    usesTypeEdges,
  };
}

// ============================================================================
// extractAllEntities override
// ============================================================================

/**
 * Extract all entities from a Rust AST, including HAS_METHOD, HAS_PROPERTY,
 * HAS_PARAM, RETURNS, and USES_TYPE edge descriptors.
 *
 * Overrides the generic factory's extractAllEntities so the edge fields are populated.
 * The pipeline picks them up automatically via ParsedFileEntities.
 *
 * Function entities all use generateEntityId(filePath, 'function', qualifiedName, startLine).
 * extractFunctions handles all function_item nodes (top-level and inside impl blocks).
 * extractStructsWithEdges handles impl-block methods for local structs (producing HAS_METHOD
 * edges) using the same generateEntityId format. extractAllEntities deduplicates by id so
 * local-struct methods appear once in the output.
 */
export function extractAllEntities(root: SyntaxNode, filePath: string) {
  const allFunctions = extractFunctions(root, filePath);
  const structExtraction = extractStructsWithEdges(root, filePath);

  // Merge and deduplicate by id: both extractors now use generateEntityId format.
  // structExtraction entities take priority (they carry HAS_METHOD linkage metadata).
  const functionById = new Map<string, FunctionEntity>();
  for (const fn of allFunctions) {
    if (fn.id) functionById.set(fn.id, fn);
  }
  for (const fn of structExtraction.methodEntities) {
    if (fn.id) functionById.set(fn.id, fn);
  }
  const mergedFunctions = Array.from(functionById.values());

  // ── Type-relationship edges (HAS_PARAM / RETURNS / USES_TYPE) ──────────────
  const typeRefMap = new Map<string, TypeRefEntity>();
  const allHasParamEdges: HasParamEdgeDescriptor[] = [];
  const allReturnsEdges: ReturnsEdgeDescriptor[] = [];
  const allUsesTypeEdges: UsesTypeEdgeDescriptor[] = [];

  function accumulateTypeRefs(funcNode: SyntaxNode, entityId: string): void {
    const result = extractTypeRefsForRustFunction(funcNode, entityId, filePath);
    for (const ref of result.typeRefs) {
      if (!typeRefMap.has(ref.id)) typeRefMap.set(ref.id, ref);
    }
    allHasParamEdges.push(...result.hasParamEdges);
    allReturnsEdges.push(...result.returnsEdges);
    allUsesTypeEdges.push(...result.usesTypeEdges);
  }

  // Process top-level function_item nodes
  const topLevelFuncNodes = root.children.filter(
    (c: SyntaxNode) => c.type === 'function_item',
  );
  for (const funcNode of topLevelFuncNodes) {
    const nameNode = funcNode.childForFieldName('name');
    if (!nameNode) continue;
    const name = nameNode.text;
    const startLine = funcNode.startPosition.row + 1;
    const matched = mergedFunctions.find(
      (entity) => entity.name === name && entity.startLine === startLine,
    );
    if (matched?.id) {
      accumulateTypeRefs(funcNode, matched.id);
    }
  }

  // Process method function_item nodes inside impl blocks (all use generateEntityId now)
  const implItems = findNodesOfType(root, ['impl_item']);
  for (const impl of implItems) {
    const typeNode = impl.childForFieldName('type');
    const implTypeName = typeNode?.text;
    const bodyNode = impl.childForFieldName('body');
    if (!bodyNode) continue;

    for (const child of bodyNode.children) {
      if (child.type !== 'function_item') continue;

      const nameNode = child.childForFieldName('name');
      if (!nameNode) continue;
      const methodName = nameNode.text;
      const startLine = child.startPosition.row + 1;

      const matched = mergedFunctions.find(
        (entity) => entity.name === methodName &&
          entity.startLine === startLine &&
          entity.scopeKey === (implTypeName ? `Impl:${implTypeName}` : ''),
      );
      if (matched?.id) {
        accumulateTypeRefs(child, matched.id);
      }
    }
  }

  return {
    // Deduplicated: one entity per function/method (local-struct methods use structExtraction version)
    functions: mergedFunctions,
    classes: structExtraction.classes,
    interfaces: extractInterfaces(root, filePath),
    variables: [
      ...extractVariables(root, filePath),
      ...structExtraction.propertyEntities,
    ],
    imports: extractImports(root, filePath),
    types: extractTypes(root, filePath),
    components: [],
    hasMethodEdges: structExtraction.hasMethodEdges,
    hasPropertyEdges: structExtraction.hasPropertyEdges,
    typeRefs: Array.from(typeRefMap.values()),
    hasParamEdges: allHasParamEdges,
    returnsEdges: allReturnsEdges,
    usesTypeEdges: allUsesTypeEdges,
  };
}
