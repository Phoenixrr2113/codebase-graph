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
import type {
  FunctionEntity,
  ClassEntity,
  InterfaceEntity,
  VariableEntity,
  ImportEntity,
  TypeEntity,
  InheritanceReference,
  CallReference,
  SyntaxNode,
} from '@codegraph/types';
import { findNodesOfType, generateEntityId } from '@codegraph/plugin-common';
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
    const id = generateEntityId(filePath, 'class', name, startLine);

    const entity: ClassEntity = {
      id,
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
    const id = generateEntityId(filePath, 'interface', name, startLine);

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
      id,
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

  const qualifiedName = implType ? `${implType}.${name}` : name;
  const id = generateEntityId(filePath, 'function', qualifiedName, startLine);

  const entity: FunctionEntity = {
    id,
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
  const id = generateEntityId(filePath, 'variable', name, line);

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
    id,
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
    const id = generateEntityId(filePath, 'type', name, startLine);

    const entity: TypeEntity = {
      id,
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
    const id = generateEntityId(filePath, 'type', name, startLine);

    const entity: TypeEntity = {
      id,
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

/**
 * Extract function/method calls from Rust AST.
 * Only tracks calls to functions defined in the same file.
 */
export function extractCalls(root: SyntaxNode, filePath: string): CallReference[] {
  const calls: CallReference[] = [];

  // Get all functions in the file for local lookup
  const functions = extractFunctions(root, filePath);
  const localFunctionNames = new Set(functions.map((f) => f.name));

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

      if (fnNode.type === 'identifier') {
        // Direct function call: helper()
        calleeName = fnNode.text;
      } else if (fnNode.type === 'field_expression') {
        // Method call: self.method() or obj.method()
        const fieldNode = fnNode.childForFieldName('field');
        calleeName = fieldNode?.text;
      } else if (fnNode.type === 'scoped_identifier') {
        // Qualified call: Type::method() or module::func()
        // Get the last component
        const parts = fnNode.text.split('::');
        calleeName = parts[parts.length - 1];
      }

      if (!calleeName) continue;
      if (RUST_BUILTINS.has(calleeName)) continue;

      // Only create edges for local function calls
      if (localFunctionNames.has(calleeName)) {
        calls.push({
          callerName,
          calleeName,
          line: callNode.startPosition.row + 1,
          filePath,
        });
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

export const rustPlugin = createLanguagePlugin({
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
});

// Re-export extractAllEntities for backward compatibility
export const extractAllEntities = rustPlugin.extractAllEntities;
