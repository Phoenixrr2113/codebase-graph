/**
 * @codegraph/plugin-java
 * Java language plugin for CodeGraph
 *
 * Extracts classes, interfaces, enums, methods, fields, imports, and annotations
 * from Java source files using tree-sitter-java.
 *
 * Follows the same pattern as plugin-csharp (statically typed, class-based, interfaces).
 */

import Java from 'tree-sitter-java';
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

/** Get the tree-sitter grammar for Java */
export function getGrammar(): unknown {
  return Java;
}

/** Extension to grammar mapping */
const extensionToGrammar: Record<string, unknown> = {
  '.java': Java,
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

// ============================================================================
// Modifier Extraction
// ============================================================================

/**
 * Extract modifiers from a Java declaration node.
 * Java modifiers appear as child nodes of type 'modifiers' containing
 * individual modifier keywords.
 */
function extractModifiers(node: SyntaxNode): string[] {
  const modifiers: string[] = [];
  for (const child of node.children) {
    if (child.type === 'modifiers') {
      for (const mod of child.children) {
        // Modifier keywords: public, private, protected, static, final, abstract, etc.
        if (mod.type !== 'marker_annotation' && mod.type !== 'annotation') {
          modifiers.push(mod.text);
        }
      }
    }
  }
  return modifiers;
}

/**
 * Check if modifiers indicate the item is exported (public or protected).
 * In Java, package-private (no modifier) is not considered exported.
 */
function isExportedFromModifiers(modifiers: string[]): boolean {
  return modifiers.includes('public') || modifiers.includes('protected');
}

function isAbstractFromModifiers(modifiers: string[]): boolean {
  return modifiers.includes('abstract');
}

function isStaticFromModifiers(modifiers: string[]): boolean {
  return modifiers.includes('static');
}

function isFinalFromModifiers(modifiers: string[]): boolean {
  return modifiers.includes('final');
}

// ============================================================================
// Javadoc Comment Extraction
// ============================================================================

/**
 * Extract Javadoc comment from a declaration node.
 * Looks for a preceding block_comment that starts with /**.
 */
function extractJavadoc(node: SyntaxNode): string | undefined {
  let current = node.previousSibling;

  while (current) {
    if (current.type === 'block_comment' || current.type === 'comment') {
      const text = current.text;
      if (text.startsWith('/**')) {
        // Strip /** ... */ and clean up each line
        return text
          .slice(3, -2)
          .split('\n')
          .map((line) => line.replace(/^\s*\*\s?/, '').trim())
          .filter((line) => line.length > 0)
          .join('\n');
      }
    }
    // Skip line comments (// style) that may precede the Javadoc
    if (current.type === 'line_comment') {
      current = current.previousSibling;
      continue;
    }
    break;
  }

  return undefined;
}

// ============================================================================
// Class Extraction
// ============================================================================

/**
 * Extract class and record declarations from Java AST.
 */
export function extractClasses(root: SyntaxNode, filePath: string): ClassEntity[] {
  const classes: ClassEntity[] = [];
  const classNodes = findNodesOfType(root, ['class_declaration', 'record_declaration']);

  for (const node of classNodes) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    const modifiers = extractModifiers(node);
    const isExported = isExportedFromModifiers(modifiers);
    const isAbstract = isAbstractFromModifiers(modifiers);

    // Extract superclass from 'superclass' field
    let extendsName: string | undefined;
    const superclassNode = node.childForFieldName('superclass');
    if (superclassNode) {
      // superclass node wraps the type — extract the type_identifier
      const typeNode = superclassNode.children.find(
        (c: SyntaxNode) =>
          c.type === 'type_identifier' ||
          c.type === 'generic_type' ||
          c.type === 'scoped_type_identifier',
      );
      if (typeNode) {
        extendsName = typeNode.type === 'generic_type'
          ? typeNode.children.find((c: SyntaxNode) => c.type === 'type_identifier')?.text || typeNode.text
          : typeNode.text;
      }
    }

    // Extract interfaces from 'interfaces' field (super_interfaces)
    const implementsList: string[] = [];
    const interfacesNode = node.childForFieldName('interfaces');
    if (interfacesNode) {
      const typeList = interfacesNode.children.find(
        (c: SyntaxNode) => c.type === 'type_list',
      );
      if (typeList) {
        for (const child of typeList.children) {
          if (child.type === 'type_identifier' || child.type === 'generic_type' ||
              child.type === 'scoped_type_identifier') {
            const typeName = child.type === 'generic_type'
              ? child.children.find((c: SyntaxNode) => c.type === 'type_identifier')?.text || child.text
              : child.text;
            implementsList.push(typeName);
          }
        }
      }
    }

    const docstring = extractJavadoc(node);
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

// ============================================================================
// Interface Extraction
// ============================================================================

/**
 * Extract interface declarations from Java AST.
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

    // Extract extended interfaces
    const extendsList: string[] = [];
    const extendsNode = node.children.find(
      (c: SyntaxNode) => c.type === 'extends_interfaces',
    );
    if (extendsNode) {
      const typeList = extendsNode.children.find(
        (c: SyntaxNode) => c.type === 'type_list',
      );
      if (typeList) {
        for (const child of typeList.children) {
          if (child.type === 'type_identifier' || child.type === 'generic_type' ||
              child.type === 'scoped_type_identifier') {
            const typeName = child.type === 'generic_type'
              ? child.children.find((c: SyntaxNode) => c.type === 'type_identifier')?.text || child.text
              : child.text;
            extendsList.push(typeName);
          }
        }
      }
    }

    const docstring = extractJavadoc(node);
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

// ============================================================================
// Method Extraction
// ============================================================================

/**
 * Extract method and constructor declarations from Java AST.
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
    const isStatic = isStaticFromModifiers(modifiers);

    // Extract parameters
    const params = extractParameters(node);

    // Extract return type (method_declaration only, not constructors)
    let returnType: string | undefined;
    if (node.type === 'method_declaration') {
      const typeNode = node.childForFieldName('type');
      if (typeNode) {
        returnType = typeNode.text;
      }
    }

    const docstring = extractJavadoc(node);
    const id = generateEntityId(filePath, 'function', name, startLine);

    const entity: FunctionEntity = {
      id,
      name,
      filePath,
      startLine,
      endLine,
      isExported,
      isAsync: false, // Java doesn't have async keyword
      isArrow: false,  // Java doesn't have arrow functions
      params,
    };

    if (returnType) entity.returnType = returnType;
    if (docstring) entity.docstring = docstring;

    functions.push(entity);
  }

  return functions;
}

/**
 * Extract parameters from a method or constructor declaration.
 */
function extractParameters(
  funcNode: SyntaxNode,
): { name: string; type?: string; optional?: boolean }[] {
  const params: { name: string; type?: string; optional?: boolean }[] = [];

  const parameterListNode = funcNode.childForFieldName('parameters');
  if (!parameterListNode) return params;

  for (const child of parameterListNode.children) {
    if (child.type === 'formal_parameter' || child.type === 'spread_parameter') {
      const nameNode = child.childForFieldName('name');
      const typeNode = child.childForFieldName('type');

      if (nameNode) {
        params.push({
          name: nameNode.text,
          type: typeNode?.text,
          optional: false,
        });
      }
    }
  }

  return params;
}

// ============================================================================
// Variable (Field) Extraction
// ============================================================================

/**
 * Extract field declarations from Java AST.
 * Fields in Java are always inside a class body.
 */
export function extractVariables(root: SyntaxNode, filePath: string): VariableEntity[] {
  const variables: VariableEntity[] = [];
  const fieldNodes = findNodesOfType(root, ['field_declaration']);

  for (const node of fieldNodes) {
    const modifiers = extractModifiers(node);
    const isExported = isExportedFromModifiers(modifiers);
    const isFinal = isFinalFromModifiers(modifiers);

    // Find the type
    const typeNode = node.childForFieldName('type');

    // Find variable declarators
    const declarators = node.children.filter(
      (c: SyntaxNode) => c.type === 'variable_declarator',
    );

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
        kind: isFinal ? 'const' : 'let',
        isExported,
        type: typeNode?.text,
      });
    }
  }

  return variables;
}

// ============================================================================
// Import Extraction
// ============================================================================

/**
 * Extract import declarations from Java AST.
 * Java imports are either single-type or on-demand (wildcard).
 */
export function extractImports(root: SyntaxNode, filePath: string): ImportEntity[] {
  const imports: ImportEntity[] = [];
  const importNodes = findNodesOfType(root, ['import_declaration']);

  for (const node of importNodes) {
    const line = node.startPosition.row + 1;
    const text = node.text;

    // Check for static import
    const isStatic = node.children.some((c: SyntaxNode) => c.text === 'static');

    // Check for wildcard import (import foo.bar.*)
    const isWildcard = text.includes('.*');

    // Extract the qualified name
    // In tree-sitter-java, the import path is a scoped_identifier or identifier
    let source = '';
    for (const child of node.children) {
      if (child.type === 'scoped_identifier' || child.type === 'identifier') {
        source = child.text;
        break;
      }
    }

    if (!source) continue;

    // For wildcard imports, the source is the package name
    // For specific imports, extract the class name as a specifier
    const specifiers: { name: string; alias?: string }[] = [];
    let importSource = source;

    if (!isWildcard) {
      // Extract the last component as the imported class name
      const lastDot = source.lastIndexOf('.');
      if (lastDot >= 0) {
        importSource = source.slice(0, lastDot);
        specifiers.push({ name: source.slice(lastDot + 1) });
      } else {
        specifiers.push({ name: source });
      }
    }

    const id = generateEntityId(filePath, 'import', source, line);

    imports.push({
      id,
      filePath,
      source: importSource,
      isDefault: false,
      isNamespace: isWildcard,
      specifiers,
    });
  }

  return imports;
}

// ============================================================================
// Type Extraction (Enums & Annotations)
// ============================================================================

/**
 * Extract enum and annotation type declarations from Java AST.
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

    const docstring = extractJavadoc(node);
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

  // Extract annotation types (@interface)
  const annotationNodes = findNodesOfType(root, ['annotation_type_declaration']);
  for (const node of annotationNodes) {
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
      kind: 'type', // Annotation types map to 'type'
    });
  }

  return types;
}

// ============================================================================
// Inheritance Extraction
// ============================================================================

/**
 * Extract inheritance relationships from Java classes and interfaces.
 * Returns InheritanceReference[] for EXTENDS/IMPLEMENTS edges.
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

/** Java built-in / common framework methods to skip */
const JAVA_BUILTINS = new Set([
  // Object methods
  'toString', 'equals', 'hashCode', 'getClass', 'clone', 'notify', 'notifyAll', 'wait',
  // System / IO
  'println', 'print', 'printf', 'format',
  // Collection methods
  'add', 'remove', 'get', 'set', 'size', 'isEmpty', 'contains', 'containsKey',
  'put', 'clear', 'iterator', 'stream', 'of', 'asList',
  // Stream methods
  'map', 'filter', 'reduce', 'collect', 'forEach', 'flatMap', 'sorted',
  'toList', 'toSet', 'toMap', 'count', 'findFirst', 'findAny',
  'orElse', 'orElseGet', 'orElseThrow',
  // String methods
  'length', 'charAt', 'substring', 'trim', 'split', 'replace', 'matches',
  'startsWith', 'endsWith', 'toLowerCase', 'toUpperCase', 'valueOf',
  // Logging
  'info', 'warn', 'error', 'debug', 'trace', 'log',
  // Assert (testing)
  'assertEquals', 'assertTrue', 'assertFalse', 'assertNull', 'assertNotNull',
  'assertThrows', 'fail', 'assertThat',
]);

/**
 * Extract method calls from Java AST.
 * Returns CallReference[] for CALLS edges.
 */
export function extractCalls(root: SyntaxNode, filePath: string): CallReference[] {
  const calls: CallReference[] = [];

  // Get all methods in the file for local method lookup
  const functions = extractFunctions(root, filePath);
  const localFunctionNames = new Set(functions.map((f) => f.name));

  // Find all method definitions and extract calls from their bodies
  const methodNodes = findNodesOfType(root, ['method_declaration', 'constructor_declaration']);

  for (const methodNode of methodNodes) {
    const callerNameNode = methodNode.childForFieldName('name');
    if (!callerNameNode) continue;
    const callerName = callerNameNode.text;

    // Find the method body
    const bodyNode = methodNode.childForFieldName('body');
    if (!bodyNode) continue;

    // Find all method_invocation nodes in the body
    const invocationNodes = findNodesOfType(bodyNode, ['method_invocation']);

    for (const invocation of invocationNodes) {
      const nameNode = invocation.childForFieldName('name');
      if (!nameNode) continue;

      const calleeName = nameNode.text;

      if (JAVA_BUILTINS.has(calleeName)) continue;

      // Only create edges for local method calls
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
 * Extract all entities from a Java file in a single pass.
 */
export function extractAllEntities(root: SyntaxNode, filePath: string): ExtractedEntities {
  return {
    functions: extractFunctions(root, filePath),
    classes: extractClasses(root, filePath),
    interfaces: extractInterfaces(root, filePath),
    variables: extractVariables(root, filePath),
    imports: extractImports(root, filePath),
    types: extractTypes(root, filePath),
    components: [], // Not applicable for Java
  };
}

// ============================================================================
// Import Resolution (Placeholder)
// ============================================================================

/**
 * Resolve a Java import to a file path.
 * Java import resolution requires understanding the project structure
 * (source roots, classpath, modules). This is a placeholder.
 */
export function resolveJavaImport(
  _importPath: string,
  _importingFilePath: string,
  _projectRoot: string,
): string | undefined {
  // TODO: Implement import-to-file resolution
  // Would require parsing build.gradle / pom.xml and understanding source roots
  return undefined;
}

// ============================================================================
// Plugin Export
// ============================================================================

export const javaPlugin = {
  id: 'java',
  displayName: 'Java',
  extensions: ['.java'],
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
