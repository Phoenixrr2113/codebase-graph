/**
 * PHP language configuration
 *
 * Extracts classes, interfaces, traits, functions, methods, properties,
 * constants, imports (use), enums, inheritance, and call references.
 *
 * Mapping: trait → InterfaceEntity, trait use → implements InheritanceReference
 */
import type { GenericLanguageConfig } from '@codegraph/plugin-generic';
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
import { identityForNode } from './symbolIdentity';

// ============================================================================
// Helpers
// ============================================================================

function extractDocComment(node: SyntaxNode): string | undefined {
  const prev = node.previousSibling;
  if (!prev || prev.type !== 'comment') return undefined;
  const text = prev.text;
  if (!text.startsWith('/**')) return undefined;
  const cleaned = text
    .slice(3, -2)
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').trim())
    .filter((line) => line.length > 0)
    .join('\n');
  return cleaned || undefined;
}

function getVisibility(node: SyntaxNode): string | undefined {
  return node.children.find((c: SyntaxNode) => c.type === 'visibility_modifier')?.text;
}

const PHP_TYPE_NODES = ['primitive_type', 'named_type', 'optional_type', 'union_type', 'intersection_type', 'nullable_type'];

function isInsideClassLikeBody(node: SyntaxNode): boolean {
  let parent = node.parent;
  while (parent) {
    if (parent.type === 'declaration_list' || parent.type === 'enum_declaration_list') return true;
    parent = parent.parent;
  }
  return false;
}

function phpOwnerScopeKey(node: SyntaxNode): string | undefined {
  let current = node.parent;
  while (current) {
    const name = current.childForFieldName('name')?.text;
    if (name) {
      if (current.type === 'class_declaration') return `Class:${name}`;
      if (current.type === 'trait_declaration' || current.type === 'interface_declaration') {
        return `Interface:${name}`;
      }
      if (current.type === 'enum_declaration') return `Type:${name}`;
    }
    current = current.parent;
  }
  return undefined;
}

function extractPhpParams(funcNode: SyntaxNode): { name: string; type?: string; optional?: boolean }[] {
  const params: { name: string; type?: string; optional?: boolean }[] = [];
  const paramList = funcNode.children.find((c: SyntaxNode) => c.type === 'formal_parameters');
  if (!paramList) return params;
  for (const child of paramList.children) {
    if (child.type === 'simple_parameter') {
      const varNode = child.children.find((c: SyntaxNode) => c.type === 'variable_name');
      if (!varNode) continue;
      const p: { name: string; type?: string; optional?: boolean } = { name: varNode.text };
      const typeNode = child.children.find((c: SyntaxNode) => PHP_TYPE_NODES.includes(c.type));
      if (typeNode) p.type = typeNode.text;
      if (child.children.some((c: SyntaxNode) => c.type === '=')) p.optional = true;
      params.push(p);
    } else if (child.type === 'variadic_parameter') {
      const varNode = child.children.find((c: SyntaxNode) => c.type === 'variable_name');
      if (varNode) params.push({ name: `...${varNode.text}` });
    }
  }
  return params;
}

function extractPhpReturnType(funcNode: SyntaxNode): string | undefined {
  for (let i = 0; i < funcNode.children.length; i++) {
    const child = funcNode.children[i];
    if (child && child.type === ':') {
      const next = funcNode.children[i + 1];
      if (next && next.type !== 'compound_statement' && next.type !== ';') return next.text;
    }
  }
  return undefined;
}

// ============================================================================
// Override Extractors
// ============================================================================

function extractClasses(root: SyntaxNode, filePath: string): ClassEntity[] {
  const classes: ClassEntity[] = [];
  for (const node of findNodesOfType(root, ['class_declaration'])) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;
    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const entity: ClassEntity = {
      ...identityForNode({ node, filePath, label: 'Class', declaredName: name }),
      name, filePath, startLine, endLine: node.endPosition.row + 1,
      isExported: true,
      isAbstract: node.children.some((c: SyntaxNode) => c.type === 'abstract_modifier'),
    };
    const doc = extractDocComment(node);
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
    const extendsList: string[] = [];
    const baseClause = node.children.find((c: SyntaxNode) => c.type === 'base_clause');
    if (baseClause) {
      for (const child of baseClause.children) {
        if (child.type === 'name') extendsList.push(child.text);
      }
    }
    const entity: InterfaceEntity = {
      ...identityForNode({ node, filePath, label: 'Interface', declaredName: name }),
      name, filePath, startLine, endLine: node.endPosition.row + 1, isExported: true,
    };
    if (extendsList.length > 0) entity.extends = extendsList;
    const doc = extractDocComment(node);
    if (doc) entity.docstring = doc;
    interfaces.push(entity);
  }
  // Traits → InterfaceEntity
  for (const node of findNodesOfType(root, ['trait_declaration'])) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;
    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const entity: InterfaceEntity = {
      ...identityForNode({ node, filePath, label: 'Interface', declaredName: name }),
      name, filePath, startLine, endLine: node.endPosition.row + 1, isExported: true,
    };
    const doc = extractDocComment(node);
    if (doc) entity.docstring = doc;
    interfaces.push(entity);
  }
  return interfaces;
}

function extractFunctions(root: SyntaxNode, filePath: string): FunctionEntity[] {
  const functions: FunctionEntity[] = [];

  // Top-level functions
  for (const node of findNodesOfType(root, ['function_definition'])) {
    if (isInsideClassLikeBody(node)) continue;
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;
    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const entity: FunctionEntity = {
      ...identityForNode({ node, filePath, label: 'Function', declaredName: name }),
      name, filePath, startLine, endLine: node.endPosition.row + 1,
      isExported: true, isAsync: false, isArrow: false,
      params: extractPhpParams(node),
    };
    const rt = extractPhpReturnType(node);
    if (rt) entity.returnType = rt;
    const doc = extractDocComment(node);
    if (doc) entity.docstring = doc;
    const m = calculateComplexity(node);
    entity.complexity = m.cyclomatic;
    entity.cognitiveComplexity = m.cognitive;
    entity.nestingDepth = m.nestingDepth;
    functions.push(entity);
  }

  // Methods inside classes, traits, enums
  for (const classNode of findNodesOfType(root, ['class_declaration', 'trait_declaration', 'enum_declaration'])) {
    const className = classNode.childForFieldName('name')?.text;
    const bodyNode = classNode.children.find(
      (c: SyntaxNode) => c.type === 'declaration_list' || c.type === 'enum_declaration_list');
    if (!bodyNode) continue;
    for (const child of bodyNode.children) {
      if (child.type !== 'method_declaration') continue;
      const nameNode = child.childForFieldName('name');
      if (!nameNode) continue;
      const name = nameNode.text;
      const startLine = child.startPosition.row + 1;
      const vis = getVisibility(child);
      const ownerLabel = classNode.type === 'class_declaration'
        ? 'Class'
        : classNode.type === 'trait_declaration'
          ? 'Interface'
          : 'Type';
      const entity: FunctionEntity = {
        ...identityForNode({
          node: child,
          filePath,
          label: 'Function',
          declaredName: name,
          scopeKeyOverride: className ? `${ownerLabel}:${className}` : '',
        }),
        name, filePath, startLine, endLine: child.endPosition.row + 1,
        isExported: vis === 'public' || vis === undefined,
        isAsync: false, isArrow: false, params: extractPhpParams(child),
      };
      const rt = extractPhpReturnType(child);
      if (rt) entity.returnType = rt;
      const doc = extractDocComment(child);
      if (doc) entity.docstring = doc;
      const m = calculateComplexity(child);
      entity.complexity = m.cyclomatic;
      entity.cognitiveComplexity = m.cognitive;
      entity.nestingDepth = m.nestingDepth;
      functions.push(entity);
    }
  }

  return functions;
}

function extractVariables(root: SyntaxNode, filePath: string): VariableEntity[] {
  const variables: VariableEntity[] = [];
  for (const node of findNodesOfType(root, ['property_declaration'])) {
    const propElement = node.children.find((c: SyntaxNode) => c.type === 'property_element');
    if (!propElement) continue;
    const varNode = propElement.children.find((c: SyntaxNode) => c.type === 'variable_name');
    if (!varNode) continue;
    const name = varNode.text;
    const line = node.startPosition.row + 1;
    const vis = getVisibility(node);
    const typeNode = node.children.find((c: SyntaxNode) => PHP_TYPE_NODES.includes(c.type));
    const entity: VariableEntity = {
      ...identityForNode({
        node,
        filePath,
        label: 'Variable',
        declaredName: name,
        scopeKeyOverride: phpOwnerScopeKey(node),
      }),
      name, filePath, line, kind: 'let',
      isExported: vis === 'public' || vis === undefined,
    };
    if (typeNode) entity.type = typeNode.text;
    variables.push(entity);
  }
  for (const node of findNodesOfType(root, ['const_declaration'])) {
    const constElement = node.children.find((c: SyntaxNode) => c.type === 'const_element');
    if (!constElement) continue;
    const nameNode = constElement.children.find((c: SyntaxNode) => c.type === 'name');
    if (!nameNode) continue;
    const line = node.startPosition.row + 1;
    variables.push({
      ...identityForNode({
        node,
        filePath,
        label: 'Variable',
        declaredName: nameNode.text,
        scopeKeyOverride: phpOwnerScopeKey(node),
      }),
      name: nameNode.text, filePath, line, kind: 'const', isExported: true,
    });
  }
  return variables;
}

function extractImports(root: SyntaxNode, filePath: string): ImportEntity[] {
  const imports: ImportEntity[] = [];
  const useDecls = root.children.filter((c: SyntaxNode) => c.type === 'namespace_use_declaration');
  for (const decl of useDecls) {
    const nsNameNode = decl.children.find((c: SyntaxNode) => c.type === 'namespace_name');
    const groupNode = decl.children.find((c: SyntaxNode) => c.type === 'namespace_use_group');
    if (nsNameNode && groupNode) {
      const basePath = nsNameNode.text;
      const specifiers: { name: string; alias?: string }[] = [];
      for (const clause of groupNode.children) {
        if (clause.type === 'namespace_use_clause') {
          const cn = clause.children.find((c: SyntaxNode) => c.type === 'name');
          if (cn) specifiers.push({ name: cn.text });
        }
      }
      imports.push({
        id: generateEntityId(filePath, 'import', basePath, decl.startPosition.row + 1),
        filePath, source: basePath, isDefault: false, isNamespace: false, specifiers,
      });
      continue;
    }
    for (const child of decl.children) {
      if (child.type !== 'namespace_use_clause') continue;
      const qualifiedNode = child.children.find((c: SyntaxNode) => c.type === 'qualified_name');
      const hasFunctionPrefix = child.children.some((c: SyntaxNode) => c.type === 'function');
      const hasConstPrefix = child.children.some((c: SyntaxNode) => c.type === 'const');
      if (!qualifiedNode) continue;
      const fullPath = qualifiedNode.text;
      const parts = fullPath.split('\\');
      const lastName = parts[parts.length - 1] || fullPath;
      let alias: string | undefined;
      const asIndex = child.children.findIndex((c: SyntaxNode) => c.type === 'as');
      if (asIndex >= 0) {
        const afterAs = child.children[asIndex + 1];
        if (afterAs && afterAs.type === 'name') alias = afterAs.text;
      }
      let source = fullPath;
      if (hasFunctionPrefix) source = `function ${fullPath}`;
      if (hasConstPrefix) source = `const ${fullPath}`;
      const spec: { name: string; alias?: string } = { name: lastName };
      if (alias) spec.alias = alias;
      imports.push({
        id: generateEntityId(filePath, 'import', fullPath, decl.startPosition.row + 1),
        filePath, source, isDefault: false, isNamespace: false, specifiers: [spec],
      });
    }
  }
  return imports;
}

function extractTypes(root: SyntaxNode, filePath: string): TypeEntity[] {
  const types: TypeEntity[] = [];
  for (const node of findNodesOfType(root, ['enum_declaration'])) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;
    const startLine = node.startPosition.row + 1;
    const entity: TypeEntity = {
      ...identityForNode({ node, filePath, label: 'Type', declaredName: nameNode.text }),
      name: nameNode.text, filePath, startLine, endLine: node.endPosition.row + 1,
      isExported: true, kind: 'enum',
    };
    const doc = extractDocComment(node);
    if (doc) entity.docstring = doc;
    types.push(entity);
  }
  return types;
}

function extractInheritance(root: SyntaxNode, filePath: string): InheritanceReference[] {
  const refs: InheritanceReference[] = [];
  for (const node of findNodesOfType(root, ['class_declaration'])) {
    const className = node.childForFieldName('name')?.text;
    if (!className) continue;
    const baseClause = node.children.find((c: SyntaxNode) => c.type === 'base_clause');
    if (baseClause) {
      for (const child of baseClause.children) {
        if (child.type === 'name') refs.push({ childName: className, parentName: child.text, type: 'extends', filePath });
      }
    }
    const ifClause = node.children.find((c: SyntaxNode) => c.type === 'class_interface_clause');
    if (ifClause) {
      for (const child of ifClause.children) {
        if (child.type === 'name') refs.push({ childName: className, parentName: child.text, type: 'implements', filePath });
      }
    }
    const bodyNode = node.children.find((c: SyntaxNode) => c.type === 'declaration_list');
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === 'use_declaration') {
          for (const traitChild of child.children) {
            if (traitChild.type === 'name') refs.push({ childName: className, parentName: traitChild.text, type: 'implements', filePath });
          }
        }
      }
    }
  }
  for (const node of findNodesOfType(root, ['interface_declaration'])) {
    const ifaceName = node.childForFieldName('name')?.text;
    if (!ifaceName) continue;
    const baseClause = node.children.find((c: SyntaxNode) => c.type === 'base_clause');
    if (baseClause) {
      for (const child of baseClause.children) {
        if (child.type === 'name') refs.push({ childName: ifaceName, parentName: child.text, type: 'extends', filePath });
      }
    }
  }
  for (const node of findNodesOfType(root, ['enum_declaration'])) {
    const enumName = node.childForFieldName('name')?.text;
    if (!enumName) continue;
    const ifClause = node.children.find((c: SyntaxNode) => c.type === 'class_interface_clause');
    if (ifClause) {
      for (const child of ifClause.children) {
        if (child.type === 'name') refs.push({ childName: enumName, parentName: child.text, type: 'implements', filePath });
      }
    }
  }
  return refs;
}

function extractCalls(root: SyntaxNode, filePath: string): CallReference[] {
  const calls: CallReference[] = [];
  const functions = extractFunctions(root, filePath);
  const localNames = new Set(functions.map((f) => f.name));
  for (const funcNode of findNodesOfType(root, ['function_definition', 'method_declaration'])) {
    const callerName = funcNode.childForFieldName('name')?.text;
    if (!callerName) continue;
    const bodyNode = funcNode.children.find((c: SyntaxNode) => c.type === 'compound_statement');
    if (!bodyNode) continue;
    for (const callNode of findNodesOfType(bodyNode, ['function_call_expression', 'member_call_expression', 'scoped_call_expression'])) {
      let calleeName: string | undefined;
      if (callNode.type === 'function_call_expression') {
        calleeName = callNode.children.find((c: SyntaxNode) => c.type === 'name')?.text;
      } else {
        calleeName = callNode.childForFieldName('name')?.text;
      }
      if (!calleeName || PHP_BUILTINS.has(calleeName)) continue;
      if (localNames.has(calleeName)) {
        calls.push({ callerName, calleeName, line: callNode.startPosition.row + 1, filePath });
      }
    }
  }
  return calls;
}

// ============================================================================
// Builtins
// ============================================================================

const PHP_BUILTINS = new Set([
  'strlen', 'strpos', 'substr', 'str_replace', 'strtolower', 'strtoupper',
  'trim', 'ltrim', 'rtrim', 'explode', 'implode', 'sprintf', 'printf',
  'str_contains', 'str_starts_with', 'str_ends_with', 'str_pad',
  'array_map', 'array_filter', 'array_reduce', 'array_merge', 'array_keys',
  'array_values', 'array_push', 'array_pop', 'array_shift', 'array_unshift',
  'array_slice', 'array_splice', 'array_unique', 'array_reverse',
  'array_search', 'array_key_exists', 'in_array', 'count', 'sort', 'usort',
  'array_combine', 'array_chunk', 'array_flip', 'array_diff', 'array_intersect',
  'isset', 'unset', 'empty', 'is_array', 'is_string', 'is_int', 'is_null',
  'is_bool', 'is_object', 'is_numeric', 'is_callable', 'gettype', 'settype',
  'intval', 'floatval', 'strval', 'boolval',
  'echo', 'print', 'print_r', 'var_dump', 'var_export',
  'json_encode', 'json_decode',
  'file_get_contents', 'file_put_contents', 'fopen', 'fclose', 'fread', 'fwrite',
  'abs', 'ceil', 'floor', 'round', 'max', 'min', 'rand', 'mt_rand',
  'class_exists', 'method_exists', 'property_exists', 'get_class', 'instanceof', 'is_a',
  'date', 'time', 'strtotime', 'microtime', 'sleep', 'usleep',
  'preg_match', 'preg_replace', 'preg_match_all',
  'header', 'setcookie', 'session_start',
  'compact', 'extract', 'list', 'range', 'throw', 'die', 'exit',
]);

// ============================================================================
// Config Export
// ============================================================================

/**
 * Note: tree-sitter-php exports { php, php_only }. The grammar must be
 * accessed as `(grammar as { php: unknown }).php` in the grammar loader.
 */
export const phpConfig: Omit<GenericLanguageConfig, 'grammar'> = {
  id: 'php',
  displayName: 'PHP',
  extensions: ['.php'],

  nodeTypes: {
    functions: ['function_definition', 'method_declaration'],
    classes: ['class_declaration'],
    interfaces: ['interface_declaration', 'trait_declaration'],
    variables: ['property_declaration', 'const_declaration'],
    imports: ['namespace_use_declaration'],
    types: ['enum_declaration'],
    calls: ['function_call_expression', 'member_call_expression', 'scoped_call_expression'],
  },

  fields: {
    name: 'name',
    parameters: 'parameters',
    body: 'body',
  },

  visibilityConfig: {
    strategy: 'modifier',
    modifierNodeTypes: ['visibility_modifier'],
    exportedModifiers: ['public'],
  },

  docstringConfig: {
    strategy: 'preceding-comment',
    commentNodeTypes: ['comment'],
    stripPrefixes: ['/**', '*/', '*'],
  },

  paramConfig: {
    identifierNodeTypes: ['variable_name'],
    typedParamNodeTypes: ['simple_parameter'],
    defaultParamNodeTypes: ['simple_parameter'],
    filterNames: [],
  },

  importConfig: {
    moduleNodeTypes: ['qualified_name', 'namespace_name'],
    stripQuotes: false,
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
    builtinFunctions: PHP_BUILTINS,
  },
};
