/**
 * @codegraph/plugin-php
 * PHP language plugin for CodeGraph
 *
 * Extracts classes, interfaces, traits (-> Interface), functions, methods,
 * properties, constants, imports (use), enums, and call references from PHP
 * source files using tree-sitter-php.
 *
 * PHP Mapping:
 *   class -> ClassEntity
 *   interface -> InterfaceEntity
 *   trait -> InterfaceEntity (closest match; traits are mixin-like)
 *   function (top-level) -> FunctionEntity
 *   method -> FunctionEntity (with parentClass)
 *   property -> VariableEntity (kind: 'let')
 *   const (class or top-level) -> VariableEntity (kind: 'const')
 *   namespace use declarations -> ImportEntity
 *   enum -> TypeEntity (kind: 'enum')
 *   class extends -> InheritanceReference (extends)
 *   class/enum implements -> InheritanceReference (implements)
 *   interface extends -> InheritanceReference (extends)
 *   trait use inside class -> InheritanceReference (implements)
 */

import PHPLanguage from 'tree-sitter-php';
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
import { findNodesOfType, generateEntityId, calculateComplexity } from '@codegraph/plugin-common';
import { createLanguagePlugin } from '@codegraph/plugin-generic';

// tree-sitter-php exports { php, php_only } — we need the full grammar
const PHP = (PHPLanguage as { php: unknown }).php;

/** Get the tree-sitter grammar for PHP */
export function getGrammar(): unknown {
  return PHP;
}

// ============================================================================
// Doc Comment Extraction
// ============================================================================

/**
 * Extract PHP doc comments from a declaration node.
 * PHP doc comments are block comments starting with /** immediately
 * preceding the declaration. They appear as `comment` nodes in the AST.
 */
function extractDocComment(node: SyntaxNode): string | undefined {
  const prev = node.previousSibling;
  if (!prev || prev.type !== 'comment') return undefined;

  const text = prev.text;
  if (!text.startsWith('/**')) return undefined;

  // Strip /** ... */ delimiters and leading * from each line
  const cleaned = text
    .slice(3, -2)
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .filter((line) => line.length > 0)
    .join('\n');

  return cleaned || undefined;
}

/**
 * Extract visibility from a PHP node.
 * PHP uses visibility_modifier child nodes.
 */
function getVisibility(node: SyntaxNode): string | undefined {
  const vis = node.children.find((c: SyntaxNode) => c.type === 'visibility_modifier');
  if (!vis) return undefined;
  return vis.text; // 'public', 'protected', 'private'
}

// ============================================================================
// Class Extraction
// ============================================================================

/**
 * Extract class declarations from PHP AST.
 *
 * PHP AST shape:
 *   class_declaration
 *     abstract_modifier?
 *     name (identifier)
 *     base_clause? (extends ParentClass)
 *     class_interface_clause? (implements Interface1, Interface2)
 *     declaration_list (body)
 */
export function extractClasses(root: SyntaxNode, filePath: string): ClassEntity[] {
  const classes: ClassEntity[] = [];
  const classNodes = findNodesOfType(root, ['class_declaration']);

  for (const node of classNodes) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const isAbstract = node.children.some(
      (c: SyntaxNode) => c.type === 'abstract_modifier',
    );
    const docstring = extractDocComment(node);
    const id = generateEntityId(filePath, 'class', name, startLine);

    const entity: ClassEntity = {
      id,
      name,
      filePath,
      startLine,
      endLine,
      isExported: true, // PHP classes are always accessible
      isAbstract,
    };

    if (docstring) entity.docstring = docstring;
    classes.push(entity);
  }

  return classes;
}

// ============================================================================
// Interface & Trait Extraction (-> InterfaceEntity)
// ============================================================================

/**
 * Extract interface and trait declarations from PHP AST.
 *
 * PHP AST shapes:
 *   interface_declaration
 *     name (identifier)
 *     base_clause? (extends Interface1, Interface2)
 *     declaration_list (body)
 *
 *   trait_declaration
 *     name (identifier)
 *     declaration_list (body)
 */
export function extractInterfaces(root: SyntaxNode, filePath: string): InterfaceEntity[] {
  const interfaces: InterfaceEntity[] = [];

  // PHP interfaces
  const interfaceNodes = findNodesOfType(root, ['interface_declaration']);
  for (const node of interfaceNodes) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const docstring = extractDocComment(node);
    const id = generateEntityId(filePath, 'interface', name, startLine);

    // Interface extends
    const extendsList: string[] = [];
    const baseClause = node.children.find((c: SyntaxNode) => c.type === 'base_clause');
    if (baseClause) {
      for (const child of baseClause.children) {
        if (child.type === 'name') {
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
      isExported: true,
    };

    if (extendsList.length > 0) entity.extends = extendsList;
    if (docstring) entity.docstring = docstring;

    interfaces.push(entity);
  }

  // PHP traits -> InterfaceEntity
  const traitNodes = findNodesOfType(root, ['trait_declaration']);
  for (const node of traitNodes) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const docstring = extractDocComment(node);
    const id = generateEntityId(filePath, 'interface', name, startLine);

    const entity: InterfaceEntity = {
      id,
      name,
      filePath,
      startLine,
      endLine,
      isExported: true,
    };

    if (docstring) entity.docstring = docstring;
    interfaces.push(entity);
  }

  return interfaces;
}

// ============================================================================
// Function & Method Extraction
// ============================================================================

/**
 * Extract function and method declarations from PHP AST.
 *
 * PHP AST shapes:
 *   function_definition (top-level)
 *     name (identifier)
 *     formal_parameters
 *     return type after ':'
 *     compound_statement (body)
 *
 *   method_declaration (inside class/trait/enum)
 *     visibility_modifier?
 *     static_modifier?
 *     abstract_modifier?
 *     name (identifier)
 *     formal_parameters
 *     return type after ':'
 *     compound_statement? (body; absent for abstract methods)
 */
export function extractFunctions(root: SyntaxNode, filePath: string): FunctionEntity[] {
  const functions: FunctionEntity[] = [];

  // Top-level functions
  const topLevelFuncs = findNodesOfType(root, ['function_definition']);
  for (const node of topLevelFuncs) {
    // Skip functions inside class/trait/enum bodies
    if (isInsideClassLikeBody(node)) continue;

    const fn = extractFunctionFromNode(node, filePath, undefined);
    if (fn) functions.push(fn);
  }

  // Methods inside classes, traits, and enums
  const classLikeNodes = findNodesOfType(root, [
    'class_declaration',
    'trait_declaration',
    'enum_declaration',
  ]);
  for (const classNode of classLikeNodes) {
    const classNameNode = classNode.childForFieldName('name');
    const className = classNameNode?.text;

    const bodyNode = classNode.children.find(
      (c: SyntaxNode) => c.type === 'declaration_list' || c.type === 'enum_declaration_list',
    );
    if (!bodyNode) continue;

    for (const child of bodyNode.children) {
      if (child.type === 'method_declaration') {
        const fn = extractMethodFromNode(child, filePath, className);
        if (fn) functions.push(fn);
      }
    }
  }

  return functions;
}

/**
 * Check if a node is inside a class-like body (class, trait, enum).
 */
function isInsideClassLikeBody(node: SyntaxNode): boolean {
  let parent = node.parent;
  while (parent) {
    if (
      parent.type === 'declaration_list' ||
      parent.type === 'enum_declaration_list'
    ) {
      return true;
    }
    parent = parent.parent;
  }
  return false;
}

/**
 * Extract a top-level function entity from a function_definition node.
 */
function extractFunctionFromNode(
  node: SyntaxNode,
  filePath: string,
  _parentClass: string | undefined,
): FunctionEntity | undefined {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return undefined;

  const name = nameNode.text;
  const startLine = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const params = extractPhpParams(node);
  const returnType = extractPhpReturnType(node);
  const docstring = extractDocComment(node);
  const id = generateEntityId(filePath, 'function', name, startLine);

  const entity: FunctionEntity = {
    id,
    name,
    filePath,
    startLine,
    endLine,
    isExported: true,
    isAsync: false, // PHP has no async keyword (async is library-based)
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
 * Extract a method entity from a method_declaration node.
 */
function extractMethodFromNode(
  node: SyntaxNode,
  filePath: string,
  className: string | undefined,
): FunctionEntity | undefined {
  const nameNode = node.childForFieldName('name');
  if (!nameNode) return undefined;

  const name = nameNode.text;
  const startLine = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;
  const vis = getVisibility(node);
  const params = extractPhpParams(node);
  const returnType = extractPhpReturnType(node);
  const docstring = extractDocComment(node);

  const qualifiedName = className ? `${className}.${name}` : name;
  const id = generateEntityId(filePath, 'function', qualifiedName, startLine);

  const entity: FunctionEntity = {
    id,
    name,
    filePath,
    startLine,
    endLine,
    isExported: vis === 'public' || vis === undefined,
    isAsync: false,
    isArrow: false,
    params,
  };

  if (returnType) entity.returnType = returnType;
  if (docstring) entity.docstring = docstring;

  // Universal complexity metrics
  const mMetrics = calculateComplexity(node);
  entity.complexity = mMetrics.cyclomatic;
  entity.cognitiveComplexity = mMetrics.cognitive;
  entity.nestingDepth = mMetrics.nestingDepth;

  return entity;
}

/**
 * Extract parameters from a PHP function/method.
 * Looks for the formal_parameters node containing simple_parameter children.
 */
function extractPhpParams(
  funcNode: SyntaxNode,
): { name: string; type?: string; optional?: boolean }[] {
  const params: { name: string; type?: string; optional?: boolean }[] = [];

  const paramList = funcNode.children.find(
    (c: SyntaxNode) => c.type === 'formal_parameters',
  );
  if (!paramList) return params;

  for (const child of paramList.children) {
    if (child.type === 'simple_parameter') {
      // simple_parameter has: type_node?, variable_name, default_value?
      const varNode = child.children.find(
        (c: SyntaxNode) => c.type === 'variable_name',
      );
      if (!varNode) continue;

      const paramName = varNode.text; // includes $
      const p: { name: string; type?: string; optional?: boolean } = { name: paramName };

      // Type is the node before variable_name that is a type node
      const typeNode = child.children.find(
        (c: SyntaxNode) =>
          c.type === 'primitive_type' ||
          c.type === 'named_type' ||
          c.type === 'optional_type' ||
          c.type === 'union_type' ||
          c.type === 'intersection_type' ||
          c.type === 'nullable_type',
      );
      if (typeNode) p.type = typeNode.text;

      // Check for default value (= something) → optional
      const hasDefault = child.children.some((c: SyntaxNode) => c.type === '=');
      if (hasDefault) p.optional = true;

      params.push(p);
    } else if (child.type === 'variadic_parameter') {
      const varNode = child.children.find(
        (c: SyntaxNode) => c.type === 'variable_name',
      );
      if (varNode) {
        params.push({ name: `...${varNode.text}` });
      }
    }
  }

  return params;
}

/**
 * Extract return type from a PHP function/method.
 * Return type comes after ':' in function signatures.
 */
function extractPhpReturnType(funcNode: SyntaxNode): string | undefined {
  // Find the colon after formal_parameters — next sibling is the return type
  const children = funcNode.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child && child.type === ':') {
      const next = children[i + 1];
      if (
        next &&
        next.type !== 'compound_statement' &&
        next.type !== ';'
      ) {
        return next.text;
      }
    }
  }
  return undefined;
}

// ============================================================================
// Variable Extraction (properties, constants)
// ============================================================================

/**
 * Extract property and constant declarations from PHP AST.
 *
 * PHP AST shapes:
 *   property_declaration (inside class/trait)
 *     visibility_modifier?
 *     static_modifier?
 *     type?
 *     property_element (variable_name)
 *
 *   const_declaration (inside class or top-level)
 *     visibility_modifier? (class constants)
 *     const_element (name = value)
 */
export function extractVariables(root: SyntaxNode, filePath: string): VariableEntity[] {
  const variables: VariableEntity[] = [];

  // Class/trait properties
  const propNodes = findNodesOfType(root, ['property_declaration']);
  for (const node of propNodes) {
    const propElement = node.children.find(
      (c: SyntaxNode) => c.type === 'property_element',
    );
    if (!propElement) continue;

    const varNode = propElement.children.find(
      (c: SyntaxNode) => c.type === 'variable_name',
    );
    if (!varNode) continue;

    const name = varNode.text; // includes $
    const line = node.startPosition.row + 1;
    const vis = getVisibility(node);
    const id = generateEntityId(filePath, 'variable', name, line);

    // Try to get type
    const typeNode = node.children.find(
      (c: SyntaxNode) =>
        c.type === 'primitive_type' ||
        c.type === 'named_type' ||
        c.type === 'optional_type' ||
        c.type === 'union_type' ||
        c.type === 'intersection_type' ||
        c.type === 'nullable_type',
    );

    const entity: VariableEntity = {
      id,
      name,
      filePath,
      line,
      kind: 'let',
      isExported: vis === 'public' || vis === undefined,
    };
    if (typeNode) entity.type = typeNode.text;
    variables.push(entity);
  }

  // Constants (class and top-level)
  const constNodes = findNodesOfType(root, ['const_declaration']);
  for (const node of constNodes) {
    const constElement = node.children.find(
      (c: SyntaxNode) => c.type === 'const_element',
    );
    if (!constElement) continue;

    // const_element has a child of type 'name' (not a field)
    const nameNode = constElement.children.find(
      (c: SyntaxNode) => c.type === 'name',
    );
    if (!nameNode) continue;

    const name = nameNode.text;
    const line = node.startPosition.row + 1;
    const id = generateEntityId(filePath, 'variable', name, line);

    const entity: VariableEntity = {
      id,
      name,
      filePath,
      line,
      kind: 'const',
      isExported: true,
    };
    variables.push(entity);
  }

  return variables;
}

// ============================================================================
// Import Extraction (namespace use declarations)
// ============================================================================

/**
 * Extract namespace use declarations from PHP AST.
 *
 * PHP AST shapes:
 *   namespace_use_declaration
 *     namespace_use_clause (simple or aliased)
 *       qualified_name (path with namespace_name + name)
 *       as? name (alias)
 *       function? (use function)
 *       const? (use const)
 *     namespace_name + namespace_use_group (grouped: use Foo\{Bar, Baz})
 */
export function extractImports(root: SyntaxNode, filePath: string): ImportEntity[] {
  const imports: ImportEntity[] = [];
  const useDecls = root.children.filter(
    (c: SyntaxNode) => c.type === 'namespace_use_declaration',
  );

  for (const decl of useDecls) {
    extractNamespaceUseDecl(decl, filePath, imports);
  }

  return imports;
}

function extractNamespaceUseDecl(
  decl: SyntaxNode,
  filePath: string,
  imports: ImportEntity[],
): void {
  // Check for grouped use: namespace_name + namespace_use_group
  const nsNameNode = decl.children.find(
    (c: SyntaxNode) => c.type === 'namespace_name',
  );
  const groupNode = decl.children.find(
    (c: SyntaxNode) => c.type === 'namespace_use_group',
  );

  if (nsNameNode && groupNode) {
    // Grouped import: use App\Services\{AuthService, UserService}
    const basePath = nsNameNode.text;
    const specifiers: { name: string; alias?: string }[] = [];

    for (const clause of groupNode.children) {
      if (clause.type === 'namespace_use_clause') {
        const clauseName = clause.children.find(
          (c: SyntaxNode) => c.type === 'name',
        );
        if (clauseName) {
          specifiers.push({ name: clauseName.text });
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
    return;
  }

  // Simple use declarations (possibly multiple namespace_use_clause children)
  for (const child of decl.children) {
    if (child.type === 'namespace_use_clause') {
      // Get the qualified name
      const qualifiedNode = child.children.find(
        (c: SyntaxNode) => c.type === 'qualified_name',
      );

      // Check for function/const prefix (use function ..., use const ...)
      const hasFunctionPrefix = child.children.some(
        (c: SyntaxNode) => c.type === 'function',
      );
      const hasConstPrefix = child.children.some(
        (c: SyntaxNode) => c.type === 'const',
      );

      if (qualifiedNode) {
        const fullPath = qualifiedNode.text;
        // The last component is the imported name
        const parts = fullPath.split('\\');
        const lastName = parts[parts.length - 1] || fullPath;

        // Check for alias: ... as AliasName
        // The alias is the name node AFTER the 'as' keyword
        let alias: string | undefined;
        const asIndex = child.children.findIndex((c: SyntaxNode) => c.type === 'as');
        if (asIndex >= 0) {
          const afterAs = child.children[asIndex + 1];
          if (afterAs && afterAs.type === 'name') {
            alias = afterAs.text;
          }
        }

        const line = decl.startPosition.row + 1;
        let source = fullPath;
        if (hasFunctionPrefix) source = `function ${fullPath}`;
        if (hasConstPrefix) source = `const ${fullPath}`;

        const id = generateEntityId(filePath, 'import', fullPath, line);

        const spec: { name: string; alias?: string } = { name: lastName };
        if (alias) spec.alias = alias;

        imports.push({
          id,
          filePath,
          source,
          isDefault: false,
          isNamespace: false,
          specifiers: [spec],
        });
      }
    }
  }
}

// ============================================================================
// Type Extraction (enums)
// ============================================================================

/**
 * Extract enum declarations from PHP AST.
 *
 * PHP AST shape:
 *   enum_declaration
 *     name (identifier)
 *     : primitive_type? (backed enum type)
 *     enum_declaration_list (body with enum_case and method_declaration)
 */
export function extractTypes(root: SyntaxNode, filePath: string): TypeEntity[] {
  const types: TypeEntity[] = [];

  const enumNodes = findNodesOfType(root, ['enum_declaration']);
  for (const node of enumNodes) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const docstring = extractDocComment(node);
    const id = generateEntityId(filePath, 'type', name, startLine);

    const entity: TypeEntity = {
      id,
      name,
      filePath,
      startLine,
      endLine,
      isExported: true,
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
 * Extract inheritance relationships from PHP AST.
 *
 * - class extends ParentClass -> extends
 * - class implements Interface1, Interface2 -> implements
 * - interface extends Interface1, Interface2 -> extends
 * - class { use TraitName; } -> implements (trait usage)
 * - enum implements Interface -> implements
 */
export function extractInheritance(root: SyntaxNode, filePath: string): InheritanceReference[] {
  const refs: InheritanceReference[] = [];

  // Classes
  const classNodes = findNodesOfType(root, ['class_declaration']);
  for (const node of classNodes) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;
    const className = nameNode.text;

    // extends (single parent class)
    const baseClause = node.children.find((c: SyntaxNode) => c.type === 'base_clause');
    if (baseClause) {
      for (const child of baseClause.children) {
        if (child.type === 'name') {
          refs.push({
            childName: className,
            parentName: child.text,
            type: 'extends',
            filePath,
          });
        }
      }
    }

    // implements (multiple interfaces)
    const interfaceClause = node.children.find(
      (c: SyntaxNode) => c.type === 'class_interface_clause',
    );
    if (interfaceClause) {
      for (const child of interfaceClause.children) {
        if (child.type === 'name') {
          refs.push({
            childName: className,
            parentName: child.text,
            type: 'implements',
            filePath,
          });
        }
      }
    }

    // Trait usage: use TraitName; inside class body
    const bodyNode = node.children.find(
      (c: SyntaxNode) => c.type === 'declaration_list',
    );
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === 'use_declaration') {
          // use_declaration children include name nodes for each trait
          for (const traitChild of child.children) {
            if (traitChild.type === 'name') {
              refs.push({
                childName: className,
                parentName: traitChild.text,
                type: 'implements',
                filePath,
              });
            }
          }
        }
      }
    }
  }

  // Interfaces
  const interfaceNodes = findNodesOfType(root, ['interface_declaration']);
  for (const node of interfaceNodes) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;
    const ifaceName = nameNode.text;

    const baseClause = node.children.find((c: SyntaxNode) => c.type === 'base_clause');
    if (baseClause) {
      for (const child of baseClause.children) {
        if (child.type === 'name') {
          refs.push({
            childName: ifaceName,
            parentName: child.text,
            type: 'extends',
            filePath,
          });
        }
      }
    }
  }

  // Enums can implement interfaces
  const enumNodes = findNodesOfType(root, ['enum_declaration']);
  for (const node of enumNodes) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;
    const enumName = nameNode.text;

    const interfaceClause = node.children.find(
      (c: SyntaxNode) => c.type === 'class_interface_clause',
    );
    if (interfaceClause) {
      for (const child of interfaceClause.children) {
        if (child.type === 'name') {
          refs.push({
            childName: enumName,
            parentName: child.text,
            type: 'implements',
            filePath,
          });
        }
      }
    }
  }

  return refs;
}

// ============================================================================
// Call Extraction
// ============================================================================

/** PHP built-in functions to skip */
const PHP_BUILTINS = new Set([
  // String functions
  'strlen', 'strpos', 'substr', 'str_replace', 'strtolower', 'strtoupper',
  'trim', 'ltrim', 'rtrim', 'explode', 'implode', 'sprintf', 'printf',
  'str_contains', 'str_starts_with', 'str_ends_with', 'str_pad',
  // Array functions
  'array_map', 'array_filter', 'array_reduce', 'array_merge', 'array_keys',
  'array_values', 'array_push', 'array_pop', 'array_shift', 'array_unshift',
  'array_slice', 'array_splice', 'array_unique', 'array_reverse',
  'array_search', 'array_key_exists', 'in_array', 'count', 'sort', 'usort',
  'array_combine', 'array_chunk', 'array_flip', 'array_diff', 'array_intersect',
  // Type functions
  'isset', 'unset', 'empty', 'is_array', 'is_string', 'is_int', 'is_null',
  'is_bool', 'is_object', 'is_numeric', 'is_callable', 'gettype', 'settype',
  'intval', 'floatval', 'strval', 'boolval',
  // Output
  'echo', 'print', 'print_r', 'var_dump', 'var_export',
  // JSON
  'json_encode', 'json_decode',
  // File functions
  'file_get_contents', 'file_put_contents', 'fopen', 'fclose', 'fread', 'fwrite',
  // Math
  'abs', 'ceil', 'floor', 'round', 'max', 'min', 'rand', 'mt_rand',
  // Class/object
  'class_exists', 'method_exists', 'property_exists', 'get_class',
  'instanceof', 'is_a',
  // Other common
  'date', 'time', 'strtotime', 'microtime', 'sleep', 'usleep',
  'preg_match', 'preg_replace', 'preg_match_all',
  'header', 'setcookie', 'session_start',
  'compact', 'extract', 'list', 'range',
  'throw', 'die', 'exit',
]);

/**
 * Extract function/method calls from PHP AST.
 * Only tracks calls to functions defined in the same file.
 */
export function extractCalls(root: SyntaxNode, filePath: string): CallReference[] {
  const calls: CallReference[] = [];

  // Get all functions in the file for local lookup
  const functions = extractFunctions(root, filePath);
  const localFunctionNames = new Set(functions.map((f) => f.name));

  // Find all function_definition and method_declaration nodes
  const allFuncNodes = findNodesOfType(root, ['function_definition', 'method_declaration']);

  for (const funcNode of allFuncNodes) {
    const callerNameNode = funcNode.childForFieldName('name');
    if (!callerNameNode) continue;
    const callerName = callerNameNode.text;

    const bodyNode = funcNode.children.find(
      (c: SyntaxNode) => c.type === 'compound_statement',
    );
    if (!bodyNode) continue;

    // Find function_call_expression and member_call_expression nodes
    const callNodes = findNodesOfType(bodyNode, [
      'function_call_expression',
      'member_call_expression',
      'scoped_call_expression',
    ]);

    for (const callNode of callNodes) {
      let calleeName: string | undefined;

      if (callNode.type === 'function_call_expression') {
        // Direct function call: functionName(args)
        const fnNameNode = callNode.children.find(
          (c: SyntaxNode) => c.type === 'name',
        );
        if (fnNameNode) {
          calleeName = fnNameNode.text;
        }
      } else if (callNode.type === 'member_call_expression') {
        // Method call: $obj->methodName(args)
        const nameNode = callNode.childForFieldName('name');
        calleeName = nameNode?.text;
      } else if (callNode.type === 'scoped_call_expression') {
        // Static call: ClassName::methodName(args)
        const nameNode = callNode.childForFieldName('name');
        calleeName = nameNode?.text;
      }

      if (!calleeName) continue;
      if (PHP_BUILTINS.has(calleeName)) continue;

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

export function resolvePhpImport(
  _importPath: string,
  _importingFilePath: string,
  _projectRoot: string,
): string | undefined {
  // TODO: Implement PHP import resolution (requires composer.json / PSR-4 parsing)
  return undefined;
}

// ============================================================================
// Plugin Export (via generic factory)
// ============================================================================

export const phpPlugin = createLanguagePlugin({
  id: 'php',
  displayName: 'PHP',
  extensions: ['.php'],
  grammar: PHP,
  nodeTypes: {
    functions: ['function_definition', 'method_declaration'],
    classes: ['class_declaration'],
    interfaces: ['interface_declaration', 'trait_declaration'],
    variables: ['property_declaration', 'const_declaration'],
    imports: ['namespace_use_declaration'],
    calls: ['function_call_expression', 'member_call_expression', 'scoped_call_expression'],
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
export const extractAllEntities = phpPlugin.extractAllEntities;
