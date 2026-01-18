/**
 * @codegraph/plugin-csharp
 * C# language plugin for CodeGraph
 */

import CSharp from 'tree-sitter-c-sharp';
import type {
  FunctionEntity,
  ClassEntity,
  InterfaceEntity,
  VariableEntity,
  ImportEntity,
  TypeEntity,
  InheritanceReference,
  CallReference,
  ExtractedEntities,
  SyntaxNode,
} from '@codegraph/types';

// ============================================================================
// Grammar Export
// ============================================================================

/** Get the tree-sitter grammar for C# */
export function getGrammar(): unknown {
  return CSharp;
}

/** Extension to grammar mapping */
const extensionToGrammar: Record<string, unknown> = {
  '.cs': CSharp,
};

/** Get the tree-sitter grammar for a file extension */
export function getGrammarForExtension(ext: string): unknown | undefined {
  const normalizedExt = ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return extensionToGrammar[normalizedExt];
}

/** Get all supported extensions */
export function getSupportedExtensions(): string[] {
  return Object.keys(extensionToGrammar);
}

/** Check if an extension is supported */
export function isSupported(ext: string): boolean {
  return getGrammarForExtension(ext) !== undefined;
}

// ============================================================================
// AST Utilities
// ============================================================================

function findNodesOfType(root: SyntaxNode, types: string[]): SyntaxNode[] {
  const results: SyntaxNode[] = [];

  function visit(node: SyntaxNode) {
    if (types.includes(node.type)) {
      results.push(node);
    }
    for (const child of node.children) {
      visit(child);
    }
  }

  visit(root);
  return results;
}

function generateEntityId(filePath: string, type: string, name: string, line: number): string {
  return `${filePath}:${type}:${name}:${line}`;
}

/**
 * Extract modifiers from a declaration node
 */
function extractModifiers(node: SyntaxNode): string[] {
  const modifiers: string[] = [];
  for (const child of node.children) {
    if (child.type === 'modifier') {
      modifiers.push(child.text);
    }
  }
  return modifiers;
}

/**
 * Check if modifiers indicate the item is exported (public, protected, internal)
 */
function isExportedFromModifiers(modifiers: string[]): boolean {
  return modifiers.includes('public') || modifiers.includes('protected') || modifiers.includes('internal');
}

/**
 * Check if modifiers indicate the item is abstract
 */
function isAbstractFromModifiers(modifiers: string[]): boolean {
  return modifiers.includes('abstract');
}

/**
 * Check if modifiers indicate the item is async
 */
function isAsyncFromModifiers(modifiers: string[]): boolean {
  return modifiers.includes('async');
}

/**
 * Check if modifiers indicate the item is static
 */
function isStaticFromModifiers(modifiers: string[]): boolean {
  return modifiers.includes('static');
}

// ============================================================================
// C# Extractors
// ============================================================================

/**
 * Extract class, struct, and record declarations from C# AST
 */
export function extractClasses(root: SyntaxNode, filePath: string): ClassEntity[] {
  const classes: ClassEntity[] = [];
  const classNodes = findNodesOfType(root, ['class_declaration', 'struct_declaration', 'record_declaration']);

  for (const node of classNodes) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    const modifiers = extractModifiers(node);
    const isExported = isExportedFromModifiers(modifiers);
    const isAbstract = isAbstractFromModifiers(modifiers);

    // Extract base classes and interfaces from base_list
    // Note: base_list is a child by type, not a named field
    let extendsName: string | undefined;
    const implementsList: string[] = [];

    const baseListNode = node.children.find((c: SyntaxNode) => c.type === 'base_list');
    if (baseListNode) {
      let isFirst = true;
      for (const child of baseListNode.children) {
        // Skip commas and colons
        if (child.type === ',' || child.type === ':') continue;

        // Handle different base type representations
        if (child.type === 'identifier' || child.type === 'generic_name' ||
          child.type === 'qualified_name' || child.type === 'simple_base_type') {
          const typeName = child.type === 'simple_base_type'
            ? child.firstChild?.text || child.text
            : child.text;

          if (typeName) {
            // First item could be either class or interface
            // In C#, if it starts with 'I' and has a capital second letter, it's likely an interface
            const isInterface = typeName.startsWith('I') && typeName.length > 1 &&
              typeName[1] === typeName[1].toUpperCase();

            if (isFirst && !isInterface) {
              extendsName = typeName;
            } else {
              implementsList.push(typeName);
            }
            isFirst = false;
          }
        }
      }
    }

    // Extract XML doc comments
    const docstring = extractXmlDocComment(node);

    const id = generateEntityId(filePath, 'class', name, startLine);

    const entity: ClassEntity = {
      id,
      name,
      filePath,
      startLine,
      endLine,
      isExported,
      isAbstract,
    };

    if (extendsName) entity.extends = extendsName;
    if (implementsList.length > 0) entity.implements = implementsList;
    if (docstring) entity.docstring = docstring;

    classes.push(entity);
  }

  return classes;
}

/**
 * Extract interface declarations from C# AST
 */
export function extractInterfaces(root: SyntaxNode, filePath: string): InterfaceEntity[] {
  const interfaces: InterfaceEntity[] = [];
  const interfaceNodes = findNodesOfType(root, ['interface_declaration']);

  for (const node of interfaceNodes) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    const modifiers = extractModifiers(node);
    const isExported = isExportedFromModifiers(modifiers);

    // Extract extended interfaces from base_list
    const extendsList: string[] = [];
    const baseListNode = node.children.find((c: SyntaxNode) => c.type === 'base_list');
    if (baseListNode) {
      for (const child of baseListNode.children) {
        if (child.type === ',' || child.type === ':') continue;

        if (child.type === 'identifier' || child.type === 'generic_name' ||
          child.type === 'qualified_name' || child.type === 'simple_base_type') {
          const typeName = child.type === 'simple_base_type'
            ? child.firstChild?.text || child.text
            : child.text;
          if (typeName) {
            extendsList.push(typeName);
          }
        }
      }
    }

    const docstring = extractXmlDocComment(node);

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

  return interfaces;
}

/**
 * Extract method and constructor declarations from C# AST
 */
export function extractFunctions(root: SyntaxNode, filePath: string): FunctionEntity[] {
  const functions: FunctionEntity[] = [];
  const methodNodes = findNodesOfType(root, ['method_declaration', 'constructor_declaration']);

  for (const node of methodNodes) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    const modifiers = extractModifiers(node);
    const isExported = isExportedFromModifiers(modifiers);
    const isAsync = isAsyncFromModifiers(modifiers);

    // Extract parameters
    const params = extractParameters(node);

    // Extract return type (not applicable for constructors)
    // Note: return type is a child by type, not a named field
    let returnType: string | undefined;
    if (node.type === 'method_declaration') {
      // Find the type node (usually before the method name)
      for (const child of node.children) {
        if (child.type === 'predefined_type' || child.type === 'identifier' ||
          child.type === 'generic_name' || child.type === 'qualified_name' ||
          child.type === 'nullable_type' || child.type === 'array_type') {
          // Skip if this is the method name (has field name 'name')
          const isName = node.children.findIndex((c: SyntaxNode) => c === child) ===
            node.children.findIndex((c: SyntaxNode) => node.childForFieldName('name') === c);
          if (!isName) {
            returnType = child.text;
            break;
          }
        }
      }
    }

    const docstring = extractXmlDocComment(node);

    const id = generateEntityId(filePath, 'function', name, startLine);

    const entity: FunctionEntity = {
      id,
      name,
      filePath,
      startLine,
      endLine,
      isExported,
      isAsync,
      isArrow: false, // C# doesn't have arrow functions in the same way
      params,
    };

    if (returnType) entity.returnType = returnType;
    if (docstring) entity.docstring = docstring;

    functions.push(entity);
  }

  return functions;
}

/**
 * Extract parameters from a method or constructor node
 */
function extractParameters(funcNode: SyntaxNode): { name: string; type?: string; optional?: boolean }[] {
  const params: { name: string; type?: string; optional?: boolean }[] = [];
  const parameterListNode = funcNode.childForFieldName('parameters');
  if (!parameterListNode) return params;

  for (const child of parameterListNode.children) {
    if (child.type === 'parameter') {
      const nameNode = child.childForFieldName('name');
      const typeNode = child.childForFieldName('type');
      const defaultValueNode = child.childForFieldName('default_value');

      if (nameNode) {
        params.push({
          name: nameNode.text,
          type: typeNode?.text,
          optional: defaultValueNode !== null,
        });
      }
    }
  }

  return params;
}

/**
 * Extract field and property declarations from C# AST
 */
export function extractVariables(root: SyntaxNode, filePath: string): VariableEntity[] {
  const variables: VariableEntity[] = [];

  // Extract fields
  const fieldNodes = findNodesOfType(root, ['field_declaration']);
  for (const node of fieldNodes) {
    const modifiers = extractModifiers(node);
    const isExported = isExportedFromModifiers(modifiers);
    const isConst = modifiers.includes('const') || modifiers.includes('readonly');

    // Find variable_declaration within field_declaration
    const varDeclNode = node.children.find((c: SyntaxNode) => c.type === 'variable_declaration');
    if (!varDeclNode) continue;

    const typeNode = varDeclNode.childForFieldName('type');
    const declarators = varDeclNode.children.filter((c: SyntaxNode) => c.type === 'variable_declarator');

    for (const declarator of declarators) {
      const nameNode = declarator.childForFieldName('name');
      if (!nameNode) continue;

      const name = nameNode.text;
      const line = node.startPosition.row + 1;
      const id = generateEntityId(filePath, 'variable', name, line);

      variables.push({
        id,
        name,
        filePath,
        line,
        kind: isConst ? 'const' : 'let',
        isExported,
        type: typeNode?.text,
      });
    }
  }

  // Extract properties (as variables for simplicity)
  const propNodes = findNodesOfType(root, ['property_declaration']);
  for (const node of propNodes) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;

    const modifiers = extractModifiers(node);
    const isExported = isExportedFromModifiers(modifiers);

    const typeNode = node.childForFieldName('type');
    const name = nameNode.text;
    const line = node.startPosition.row + 1;
    const id = generateEntityId(filePath, 'variable', name, line);

    variables.push({
      id,
      name,
      filePath,
      line,
      kind: 'let', // Properties are treated as mutable
      isExported,
      type: typeNode?.text,
    });
  }

  return variables;
}

/**
 * Extract using directives from C# AST
 */
export function extractImports(root: SyntaxNode, filePath: string): ImportEntity[] {
  const imports: ImportEntity[] = [];
  const usingNodes = findNodesOfType(root, ['using_directive']);

  for (const node of usingNodes) {
    const line = node.startPosition.row + 1;

    // Check for 'static' using
    const isStatic = node.children.some((c: SyntaxNode) => c.type === 'static');

    // Check for alias (using Alias = Namespace)
    const nameEqualsNode = node.children.find((c: SyntaxNode) => c.type === 'name_equals');
    let alias: string | undefined;
    if (nameEqualsNode) {
      const aliasIdentifier = nameEqualsNode.children.find((c: SyntaxNode) => c.type === 'identifier');
      if (aliasIdentifier) {
        alias = aliasIdentifier.text;
      }
    }

    // Get the namespace/type being imported
    const nameNode = node.children.find((c: SyntaxNode) =>
      c.type === 'identifier' ||
      c.type === 'qualified_name' ||
      c.type === 'alias_qualified_name'
    );

    if (!nameNode) continue;

    const source = nameNode.text;
    const id = generateEntityId(filePath, 'import', source, line);

    const entity: ImportEntity = {
      id,
      filePath,
      source,
      isDefault: false,
      isNamespace: !alias && !isStatic,
      specifiers: [],
    };

    if (alias) {
      entity.namespaceAlias = alias;
      entity.specifiers = [{ name: source, alias }];
    }

    imports.push(entity);
  }

  return imports;
}

/**
 * Extract enum and delegate declarations from C# AST
 */
export function extractTypes(root: SyntaxNode, filePath: string): TypeEntity[] {
  const types: TypeEntity[] = [];

  // Extract enums
  const enumNodes = findNodesOfType(root, ['enum_declaration']);
  for (const node of enumNodes) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    const modifiers = extractModifiers(node);
    const isExported = isExportedFromModifiers(modifiers);

    const docstring = extractXmlDocComment(node);

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

  // Extract delegates (map to type alias)
  const delegateNodes = findNodesOfType(root, ['delegate_declaration']);
  for (const node of delegateNodes) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    const modifiers = extractModifiers(node);
    const isExported = isExportedFromModifiers(modifiers);

    const id = generateEntityId(filePath, 'type', name, startLine);

    types.push({
      id,
      name,
      filePath,
      startLine,
      endLine,
      isExported,
      kind: 'type', // Delegates are function types
    });
  }

  return types;
}

/**
 * Extract XML documentation comment from a node
 */
function extractXmlDocComment(node: SyntaxNode): string | undefined {
  // Look for preceding comment nodes
  let current = node.previousSibling;
  const commentLines: string[] = [];

  while (current && current.type === 'comment') {
    const text = current.text;
    // Check for XML doc comment (///)
    if (text.startsWith('///')) {
      commentLines.unshift(text.slice(3).trim());
    }
    current = current.previousSibling;
  }

  if (commentLines.length > 0) {
    return commentLines.join('\n');
  }

  return undefined;
}

// ============================================================================
// Inheritance Extraction
// ============================================================================

/**
 * Extract inheritance relationships from C# classes and interfaces
 * Returns InheritanceReference[] for EXTENDS/IMPLEMENTS edges
 */
export function extractInheritance(root: SyntaxNode, filePath: string): InheritanceReference[] {
  const refs: InheritanceReference[] = [];

  const classes = extractClasses(root, filePath);
  const interfaces = extractInterfaces(root, filePath);

  // Class inheritance
  for (const cls of classes) {
    if (cls.extends) {
      refs.push({
        childName: cls.name,
        parentName: cls.extends,
        type: 'extends',
        filePath,
      });
    }
    if (cls.implements) {
      for (const iface of cls.implements) {
        refs.push({
          childName: cls.name,
          parentName: iface,
          type: 'implements',
          filePath,
        });
      }
    }
  }

  // Interface extension
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

/** C# System namespaces and common framework calls to skip */
const CSHARP_BUILTINS = new Set([
  // Console
  'Console', 'WriteLine', 'ReadLine', 'Write', 'Read',
  // String methods
  'ToString', 'Equals', 'GetHashCode', 'GetType',
  // Collection methods
  'Add', 'Remove', 'Clear', 'Contains', 'Count',
  'ToList', 'ToArray', 'ToDictionary', 'First', 'Last',
  'Where', 'Select', 'OrderBy', 'GroupBy', 'Any', 'All',
  'FirstOrDefault', 'LastOrDefault', 'SingleOrDefault',
  // Async
  'ConfigureAwait', 'Wait', 'Result',
  // Assert (testing)
  'Assert', 'AreEqual', 'IsTrue', 'IsFalse', 'IsNull', 'IsNotNull',
  'ThrowsException', 'Fail',
  // Logging
  'LogInformation', 'LogWarning', 'LogError', 'LogDebug', 'Log',
]);

/**
 * Extract method calls from C# AST
 * Returns CallReference[] for CALLS edges
 */
export function extractCalls(root: SyntaxNode, filePath: string): CallReference[] {
  const calls: CallReference[] = [];

  // Get all methods in the file for local function lookup
  const functions = extractFunctions(root, filePath);
  const localFunctionNames = new Set(functions.map(f => f.name));

  // Find all method definitions and extract calls from their bodies
  const methodNodes = findNodesOfType(root, ['method_declaration', 'constructor_declaration']);

  for (const methodNode of methodNodes) {
    const callerNameNode = methodNode.childForFieldName('name');
    if (!callerNameNode) continue;
    const callerName = callerNameNode.text;

    // Find the method body
    const bodyNode = methodNode.childForFieldName('body');
    if (!bodyNode) continue;

    // Find all invocation expressions in this method's body
    const invocationNodes = findNodesOfType(bodyNode, ['invocation_expression']);

    for (const invocation of invocationNodes) {
      // The function being called is typically the first child
      const funcExpr = invocation.firstChild;
      if (!funcExpr) continue;

      let calleeName: string | undefined;

      // Simple identifier: MethodCall()
      if (funcExpr.type === 'identifier') {
        calleeName = funcExpr.text;
      }
      // Member access: obj.Method() or this.Method()
      else if (funcExpr.type === 'member_access_expression') {
        const memberName = funcExpr.childForFieldName('name');
        if (memberName) {
          calleeName = memberName.text;
        }
      }
      // Generic name: Method<T>()
      else if (funcExpr.type === 'generic_name') {
        const nameNode = funcExpr.children.find((c: SyntaxNode) => c.type === 'identifier');
        if (nameNode) {
          calleeName = nameNode.text;
        }
      }

      if (!calleeName || CSHARP_BUILTINS.has(calleeName)) continue;

      // For now, only create edges for local method calls
      if (localFunctionNames.has(calleeName)) {
        calls.push({
          callerName,
          calleeName,
          line: invocation.startPosition.row + 1,
          filePath,
        });
      }
    }
  }

  return calls;
}

// ============================================================================
// Extract All Entities (Single Pass)
// ============================================================================

/**
 * Extract all entities from a C# file in a single pass
 */
export function extractAllEntities(root: SyntaxNode, filePath: string): ExtractedEntities {
  return {
    functions: extractFunctions(root, filePath),
    classes: extractClasses(root, filePath),
    interfaces: extractInterfaces(root, filePath),
    variables: extractVariables(root, filePath),
    imports: extractImports(root, filePath),
    types: extractTypes(root, filePath),
    components: [], // Not applicable for C#
  };
}

// ============================================================================
// Namespace Resolution (Placeholder for future)
// ============================================================================

/**
 * Resolve a C# using directive to a file path
 * Note: C# namespace resolution is complex and typically requires project file analysis
 * This is a placeholder for future implementation
 */
export function resolveCSharpImport(
  _namespaceName: string,
  _importingFilePath: string,
  _projectRoot: string
): string | undefined {
  // TODO: Implement namespace-to-file resolution
  // This would require parsing .csproj files and understanding the project structure
  return undefined;
}

// ============================================================================
// Plugin Export
// ============================================================================

export const csharpPlugin = {
  id: 'csharp',
  displayName: 'C#',
  extensions: ['.cs'],
  getGrammar,
  extractors: {
    extractFunctions,
    extractClasses,
    extractInterfaces,
    extractVariables,
    extractImports,
    extractTypes,
    extractInheritance,
    extractCalls,
  },
  extractAllEntities,
};
