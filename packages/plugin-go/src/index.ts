/**
 * @codegraph/plugin-go
 * Go language plugin for CodeGraph
 *
 * Extracts structs (→ Class), interfaces, functions, methods, variables,
 * imports, type aliases/definitions, and call references from Go source files
 * using tree-sitter-go.
 *
 * Go Mapping:
 *   struct → ClassEntity (closest equivalent; Go has no "class" keyword)
 *   interface → InterfaceEntity
 *   func (top-level) → FunctionEntity
 *   method (receiver) → FunctionEntity (with parentClass set)
 *   var/const → VariableEntity
 *   import → ImportEntity
 *   type alias/definition → TypeEntity
 */

import Go from 'tree-sitter-go';
import type {
  FunctionEntity,
  ClassEntity,
  InterfaceEntity,
  VariableEntity,
  ImportEntity,
  TypeEntity,
  CallReference,
  SyntaxNode,
  HasMethodEdgeDescriptor,
  HasPropertyEdgeDescriptor,
  Visibility,
} from '@codegraph/types';
import { findNodesOfType, generateEntityId, calculateComplexity } from '@codegraph/plugin-common';
import { createLanguagePlugin } from '@codegraph/plugin-generic';

/** Get the tree-sitter grammar for Go */
export function getGrammar(): unknown {
  return Go;
}

/**
 * Check if a Go identifier is exported (starts with uppercase letter).
 */
function isGoExported(name: string): boolean {
  if (name.length === 0) return false;
  const first = name.charAt(0);
  return first === first.toUpperCase() && first !== first.toLowerCase();
}

// ============================================================================
// Doc Comment Extraction
// ============================================================================

/**
 * Extract Go doc comment from a declaration node.
 * Go doc comments are consecutive // line comments immediately preceding
 * the declaration, or a single /* block comment.
 */
function extractDocComment(node: SyntaxNode): string | undefined {
  const commentLines: string[] = [];
  let current = node.previousSibling;

  while (current) {
    if (current.type === 'comment') {
      const text = current.text;
      if (text.startsWith('//')) {
        // Line comment — strip prefix
        commentLines.unshift(text.slice(2).trim());
      } else if (text.startsWith('/*')) {
        // Block comment — strip delimiters
        const cleaned = text
          .slice(2, -2)
          .split('\n')
          .map((line) => line.replace(/^\s*\*\s?/, '').trim())
          .filter((line) => line.length > 0)
          .join('\n');
        if (cleaned) commentLines.unshift(cleaned);
        break;
      }
      current = current.previousSibling;
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
 * Extract struct type declarations from Go AST.
 * Structs map to ClassEntity (closest equivalent in the unified schema).
 *
 * Go AST shape:
 *   type_declaration
 *     type_spec
 *       name: type_identifier
 *       type: struct_type
 *         field_declaration_list
 *           field_declaration
 */
export function extractClasses(root: SyntaxNode, filePath: string): ClassEntity[] {
  const classes: ClassEntity[] = [];
  const typeDecls = findNodesOfType(root, ['type_declaration']);

  for (const decl of typeDecls) {
    for (const child of decl.children) {
      if (child.type !== 'type_spec') continue;

      const nameNode = child.childForFieldName('name');
      const typeNode = child.childForFieldName('type');

      if (!nameNode || !typeNode || typeNode.type !== 'struct_type') continue;

      const name = nameNode.text;
      const startLine = decl.startPosition.row + 1;
      const endLine = decl.endPosition.row + 1;

      // In Go, exported = first letter is uppercase
      const isExported = isGoExported(name);

      // Extract embedded types (struct embedding → implements-like)
      const implementsList: string[] = [];
      const fieldList = typeNode.children.find(
        (c: SyntaxNode) => c.type === 'field_declaration_list',
      );
      if (fieldList) {
        for (const field of fieldList.children) {
          if (field.type !== 'field_declaration') continue;
          // Embedded field: no name, just a type
          const fieldNames = field.children.filter(
            (c: SyntaxNode) => c.type === 'field_identifier',
          );
          if (fieldNames.length === 0) {
            // This is an embedded type
            const typeChild = field.children.find(
              (c: SyntaxNode) =>
                c.type === 'type_identifier' ||
                c.type === 'qualified_type' ||
                c.type === 'pointer_type',
            );
            if (typeChild) {
              // For pointer embedding (*Type), get the inner type
              let embeddedName = typeChild.text;
              if (typeChild.type === 'pointer_type') {
                const inner = typeChild.children.find(
                  (c: SyntaxNode) => c.type === 'type_identifier' || c.type === 'qualified_type',
                );
                if (inner) embeddedName = inner.text;
              }
              implementsList.push(embeddedName);
            }
          }
        }
      }

      const docstring = extractDocComment(decl);
      const id = generateEntityId(filePath, 'class', name, startLine);

      const entity: ClassEntity = {
        id,
        name,
        filePath,
        startLine,
        endLine,
        isExported,
        isAbstract: false, // Go structs are never abstract
      };

      // Embedded types are closest to "implements" in Go
      if (implementsList.length > 0) entity.implements = implementsList;
      if (docstring) entity.docstring = docstring;

      classes.push(entity);
    }
  }

  return classes;
}

// ============================================================================
// Struct Extraction with HAS_METHOD / HAS_PROPERTY edges
// ============================================================================

/** Result of extractStructsWithEdges */
export interface GoClassExtractionResult {
  classes: ClassEntity[];
  methodEntities: FunctionEntity[];
  propertyEntities: VariableEntity[];
  hasMethodEdges: HasMethodEdgeDescriptor[];
  hasPropertyEdges: HasPropertyEdgeDescriptor[];
}

/**
 * Derive Go visibility from Go's uppercase-public naming convention.
 * Identifiers starting with an uppercase letter are exported (public);
 * lowercase identifiers are unexported (private).
 */
function goVisibility(name: string): Visibility {
  if (name.length === 0) return 'private';
  const first = name.charAt(0);
  return first === first.toUpperCase() && first !== first.toLowerCase() ? 'public' : 'private';
}

/**
 * Extract struct declarations together with their field-Variable entities,
 * method-Function entities, and HAS_PROPERTY / HAS_METHOD edge descriptors.
 *
 * Go-specific notes:
 *  - Structs are the analog of classes.
 *  - Struct fields → VariableEntity with id `<classId>::prop::<fieldName>`.
 *  - Methods are top-level `method_declaration` nodes (not nested in the struct body).
 *    The receiver type is resolved to match a struct in this file.
 *  - `isStatic` is always false — Go has no static-method concept.
 *  - Visibility uses Go's uppercase-public convention.
 *  - Methods whose receiver type is not declared in this file are skipped (no edge produced),
 *    but the standalone FunctionEntity is still extracted by extractFunctions.
 *
 * Go AST shape for struct:
 *   type_declaration
 *     type_spec
 *       name: type_identifier
 *       type: struct_type
 *         field_declaration_list
 *           field_declaration
 *
 * Go AST shape for method:
 *   method_declaration
 *     receiver: parameter_list  (e.g., (s *Server))
 *     name: field_identifier
 *     parameters: parameter_list
 *     result: ...
 *     body: block
 */
export function extractStructsWithEdges(
  root: SyntaxNode,
  filePath: string,
): GoClassExtractionResult {
  const classes: ClassEntity[] = [];
  const methodEntities: FunctionEntity[] = [];
  const propertyEntities: VariableEntity[] = [];
  const hasMethodEdges: HasMethodEdgeDescriptor[] = [];
  const hasPropertyEdges: HasPropertyEdgeDescriptor[] = [];

  // ---- Pass 1: collect structs (mirrors extractClasses logic) ----
  const typeDecls = findNodesOfType(root, ['type_declaration']);

  // Map from struct name → classId for fast receiver lookup in pass 2
  const structIdByName = new Map<string, string>();

  for (const decl of typeDecls) {
    for (const child of decl.children) {
      if (child.type !== 'type_spec') continue;

      const nameNode = child.childForFieldName('name');
      const typeNode = child.childForFieldName('type');

      if (!nameNode || !typeNode || typeNode.type !== 'struct_type') continue;

      const name = nameNode.text;
      const startLine = decl.startPosition.row + 1;
      const endLine = decl.endPosition.row + 1;
      const isExported = isGoExported(name);

      // Extract embedded types (struct embedding → implements-like)
      const implementsList: string[] = [];
      const fieldList = typeNode.children.find(
        (c: SyntaxNode) => c.type === 'field_declaration_list',
      );

      if (fieldList) {
        for (const field of fieldList.children) {
          if (field.type !== 'field_declaration') continue;

          const fieldNames = field.children.filter(
            (c: SyntaxNode) => c.type === 'field_identifier',
          );

          if (fieldNames.length === 0) {
            // Embedded type (no field name)
            const typeChild = field.children.find(
              (c: SyntaxNode) =>
                c.type === 'type_identifier' ||
                c.type === 'qualified_type' ||
                c.type === 'pointer_type',
            );
            if (typeChild) {
              let embeddedName = typeChild.text;
              if (typeChild.type === 'pointer_type') {
                const inner = typeChild.children.find(
                  (c: SyntaxNode) => c.type === 'type_identifier' || c.type === 'qualified_type',
                );
                if (inner) embeddedName = inner.text;
              }
              implementsList.push(embeddedName);
            }
          }
        }
      }

      const docstring = extractDocComment(decl);
      const classId = generateEntityId(filePath, 'class', name, startLine);
      structIdByName.set(name, classId);

      const entity: ClassEntity = {
        id: classId,
        name,
        filePath,
        startLine,
        endLine,
        isExported,
        isAbstract: false,
      };
      if (implementsList.length > 0) entity.implements = implementsList;
      if (docstring) entity.docstring = docstring;

      classes.push(entity);

      // ---- Extract field declarations → HAS_PROPERTY ----
      if (!fieldList) continue;

      const propNameCount = new Map<string, number>();

      for (const field of fieldList.children) {
        if (field.type !== 'field_declaration') continue;

        // Skip embedded (anonymous) fields — those have no field_identifier
        const fieldIdentifiers = field.children.filter(
          (c: SyntaxNode) => c.type === 'field_identifier',
        );
        if (fieldIdentifiers.length === 0) continue;

        // Extract type annotation (last non-tag, non-identifier child)
        const typeChild = field.children.find(
          (c: SyntaxNode) =>
            c.type === 'type_identifier' ||
            c.type === 'pointer_type' ||
            c.type === 'qualified_type' ||
            c.type === 'array_type' ||
            c.type === 'slice_type' ||
            c.type === 'map_type' ||
            c.type === 'interface_type' ||
            c.type === 'struct_type' ||
            c.type === 'function_type' ||
            c.type === 'channel_type',
        );
        const fieldType = typeChild?.text;

        // Go allows multiple names per field: `X, Y int`
        for (const fieldIdent of fieldIdentifiers) {
          const fieldName = fieldIdent.text;
          const count = propNameCount.get(fieldName) ?? 0;
          propNameCount.set(fieldName, count + 1);
          const suffix = count > 0 ? `:${count}` : '';

          const propId = `${classId}::prop::${fieldName}${suffix}`;
          const line = field.startPosition.row + 1;
          const visibility = goVisibility(fieldName);

          const propEntity: VariableEntity = {
            id: propId,
            name: fieldName,
            filePath,
            line,
            kind: 'let', // Go fields are mutable by default
            isExported: visibility === 'public',
          };
          if (fieldType) propEntity.type = fieldType;

          propertyEntities.push(propEntity);
          hasPropertyEdges.push({
            fromId: classId,
            toId: propId,
            isStatic: false, // Go has no static fields
            visibility,
            isReadonly: false,
          });
        }
      }
    }
  }

  // ---- Pass 2: walk method_declarations, resolve receiver → struct ----
  const methodDecls = findNodesOfType(root, ['method_declaration']);
  const methodNameCountByClass = new Map<string, Map<string, number>>();

  for (const node of methodDecls) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;

    const methodName = nameNode.text;
    const receiverTypeName = extractReceiverType(node);

    if (!receiverTypeName) continue;

    const classId = structIdByName.get(receiverTypeName);
    if (!classId) {
      // Receiver type not declared in this file — skip the HAS_METHOD edge.
      // The standalone FunctionEntity is still extracted by extractFunctions.
      continue;
    }

    // Track method name counts per class for overload suffixes
    if (!methodNameCountByClass.has(classId)) {
      methodNameCountByClass.set(classId, new Map());
    }
    const nameCount = methodNameCountByClass.get(classId)!;
    const count = nameCount.get(methodName) ?? 0;
    nameCount.set(methodName, count + 1);
    const suffix = count > 0 ? `:${count}` : '';

    const methodId = `${classId}::method::${methodName}${suffix}`;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const isExported = isGoExported(methodName);
    const visibility = goVisibility(methodName);

    const params = extractGoParams(node);
    const returnType = extractGoReturnType(node);
    const docstring = extractDocComment(node);
    const metrics = calculateComplexity(node);

    const methodEntity: FunctionEntity = {
      id: methodId,
      name: methodName,
      filePath,
      startLine,
      endLine,
      isExported,
      isAsync: false,
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
      toId: methodId,
      isStatic: false, // Go has no static methods
      visibility,
    });
  }

  return { classes, methodEntities, propertyEntities, hasMethodEdges, hasPropertyEdges };
}

// ============================================================================
// Interface Extraction
// ============================================================================

/**
 * Extract interface type declarations from Go AST.
 *
 * Go AST shape:
 *   type_declaration
 *     type_spec
 *       name: type_identifier
 *       type: interface_type
 */
export function extractInterfaces(root: SyntaxNode, filePath: string): InterfaceEntity[] {
  const interfaces: InterfaceEntity[] = [];
  const typeDecls = findNodesOfType(root, ['type_declaration']);

  for (const decl of typeDecls) {
    for (const child of decl.children) {
      if (child.type !== 'type_spec') continue;

      const nameNode = child.childForFieldName('name');
      const typeNode = child.childForFieldName('type');

      if (!nameNode || !typeNode || typeNode.type !== 'interface_type') continue;

      const name = nameNode.text;
      const startLine = decl.startPosition.row + 1;
      const endLine = decl.endPosition.row + 1;
      const isExported = isGoExported(name);

      // Extract embedded interfaces (interface embedding → extends)
      const extendsList: string[] = [];
      for (const member of typeNode.children) {
        // Embedded interface: just a type_identifier in the interface body
        if (member.type === 'type_identifier' || member.type === 'qualified_type') {
          extendsList.push(member.text);
        }
        // tree-sitter-go wraps embedded interfaces in type_elem nodes
        if (member.type === 'type_elem') {
          for (const inner of member.children) {
            if (inner.type === 'type_identifier' || inner.type === 'qualified_type') {
              extendsList.push(inner.text);
            }
          }
        }
        // Also check for constraint_elem in newer Go versions (type sets)
        if (member.type === 'struct_elem' || member.type === 'constraint_elem') {
          // Type constraints — not standard extends, skip for now
        }
      }

      const docstring = extractDocComment(decl);
      const id = generateEntityId(filePath, 'interface', name, startLine);

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
  }

  return interfaces;
}

// ============================================================================
// Function & Method Extraction
// ============================================================================

/**
 * Extract function and method declarations from Go AST.
 *
 * Go AST shapes:
 *   function_declaration
 *     name: identifier
 *     parameters: parameter_list
 *     result: (type or parameter_list)
 *     body: block
 *
 *   method_declaration
 *     receiver: parameter_list  (e.g., (s *Server))
 *     name: field_identifier
 *     parameters: parameter_list
 *     result: ...
 *     body: block
 */
export function extractFunctions(root: SyntaxNode, filePath: string): FunctionEntity[] {
  const functions: FunctionEntity[] = [];

  // Top-level functions
  const funcDecls = findNodesOfType(root, ['function_declaration']);
  for (const node of funcDecls) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const isExported = isGoExported(name);

    const params = extractGoParams(node);
    const returnType = extractGoReturnType(node);
    const docstring = extractDocComment(node);
    const id = generateEntityId(filePath, 'function', name, startLine);

    const entity: FunctionEntity = {
      id,
      name,
      filePath,
      startLine,
      endLine,
      isExported,
      isAsync: false, // Go doesn't have async keyword; goroutines are different
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

    functions.push(entity);
  }

  // Methods (with receivers)
  const methodDecls = findNodesOfType(root, ['method_declaration']);
  for (const node of methodDecls) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const isExported = isGoExported(name);

    const params = extractGoParams(node);
    const returnType = extractGoReturnType(node);
    const docstring = extractDocComment(node);

    // Extract receiver type for parentClass
    const receiverType = extractReceiverType(node);

    const id = generateEntityId(filePath, 'function', `${receiverType || ''}.${name}`, startLine);

    const entity: FunctionEntity = {
      id,
      name,
      filePath,
      startLine,
      endLine,
      isExported,
      isAsync: false,
      isArrow: false,
      params,
    };

    if (returnType) entity.returnType = returnType;
    if (docstring) entity.docstring = docstring;
    // Note: receiver type is encoded in the function id (e.g., "Server.Start")
    // The parent relationship is expressed via CONTAINS edges in the graph

    // Universal complexity metrics
    const mMetrics = calculateComplexity(node);
    entity.complexity = mMetrics.cyclomatic;
    entity.cognitiveComplexity = mMetrics.cognitive;
    entity.nestingDepth = mMetrics.nestingDepth;

    functions.push(entity);
  }

  return functions;
}

/**
 * Extract parameters from a Go function/method declaration.
 */
function extractGoParams(
  funcNode: SyntaxNode,
): { name: string; type?: string; optional?: boolean }[] {
  const params: { name: string; type?: string; optional?: boolean }[] = [];

  const paramList = funcNode.childForFieldName('parameters');
  if (!paramList) return params;

  for (const child of paramList.children) {
    if (child.type === 'parameter_declaration') {
      // parameter_declaration has name(s) and type
      const typeNode = child.childForFieldName('type');
      const typeText = typeNode?.text;

      // Go allows multiple names per parameter declaration: a, b int
      const nameNodes = child.children.filter(
        (c: SyntaxNode) => c.type === 'identifier',
      );

      if (nameNodes.length > 0) {
        for (const nameNode of nameNodes) {
          const p: { name: string; type?: string; optional?: boolean } = { name: nameNode.text };
          if (typeText) p.type = typeText;
          params.push(p);
        }
      } else {
        // Unnamed parameter (just a type)
        params.push({
          name: '_',
          type: typeText || child.text,
        });
      }
    } else if (child.type === 'variadic_parameter_declaration') {
      const nameNode = child.childForFieldName('name');
      const typeNode = child.childForFieldName('type');
      params.push({
        name: nameNode?.text || '...',
        type: typeNode ? `...${typeNode.text}` : child.text,
        optional: true,
      });
    }
  }

  return params;
}

/**
 * Extract return type from a Go function declaration.
 */
function extractGoReturnType(funcNode: SyntaxNode): string | undefined {
  const resultNode = funcNode.childForFieldName('result');
  if (!resultNode) return undefined;
  return resultNode.text;
}

/**
 * Extract the receiver type from a Go method declaration.
 * e.g., func (s *Server) Start() → "Server"
 */
function extractReceiverType(methodNode: SyntaxNode): string | undefined {
  const receiver = methodNode.childForFieldName('receiver');
  if (!receiver) return undefined;

  // Look for parameter_declaration inside the receiver list
  for (const child of receiver.children) {
    if (child.type === 'parameter_declaration') {
      const typeNode = child.childForFieldName('type');
      if (typeNode) {
        // Handle pointer receivers: *Server → Server
        if (typeNode.type === 'pointer_type') {
          const inner = typeNode.children.find(
            (c: SyntaxNode) => c.type === 'type_identifier',
          );
          return inner?.text;
        }
        return typeNode.text;
      }
    }
  }

  return undefined;
}

// ============================================================================
// Variable Extraction (var, const)
// ============================================================================

/**
 * Extract var and const declarations from Go AST.
 *
 * Go AST shapes:
 *   var_declaration → var_spec (name, type, value)
 *   const_declaration → const_spec (name, type, value)
 *   short_var_declaration → identifier_list := expression_list (top-level not valid, but in init)
 */
export function extractVariables(root: SyntaxNode, filePath: string): VariableEntity[] {
  const variables: VariableEntity[] = [];

  // var declarations (can be grouped: var ( ... ))
  // Note: grouped vars have var_spec inside var_spec_list, so use recursive find
  const varDecls = findNodesOfType(root, ['var_declaration']);
  for (const decl of varDecls) {
    const specs = findNodesOfType(decl, ['var_spec']);
    for (const spec of specs) {
      extractVarSpec(spec, filePath, 'let', variables);
    }
  }

  // const declarations
  // Note: const_spec may be direct children or inside const_spec_list
  const constDecls = findNodesOfType(root, ['const_declaration']);
  for (const decl of constDecls) {
    const specs = findNodesOfType(decl, ['const_spec']);
    for (const spec of specs) {
      extractVarSpec(spec, filePath, 'const', variables);
    }
  }

  return variables;
}

/**
 * Extract variables from a var_spec or const_spec node.
 */
function extractVarSpec(
  spec: SyntaxNode,
  filePath: string,
  kind: 'const' | 'let',
  variables: VariableEntity[],
): void {
  const nameNode = spec.childForFieldName('name');
  const typeNode = spec.childForFieldName('type');

  if (!nameNode) {
    // Multiple names: find all identifiers
    const names = spec.children.filter(
      (c: SyntaxNode) => c.type === 'identifier',
    );
    for (const n of names) {
      const name = n.text;
      const line = spec.startPosition.row + 1;
      const isExported = isGoExported(name);
      const id = generateEntityId(filePath, 'variable', name, line);

      const entity: VariableEntity = {
        id,
        name,
        filePath,
        line,
        kind,
        isExported,
      };
      if (typeNode) entity.type = typeNode.text;
      variables.push(entity);
    }
    return;
  }

  const name = nameNode.text;
  const line = spec.startPosition.row + 1;
  const isExported = isGoExported(name);
  const id = generateEntityId(filePath, 'variable', name, line);

  const entity: VariableEntity = {
    id,
    name,
    filePath,
    line,
    kind,
    isExported,
  };
  if (typeNode) entity.type = typeNode.text;
  variables.push(entity);
}

// ============================================================================
// Import Extraction
// ============================================================================

/**
 * Extract import declarations from Go AST.
 *
 * Go AST shapes:
 *   import_declaration
 *     import_spec (single)
 *     import_spec_list (grouped)
 *       import_spec
 *         name: package_identifier (alias, optional)
 *         path: interpreted_string_literal
 */
export function extractImports(root: SyntaxNode, filePath: string): ImportEntity[] {
  const imports: ImportEntity[] = [];
  const importDecls = findNodesOfType(root, ['import_declaration']);

  for (const decl of importDecls) {
    const specs = findNodesOfType(decl, ['import_spec']);

    for (const spec of specs) {
      const pathNode = spec.childForFieldName('path');
      if (!pathNode) continue;

      // Strip quotes from import path
      const importPath = pathNode.text.replace(/"/g, '');
      const line = spec.startPosition.row + 1;

      // Check for alias (named import)
      const nameNode = spec.childForFieldName('name');
      const alias = nameNode?.text;

      // The "specifier" is the last component of the import path (package name)
      const parts = importPath.split('/');
      const pkgName = parts[parts.length - 1] || importPath;

      // Check for dot import or blank import
      const isDot = alias === '.';
      const isBlank = alias === '_';

      const id = generateEntityId(filePath, 'import', importPath, line);

      const specifiers: { name: string; alias?: string }[] = [];
      if (!isDot && !isBlank) {
        const spec: { name: string; alias?: string } = { name: pkgName };
        if (alias && alias !== pkgName) spec.alias = alias;
        specifiers.push(spec);
      }

      imports.push({
        id,
        filePath,
        source: importPath,
        isDefault: false,
        isNamespace: isDot, // dot import is like namespace import
        specifiers,
      });
    }
  }

  return imports;
}

// ============================================================================
// Type Extraction (type aliases, type definitions)
// ============================================================================

/**
 * Extract type aliases and type definitions from Go AST.
 * Excludes structs and interfaces (handled separately).
 *
 * Go AST shape:
 *   type_declaration
 *     type_spec
 *       name: type_identifier
 *       type: (anything except struct_type and interface_type)
 *
 *   type_alias:
 *     type_spec with "=" between name and type
 */
export function extractTypes(root: SyntaxNode, filePath: string): TypeEntity[] {
  const types: TypeEntity[] = [];
  const typeDecls = findNodesOfType(root, ['type_declaration']);

  for (const decl of typeDecls) {
    for (const child of decl.children) {
      if (child.type !== 'type_spec') continue;

      const nameNode = child.childForFieldName('name');
      const typeNode = child.childForFieldName('type');

      if (!nameNode || !typeNode) continue;

      // Skip struct and interface types — handled by extractClasses/extractInterfaces
      if (typeNode.type === 'struct_type' || typeNode.type === 'interface_type') continue;

      const name = nameNode.text;
      const startLine = decl.startPosition.row + 1;
      const endLine = decl.endPosition.row + 1;
      const isExported = isGoExported(name);

      const docstring = extractDocComment(decl);
      const id = generateEntityId(filePath, 'type', name, startLine);

      // Both type definitions and type aliases map to kind 'type'
      // (TypeKind only supports 'type' | 'enum')
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
  }

  return types;
}

// ============================================================================
// Inheritance Extraction
// ============================================================================

// ============================================================================
// Call Extraction
// ============================================================================

/** Go built-in functions and common stdlib to skip */
const GO_BUILTINS = new Set([
  // Built-in functions
  'append', 'cap', 'close', 'complex', 'copy', 'delete',
  'imag', 'len', 'make', 'max', 'min', 'new', 'panic',
  'print', 'println', 'real', 'recover',
  // Common fmt
  'Printf', 'Println', 'Sprintf', 'Fprintf', 'Errorf',
  // Common log
  'Fatal', 'Fatalf', 'Fatalln', 'Print', 'Printf', 'Println',
  // Common errors
  'New', 'Is', 'As', 'Unwrap',
  // Common testing
  'Run', 'Error', 'Errorf', 'Fatal', 'Fatalf', 'Log', 'Logf',
  'Skip', 'Skipf', 'Helper', 'Parallel', 'Cleanup',
  // Common context
  'Background', 'TODO', 'WithCancel', 'WithTimeout', 'WithValue',
  // Common string/strconv
  'Contains', 'HasPrefix', 'HasSuffix', 'Join', 'Split', 'TrimSpace',
  'Atoi', 'Itoa', 'FormatInt', 'ParseInt',
]);

/**
 * Extract function/method calls from Go AST.
 * Only tracks calls to functions defined in the same file.
 */
export function extractCalls(root: SyntaxNode, filePath: string): CallReference[] {
  const calls: CallReference[] = [];

  // Get all functions/methods in the file for local lookup
  const functions = extractFunctions(root, filePath);
  const localFunctionNames = new Set(functions.map((f) => f.name));

  // Find all function and method declarations, then search for calls in their bodies
  const funcNodes = findNodesOfType(root, ['function_declaration', 'method_declaration']);

  for (const funcNode of funcNodes) {
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
        // Direct function call: myFunc()
        calleeName = fnNode.text;
      } else if (fnNode.type === 'selector_expression') {
        // Method call or qualified call: obj.Method() or pkg.Func()
        const fieldNode = fnNode.childForFieldName('field');
        calleeName = fieldNode?.text;
      }

      if (!calleeName) continue;
      if (GO_BUILTINS.has(calleeName)) continue;

      // Only create edges for local function/method calls
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

/**
 * Resolve a Go import to a file path.
 * Go import resolution requires understanding go.mod, GOPATH, and module structure.
 * This is a placeholder.
 */
export function resolveGoImport(
  _importPath: string,
  _importingFilePath: string,
  _projectRoot: string,
): string | undefined {
  // TODO: Implement Go import-to-file resolution
  // Would require parsing go.mod and understanding Go module structure
  return undefined;
}

// ============================================================================
// Plugin Export (via generic factory)
// ============================================================================

export const goPlugin = createLanguagePlugin({
  id: 'go',
  displayName: 'Go',
  extensions: ['.go'],
  grammar: Go,
  nodeTypes: {
    functions: ['function_declaration', 'method_declaration'],
    classes: ['type_declaration'],
    interfaces: ['type_declaration'],
    variables: ['var_declaration', 'const_declaration'],
    imports: ['import_declaration'],
    calls: ['call_expression'],
  },
  overrides: {
    extractFunctions,
    extractClasses,
    extractInterfaces,
    extractVariables,
    extractImports,
    extractTypes,
    // extractInheritance — uses generic (derives from ClassEntity.implements + InterfaceEntity.extends)
    extractCalls,
  },
});

// Re-export all extractors for backward compatibility
export const extractInheritance = goPlugin.extractors.extractInheritance;

/**
 * Extract all entities from a Go AST, including HAS_METHOD and HAS_PROPERTY
 * edge descriptors produced by extractStructsWithEdges.
 *
 * Overrides the generic factory's extractAllEntities so the edge fields are populated.
 * The pipeline picks them up automatically via ParsedFileEntities.
 *
 * Function entities appear in two forms:
 *  - generateEntityId style (from extractFunctions) — targets for CALLS/CONTAINS edges
 *  - ::method:: style (from extractStructsWithEdges) — targets for HAS_METHOD edges
 * This matches the TypeScript and Python plugin patterns.
 */
export function extractAllEntities(root: SyntaxNode, filePath: string) {
  const allFunctions = extractFunctions(root, filePath);
  const structExtraction = extractStructsWithEdges(root, filePath);

  return {
    // Merge: generateEntityId-style functions + ::method:: entities from struct extraction
    functions: [...allFunctions, ...structExtraction.methodEntities],
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
  };
}
