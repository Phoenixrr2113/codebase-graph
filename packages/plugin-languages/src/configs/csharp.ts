/**
 * C# language configuration
 *
 * Extracts classes, structs, records, interfaces, methods, fields, properties,
 * using directives, enums, delegates, and call references from C# source files.
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';
import type {
  FunctionEntity,
  ClassEntity,
  InterfaceEntity,
  VariableEntity,
  ImportEntity,
  TypeEntity,
  CallReference,
  SyntaxNode,
} from '@codegraph/types';
import { findNodesOfType, generateEntityId, calculateComplexity } from '@codegraph/plugin-common';

// ============================================================================
// Helpers
// ============================================================================

function extractModifiers(node: SyntaxNode): string[] {
  const modifiers: string[] = [];
  for (const child of node.children) {
    if (child.type === 'modifier') modifiers.push(child.text);
  }
  return modifiers;
}

function isExportedFromModifiers(mods: string[]): boolean {
  return mods.includes('public') || mods.includes('protected') || mods.includes('internal');
}

function extractXmlDocComment(node: SyntaxNode): string | undefined {
  let current = node.previousSibling;
  const lines: string[] = [];
  while (current && current.type === 'comment') {
    if (current.text.startsWith('///')) lines.unshift(current.text.slice(3).trim());
    current = current.previousSibling;
  }
  return lines.length > 0 ? lines.join('\n') : undefined;
}

// ============================================================================
// Override Extractors
// ============================================================================

function extractClasses(root: SyntaxNode, filePath: string): ClassEntity[] {
  const classes: ClassEntity[] = [];
  for (const node of findNodesOfType(root, ['class_declaration', 'struct_declaration', 'record_declaration'])) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;
    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const modifiers = extractModifiers(node);

    let extendsName: string | undefined;
    const implementsList: string[] = [];
    const baseListNode = node.children.find((c: SyntaxNode) => c.type === 'base_list');
    if (baseListNode) {
      let isFirst = true;
      for (const child of baseListNode.children) {
        if (child.type === ',' || child.type === ':') continue;
        if (child.type === 'identifier' || child.type === 'generic_name' ||
          child.type === 'qualified_name' || child.type === 'simple_base_type') {
          const typeName = child.type === 'simple_base_type'
            ? child.firstChild?.text || child.text : child.text;
          if (typeName) {
            const isInterface = typeName.startsWith('I') && typeName.length > 1 &&
              typeName[1] === typeName[1].toUpperCase();
            if (isFirst && !isInterface) { extendsName = typeName; }
            else { implementsList.push(typeName); }
            isFirst = false;
          }
        }
      }
    }

    const entity: ClassEntity = {
      id: generateEntityId(filePath, 'class', name, startLine),
      name, filePath, startLine, endLine: node.endPosition.row + 1,
      isExported: isExportedFromModifiers(modifiers),
      isAbstract: modifiers.includes('abstract'),
    };
    if (extendsName) entity.extends = extendsName;
    if (implementsList.length > 0) entity.implements = implementsList;
    const doc = extractXmlDocComment(node);
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
    const baseListNode = node.children.find((c: SyntaxNode) => c.type === 'base_list');
    if (baseListNode) {
      for (const child of baseListNode.children) {
        if (child.type === ',' || child.type === ':') continue;
        if (child.type === 'identifier' || child.type === 'generic_name' ||
          child.type === 'qualified_name' || child.type === 'simple_base_type') {
          const typeName = child.type === 'simple_base_type'
            ? child.firstChild?.text || child.text : child.text;
          if (typeName) extendsList.push(typeName);
        }
      }
    }

    const entity: InterfaceEntity = {
      id: generateEntityId(filePath, 'interface', name, startLine),
      name, filePath, startLine, endLine: node.endPosition.row + 1,
      isExported: isExportedFromModifiers(modifiers),
    };
    if (extendsList.length > 0) entity.extends = extendsList;
    const doc = extractXmlDocComment(node);
    if (doc) entity.docstring = doc;
    interfaces.push(entity);
  }
  return interfaces;
}

function extractFunctions(root: SyntaxNode, filePath: string): FunctionEntity[] {
  const functions: FunctionEntity[] = [];
  for (const node of findNodesOfType(root, ['method_declaration', 'constructor_declaration'])) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;
    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const modifiers = extractModifiers(node);

    // Parameters
    const params: { name: string; type?: string; optional?: boolean }[] = [];
    const paramList = node.childForFieldName('parameters');
    if (paramList) {
      for (const child of paramList.children) {
        if (child.type === 'parameter') {
          const n = child.childForFieldName('name');
          if (n) params.push({
            name: n.text, type: child.childForFieldName('type')?.text,
            optional: child.children.some((c: SyntaxNode) => c.type === '='),
          });
        }
      }
    }

    // Return type (method_declaration only)
    let returnType: string | undefined;
    if (node.type === 'method_declaration') {
      const nameIdx = node.children.findIndex((c: SyntaxNode) => node.childForFieldName('name') === c);
      for (const child of node.children) {
        if (child.type === 'predefined_type' || child.type === 'identifier' ||
          child.type === 'generic_name' || child.type === 'qualified_name' ||
          child.type === 'nullable_type' || child.type === 'array_type') {
          const idx = node.children.findIndex((c: SyntaxNode) => c === child);
          if (idx !== nameIdx) { returnType = child.text; break; }
        }
      }
    }

    const entity: FunctionEntity = {
      id: generateEntityId(filePath, 'function', name, startLine),
      name, filePath, startLine, endLine: node.endPosition.row + 1,
      isExported: isExportedFromModifiers(modifiers),
      isAsync: modifiers.includes('async'), isArrow: false, params,
    };
    if (returnType) entity.returnType = returnType;
    const doc = extractXmlDocComment(node);
    if (doc) entity.docstring = doc;
    const metrics = calculateComplexity(node);
    entity.complexity = metrics.cyclomatic;
    entity.cognitiveComplexity = metrics.cognitive;
    entity.nestingDepth = metrics.nestingDepth;
    functions.push(entity);
  }
  return functions;
}

function extractVariables(root: SyntaxNode, filePath: string): VariableEntity[] {
  const variables: VariableEntity[] = [];

  // Fields
  for (const node of findNodesOfType(root, ['field_declaration'])) {
    const modifiers = extractModifiers(node);
    const isExported = isExportedFromModifiers(modifiers);
    const isConst = modifiers.includes('const') || modifiers.includes('readonly');
    const varDeclNode = node.children.find((c: SyntaxNode) => c.type === 'variable_declaration');
    if (!varDeclNode) continue;
    const typeNode = varDeclNode.childForFieldName('type');
    for (const declarator of varDeclNode.children.filter((c: SyntaxNode) => c.type === 'variable_declarator')) {
      const nameNode = declarator.childForFieldName('name');
      if (!nameNode) continue;
      const line = node.startPosition.row + 1;
      variables.push({
        id: generateEntityId(filePath, 'variable', nameNode.text, line),
        name: nameNode.text, filePath, line,
        kind: isConst ? 'const' : 'let', isExported, type: typeNode?.text,
      });
    }
  }

  // Properties
  for (const node of findNodesOfType(root, ['property_declaration'])) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;
    const modifiers = extractModifiers(node);
    const line = node.startPosition.row + 1;
    variables.push({
      id: generateEntityId(filePath, 'variable', nameNode.text, line),
      name: nameNode.text, filePath, line, kind: 'let',
      isExported: isExportedFromModifiers(modifiers),
      type: node.childForFieldName('type')?.text,
    });
  }

  return variables;
}

function extractImports(root: SyntaxNode, filePath: string): ImportEntity[] {
  const imports: ImportEntity[] = [];
  for (const node of findNodesOfType(root, ['using_directive'])) {
    const line = node.startPosition.row + 1;
    const isStatic = node.children.some((c: SyntaxNode) => c.type === 'static');
    const hasEquals = node.children.some((c: SyntaxNode) => c.type === '=');
    let alias: string | undefined;
    let nameNode: SyntaxNode | undefined;

    if (hasEquals && !isStatic) {
      alias = node.children.find((c: SyntaxNode) => c.type === 'identifier')?.text;
      const eqIdx = node.children.findIndex((c: SyntaxNode) => c.type === '=');
      for (let i = eqIdx + 1; i < node.children.length; i++) {
        const child = node.children[i];
        if (child.type === 'identifier' || child.type === 'qualified_name' || child.type === 'alias_qualified_name') {
          nameNode = child; break;
        }
      }
    } else {
      nameNode = node.children.find((c: SyntaxNode) =>
        c.type === 'identifier' || c.type === 'qualified_name' || c.type === 'alias_qualified_name');
    }

    if (!nameNode) continue;
    const source = nameNode.text;
    const entity: ImportEntity = {
      id: generateEntityId(filePath, 'import', source, line),
      filePath, source, isDefault: false,
      isNamespace: !alias && !isStatic, specifiers: [],
    };
    if (alias) {
      entity.namespaceAlias = alias;
      entity.specifiers = [{ name: source, alias }];
    }
    imports.push(entity);
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
      id: generateEntityId(filePath, 'type', nameNode.text, startLine),
      name: nameNode.text, filePath, startLine, endLine: node.endPosition.row + 1,
      isExported: isExportedFromModifiers(modifiers), kind: 'enum',
    };
    const doc = extractXmlDocComment(node);
    if (doc) entity.docstring = doc;
    types.push(entity);
  }
  for (const node of findNodesOfType(root, ['delegate_declaration'])) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;
    const startLine = node.startPosition.row + 1;
    const modifiers = extractModifiers(node);
    types.push({
      id: generateEntityId(filePath, 'type', nameNode.text, startLine),
      name: nameNode.text, filePath, startLine, endLine: node.endPosition.row + 1,
      isExported: isExportedFromModifiers(modifiers), kind: 'type',
    });
  }
  return types;
}

function extractCalls(root: SyntaxNode, filePath: string): CallReference[] {
  const calls: CallReference[] = [];
  const functions = extractFunctions(root, filePath);
  const localNames = new Set(functions.map(f => f.name));
  for (const methodNode of findNodesOfType(root, ['method_declaration', 'constructor_declaration'])) {
    const callerName = methodNode.childForFieldName('name')?.text;
    if (!callerName) continue;
    const bodyNode = methodNode.childForFieldName('body');
    if (!bodyNode) continue;
    for (const invocation of findNodesOfType(bodyNode, ['invocation_expression'])) {
      const funcExpr = invocation.firstChild;
      if (!funcExpr) continue;
      let calleeName: string | undefined;
      if (funcExpr.type === 'identifier') calleeName = funcExpr.text;
      else if (funcExpr.type === 'member_access_expression') calleeName = funcExpr.childForFieldName('name')?.text;
      else if (funcExpr.type === 'generic_name') calleeName = funcExpr.children.find((c: SyntaxNode) => c.type === 'identifier')?.text;
      if (!calleeName || CSHARP_BUILTINS.has(calleeName)) continue;
      if (localNames.has(calleeName)) {
        calls.push({ callerName, calleeName, line: invocation.startPosition.row + 1, filePath });
      }
    }
  }
  return calls;
}

// ============================================================================
// Builtins
// ============================================================================

const CSHARP_BUILTINS = new Set([
  'Console', 'WriteLine', 'ReadLine', 'Write', 'Read',
  'ToString', 'Equals', 'GetHashCode', 'GetType',
  'Add', 'Remove', 'Clear', 'Contains', 'Count',
  'ToList', 'ToArray', 'ToDictionary', 'First', 'Last',
  'Where', 'Select', 'OrderBy', 'GroupBy', 'Any', 'All',
  'FirstOrDefault', 'LastOrDefault', 'SingleOrDefault',
  'ConfigureAwait', 'Wait', 'Result',
  'Assert', 'AreEqual', 'IsTrue', 'IsFalse', 'IsNull', 'IsNotNull',
  'ThrowsException', 'Fail',
  'LogInformation', 'LogWarning', 'LogError', 'LogDebug', 'Log',
]);

// ============================================================================
// Config Export
// ============================================================================

export const csharpConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'csharp',
  displayName: 'C#',
  extensions: ['.cs'],

  nodeTypes: {
    functions: ['method_declaration', 'constructor_declaration'],
    classes: ['class_declaration', 'struct_declaration', 'record_declaration'],
    interfaces: ['interface_declaration'],
    variables: ['field_declaration', 'property_declaration'],
    imports: ['using_directive'],
    types: ['enum_declaration', 'delegate_declaration'],
    calls: ['invocation_expression'],
  },

  overrides: {
    extractFunctions,
    extractClasses,
    extractInterfaces,
    extractVariables,
    extractImports,
    extractTypes,
    extractCalls,
    builtinFunctions: CSHARP_BUILTINS,
  },
};
