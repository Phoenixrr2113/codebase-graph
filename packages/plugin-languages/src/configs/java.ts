/**
 * Java language configuration
 *
 * Extracts classes, interfaces, enums, methods, fields, and imports
 * from Java source files using tree-sitter-java.
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';
import type {
  FunctionEntity,
  ClassEntity,
  InterfaceEntity,
  VariableEntity,
  ImportEntity,
  TypeEntity,
  SyntaxNode,
} from '@codegraph/types';
import { findNodesOfType, generateEntityId, calculateComplexity } from '@codegraph/plugin-common';
import {
  functionDisambiguator,
  identityForNode,
  normalizedFunctionSignature,
} from './symbolIdentity';

// ============================================================================
// Helpers
// ============================================================================

function extractModifiers(node: SyntaxNode): string[] {
  const modifiers: string[] = [];
  for (const child of node.children) {
    if (child.type === 'modifiers') {
      for (const mod of child.children) {
        if (mod.type !== 'marker_annotation' && mod.type !== 'annotation') {
          modifiers.push(mod.text);
        }
      }
    }
  }
  return modifiers;
}

function isExportedFromModifiers(mods: string[]): boolean {
  return mods.includes('public') || mods.includes('protected');
}

function extractJavadoc(node: SyntaxNode): string | undefined {
  let current = node.previousSibling;
  while (current) {
    if (current.type === 'block_comment' || current.type === 'comment') {
      const text = current.text;
      if (text.startsWith('/**')) {
        return text
          .slice(3, -2)
          .split('\n')
          .map((line) => line.replace(/^\s*\*\s?/, '').trim())
          .filter((line) => line.length > 0)
          .join('\n');
      }
    }
    if (current.type === 'line_comment') { current = current.previousSibling; continue; }
    break;
  }
  return undefined;
}

/** Unwrap generic_type → type_identifier */
function unwrapTypeName(node: SyntaxNode): string {
  if (node.type === 'generic_type') {
    return node.children.find((c: SyntaxNode) => c.type === 'type_identifier')?.text || node.text;
  }
  return node.text;
}

const TYPE_NODE_TYPES = ['type_identifier', 'generic_type', 'scoped_type_identifier'];

// ============================================================================
// Override Extractors
// ============================================================================

function extractClasses(root: SyntaxNode, filePath: string): ClassEntity[] {
  const classes: ClassEntity[] = [];
  for (const node of findNodesOfType(root, ['class_declaration', 'record_declaration'])) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;
    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const modifiers = extractModifiers(node);

    let extendsName: string | undefined;
    const superclassNode = node.childForFieldName('superclass');
    if (superclassNode) {
      const typeNode = superclassNode.children.find((c: SyntaxNode) => TYPE_NODE_TYPES.includes(c.type));
      if (typeNode) extendsName = unwrapTypeName(typeNode);
    }

    const implementsList: string[] = [];
    const interfacesNode = node.childForFieldName('interfaces');
    if (interfacesNode) {
      const typeList = interfacesNode.children.find((c: SyntaxNode) => c.type === 'type_list');
      if (typeList) {
        for (const child of typeList.children) {
          if (TYPE_NODE_TYPES.includes(child.type)) implementsList.push(unwrapTypeName(child));
        }
      }
    }

    const entity: ClassEntity = {
      ...identityForNode({ node, filePath, label: 'Class', declaredName: name }),
      name, filePath, startLine, endLine: node.endPosition.row + 1,
      isExported: isExportedFromModifiers(modifiers),
      isAbstract: modifiers.includes('abstract'),
    };
    if (extendsName) entity.extends = extendsName;
    if (implementsList.length > 0) entity.implements = implementsList;
    const doc = extractJavadoc(node);
    if (doc) entity.docstring = doc;
    classes.push(entity);
  }
  return classes;
}

function extractInterfaces(root: SyntaxNode, filePath: string): InterfaceEntity[] {
  const interfaces: InterfaceEntity[] = [];
  for (const node of findNodesOfType(root, ['interface_declaration'])) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;
    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const modifiers = extractModifiers(node);

    const extendsList: string[] = [];
    const extendsNode = node.children.find((c: SyntaxNode) => c.type === 'extends_interfaces');
    if (extendsNode) {
      const typeList = extendsNode.children.find((c: SyntaxNode) => c.type === 'type_list');
      if (typeList) {
        for (const child of typeList.children) {
          if (TYPE_NODE_TYPES.includes(child.type)) extendsList.push(unwrapTypeName(child));
        }
      }
    }

    const entity: InterfaceEntity = {
      ...identityForNode({ node, filePath, label: 'Interface', declaredName: name }),
      name, filePath, startLine, endLine: node.endPosition.row + 1,
      isExported: isExportedFromModifiers(modifiers),
    };
    if (extendsList.length > 0) entity.extends = extendsList;
    const doc = extractJavadoc(node);
    if (doc) entity.docstring = doc;
    interfaces.push(entity);
  }
  return interfaces;
}

function extractFunctions(root: SyntaxNode, filePath: string): FunctionEntity[] {
  const functions: FunctionEntity[] = [];
  const functionNodes = findNodesOfType(root, ['method_declaration', 'constructor_declaration']);
  for (const node of functionNodes) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;
    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const modifiers = extractModifiers(node);

    // Parameters
    const params = extractJavaParams(node);
    const returnType = extractJavaReturnType(node);
    const disambiguator = functionDisambiguator({
      node,
      nodes: functionNodes,
      name,
      signatureFor: (candidate) => normalizedFunctionSignature(
        extractJavaParams(candidate),
        extractJavaReturnType(candidate),
      ),
    });

    const entity: FunctionEntity = {
      ...identityForNode({
        node,
        filePath,
        label: 'Function',
        declaredName: name,
        disambiguator,
      }),
      name, filePath, startLine, endLine: node.endPosition.row + 1,
      isExported: isExportedFromModifiers(modifiers),
      isAsync: false, isArrow: false, params,
    };
    if (returnType) entity.returnType = returnType;
    const doc = extractJavadoc(node);
    if (doc) entity.docstring = doc;
    const metrics = calculateComplexity(node);
    entity.complexity = metrics.cyclomatic;
    entity.cognitiveComplexity = metrics.cognitive;
    entity.nestingDepth = metrics.nestingDepth;
    functions.push(entity);
  }
  return functions;
}

function extractJavaParams(node: SyntaxNode): Array<{ name: string; type?: string; optional?: boolean }> {
  const params: Array<{ name: string; type?: string; optional?: boolean }> = [];
  const paramList = node.childForFieldName('parameters');
  if (!paramList) return params;
  for (const child of paramList.children) {
    if (child.type !== 'formal_parameter' && child.type !== 'spread_parameter') continue;
    const name = child.childForFieldName('name');
    if (name) params.push({
      name: name.text,
      type: child.childForFieldName('type')?.text,
      optional: false,
    });
  }
  return params;
}

function extractJavaReturnType(node: SyntaxNode): string | undefined {
  return node.type === 'method_declaration'
    ? node.childForFieldName('type')?.text
    : undefined;
}

function extractVariables(root: SyntaxNode, filePath: string): VariableEntity[] {
  const variables: VariableEntity[] = [];
  for (const node of findNodesOfType(root, ['field_declaration'])) {
    const modifiers = extractModifiers(node);
    const isExported = isExportedFromModifiers(modifiers);
    const isFinal = modifiers.includes('final');
    const typeNode = node.childForFieldName('type');
    for (const declarator of node.children.filter((c: SyntaxNode) => c.type === 'variable_declarator')) {
      const nameNode = declarator.childForFieldName('name');
      if (!nameNode) continue;
      const line = node.startPosition.row + 1;
      variables.push({
        ...identityForNode({
          node: declarator,
          filePath,
          label: 'Variable',
          declaredName: nameNode.text,
          includeBlockScopes: true,
        }),
        name: nameNode.text, filePath, line,
        kind: isFinal ? 'const' : 'let',
        isExported, type: typeNode?.text,
      });
    }
  }
  return variables;
}

function extractImports(root: SyntaxNode, filePath: string): ImportEntity[] {
  const imports: ImportEntity[] = [];
  for (const node of findNodesOfType(root, ['import_declaration'])) {
    const line = node.startPosition.row + 1;
    const isWildcard = node.text.includes('.*');

    let source = '';
    for (const child of node.children) {
      if (child.type === 'scoped_identifier' || child.type === 'identifier') { source = child.text; break; }
    }
    if (!source) continue;

    const specifiers: { name: string; alias?: string }[] = [];
    let importSource = source;
    if (!isWildcard) {
      const lastDot = source.lastIndexOf('.');
      if (lastDot >= 0) {
        importSource = source.slice(0, lastDot);
        specifiers.push({ name: source.slice(lastDot + 1) });
      } else {
        specifiers.push({ name: source });
      }
    }

    imports.push({
      id: generateEntityId(filePath, 'import', source, line),
      filePath, source: importSource,
      isDefault: false, isNamespace: isWildcard, specifiers,
    });
  }
  return imports;
}

function extractTypes(root: SyntaxNode, filePath: string): TypeEntity[] {
  const types: TypeEntity[] = [];
  for (const node of findNodesOfType(root, ['enum_declaration'])) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;
    const startLine = node.startPosition.row + 1;
    const modifiers = extractModifiers(node);
    const entity: TypeEntity = {
      ...identityForNode({ node, filePath, label: 'Type', declaredName: nameNode.text }),
      name: nameNode.text, filePath, startLine, endLine: node.endPosition.row + 1,
      isExported: isExportedFromModifiers(modifiers), kind: 'enum',
    };
    const doc = extractJavadoc(node);
    if (doc) entity.docstring = doc;
    types.push(entity);
  }
  for (const node of findNodesOfType(root, ['annotation_type_declaration'])) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;
    const startLine = node.startPosition.row + 1;
    const modifiers = extractModifiers(node);
    types.push({
      ...identityForNode({ node, filePath, label: 'Type', declaredName: nameNode.text }),
      name: nameNode.text, filePath, startLine, endLine: node.endPosition.row + 1,
      isExported: isExportedFromModifiers(modifiers), kind: 'type',
    });
  }
  return types;
}

// ============================================================================
// Builtins
// ============================================================================

const JAVA_BUILTINS = new Set([
  'toString', 'equals', 'hashCode', 'getClass', 'clone', 'notify', 'notifyAll', 'wait',
  'println', 'print', 'printf', 'format',
  'add', 'remove', 'get', 'set', 'size', 'isEmpty', 'contains', 'containsKey',
  'put', 'clear', 'iterator', 'stream', 'of', 'asList',
  'map', 'filter', 'reduce', 'collect', 'forEach', 'flatMap', 'sorted',
  'toList', 'toSet', 'toMap', 'count', 'findFirst', 'findAny',
  'orElse', 'orElseGet', 'orElseThrow',
  'length', 'charAt', 'substring', 'trim', 'split', 'replace', 'matches',
  'startsWith', 'endsWith', 'toLowerCase', 'toUpperCase', 'valueOf',
  'info', 'warn', 'error', 'debug', 'trace', 'log',
  'assertEquals', 'assertTrue', 'assertFalse', 'assertNull', 'assertNotNull',
  'assertThrows', 'fail', 'assertThat',
]);

// ============================================================================
// Config Export
// ============================================================================

export const javaConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'java',
  displayName: 'Java',
  extensions: ['.java'],

  nodeTypes: {
    functions: ['method_declaration', 'constructor_declaration'],
    classes: ['class_declaration', 'record_declaration'],
    interfaces: ['interface_declaration'],
    variables: ['field_declaration'],
    imports: ['import_declaration'],
    types: ['enum_declaration', 'annotation_type_declaration'],
    calls: ['method_invocation'],
  },

  fields: {
    callee: 'name',
  },

  visibilityConfig: {
    strategy: 'modifier',
    modifierNodeTypes: ['modifiers'],
    exportedModifiers: ['public', 'protected'],
  },

  docstringConfig: {
    strategy: 'preceding-comment',
    commentNodeTypes: ['block_comment', 'line_comment'],
    stripPrefixes: ['/**', '*/', '*', '//'],
  },

  paramConfig: {
    identifierNodeTypes: ['identifier'],
    typedParamNodeTypes: ['formal_parameter'],
    defaultParamNodeTypes: [],
    filterNames: ['this'],
  },

  importConfig: {
    moduleNodeTypes: ['identifier', 'scoped_identifier'],
    stripQuotes: false,
  },

  overrides: {
    extractFunctions,
    extractClasses,
    extractInterfaces,
    extractVariables,
    extractImports,
    extractTypes,
    builtinFunctions: JAVA_BUILTINS,
  },
};
