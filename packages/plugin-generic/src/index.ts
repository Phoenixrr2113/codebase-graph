/**
 * @codegraph/plugin-generic — Config-Driven Language Plugin Factory (FEAT.8)
 *
 * Provides createLanguagePlugin(config) which takes a declarative language
 * config and returns a fully-formed LanguagePlugin. Reduces per-language
 * plugin code from ~500-1000 lines to ~100-150 lines of config.
 *
 * The factory handles:
 *   - Grammar helpers setup
 *   - Standard extraction patterns (find nodes → extract fields → create entity)
 *   - extractAllEntities composition
 *   - Plugin export structure
 *
 * Each language provides:
 *   - Node type mappings (which AST types to search for)
 *   - Field name mappings (which child fields hold name, params, etc.)
 *   - Configurable strategies for imports, params, docstrings, visibility
 *   - Override callbacks for language-specific behavior
 */

import type {
  SyntaxNode,
  FunctionEntity,
  ClassEntity,
  InterfaceEntity,
  VariableEntity,
  ImportEntity,
  TypeEntity,
  CallReference,
  CallExtractionContext,
  InheritanceReference,
  ExtractedEntities,
  LanguagePlugin,
} from '@codegraph/types';
import {
  buildLexicalScopeKey,
  buildSymbolIdentity,
  createGrammarHelpers,
  findNodesOfType,
  generateEntityId,
  occurrenceDisambiguator,
  signatureDisambiguator,
  type SourceSymbolLabel,
} from '@codegraph/plugin-common';

// ============================================================================
// Config Types
// ============================================================================

/** Parameter entity for function extraction */
export interface ParamInfo {
  name: string;
  type?: string;
  optional?: boolean;
}

// --- Phase 2 Config Types ---

/**
 * Configuration for structured import extraction (Phase 2a).
 * Enables the generic extractor to parse imports beyond just node.text.
 */
export interface ImportConfig {
  /**
   * Field name on the import node that holds the module/source path.
   * e.g., 'module_name' (Python), 'path' (Go), 'source' (JS/TS)
   */
  moduleField?: string;

  /**
   * Alternative: child node types that represent the module source.
   * Used when the module isn't a named field but a specific child type.
   * e.g., ['string', 'string_literal', 'interpreted_string_literal']
   */
  moduleNodeTypes?: string[];

  /**
   * Node types within the import that represent individual specifiers.
   * e.g., ['import_specifier', 'dotted_name', 'identifier']
   */
  specifierNodeTypes?: string[];

  /**
   * Field name for specifier alias (e.g., 'alias' for `import X as Y`).
   */
  aliasField?: string;

  /**
   * Check if an import is a namespace/wildcard import.
   * e.g., `import * as X` or `import X.*`
   */
  isNamespaceImport?(node: SyntaxNode): boolean;

  /**
   * Strip wrapping quotes from module source strings.
   * Default: true
   */
  stripQuotes?: boolean;
}

/**
 * Configuration for parameter extraction (Phase 2b).
 * Enables extracting typed parameters, defaults, and filtering self/this.
 */
export interface ParamConfig {
  /**
   * Node types that represent typed parameters (with type annotations).
   * e.g., ['typed_parameter', 'typed_default_parameter'] (Python)
   * e.g., ['formal_parameter'] (Java)
   */
  typedParamNodeTypes?: string[];

  /**
   * Field name for the type annotation on a typed parameter.
   * e.g., 'type' (most languages)
   */
  typeField?: string;

  /**
   * Node types for parameters with default values.
   * e.g., ['default_parameter'] (Python), ['optional_parameter'] (C#)
   */
  defaultParamNodeTypes?: string[];

  /**
   * Parameter names to filter out (e.g., 'self', 'cls', 'this').
   */
  filterNames?: string[];

  /**
   * Additional node types to accept as parameter identifiers.
   * Default includes only 'identifier'; add 'simple_identifier', etc.
   */
  identifierNodeTypes?: string[];
}

/**
 * Configuration for docstring/comment extraction (Phase 2c).
 */
export interface DocstringConfig {
  /**
   * Strategy for finding documentation:
   * - 'preceding-comment': Look at the comment node immediately before
   *   the declaration (Java/C#/Go/Rust style: /**, //, ///, etc.)
   * - 'body-first-string': Look at the first expression in the body
   *   (Python style: triple-quoted string)
   * - 'attribute': Look for a specific attribute/decorator that contains docs
   * - 'none': Skip docstring extraction (default)
   */
  strategy: 'preceding-comment' | 'body-first-string' | 'attribute' | 'none';

  /**
   * Comment node types to look for (for 'preceding-comment' strategy).
   * e.g., ['comment', 'block_comment', 'line_comment']
   */
  commentNodeTypes?: string[];

  /**
   * Prefixes to strip from doc comments.
   * e.g., ['///', '//', '#', '*']
   */
  stripPrefixes?: string[];

  /**
   * For 'body-first-string': node types that represent string literals.
   * e.g., ['string', 'concatenated_string', 'expression_statement']
   */
  stringNodeTypes?: string[];
}

/**
 * Configuration for visibility/export detection (Phase 2d).
 */
export interface VisibilityConfig {
  /**
   * Strategy for determining if a declaration is exported/public:
   * - 'modifier': Check for modifier keywords (public, export, pub)
   * - 'naming': Use naming conventions (Go uppercase, Python _prefix)
   * - 'all-public': Everything is exported (default)
   * - 'keyword': Check for a preceding keyword (e.g., 'export' in JS)
   */
  strategy: 'modifier' | 'naming' | 'all-public' | 'keyword';

  /**
   * For 'modifier' strategy: node types that contain modifiers.
   * e.g., ['modifiers', 'visibility_modifier']
   */
  modifierNodeTypes?: string[];

  /**
   * For 'modifier' strategy: field name that contains visibility modifier.
   * e.g., 'accessibility' (C#), 'modifiers' (Java)
   */
  modifierField?: string;

  /**
   * For 'modifier' strategy: modifier values that mean exported/public.
   * e.g., ['public', 'export'] or ['pub']
   */
  exportedModifiers?: string[];

  /**
   * For 'naming' strategy: if true, uppercase-first names are exported (Go convention).
   */
  uppercaseExported?: boolean;

  /**
   * For 'naming' strategy: prefix that means private/unexported.
   * e.g., '_' (Python convention)
   */
  privatePrefix?: string;

  /**
   * For 'keyword' strategy: the keyword that precedes exported declarations.
   * e.g., 'export' (JS/TS)
   */
  exportKeyword?: string;

  /**
   * For 'modifier' strategy: look for async modifier too.
   * Contains the modifier text that means async.
   * e.g., 'async' (C#, Python, JS)
   */
  asyncModifier?: string;

  /**
   * For 'modifier' strategy: modifier text that means abstract.
   * e.g., 'abstract' (Java, C#)
   */
  abstractModifier?: string;
}


/**
 * Configuration for a generic language plugin.
 *
 * Specifies what tree-sitter node types map to what entity types, which
 * child fields hold what data, and optional override functions for
 * language-specific extraction logic.
 */
export interface GenericLanguageConfig {
  /** Unique language identifier (e.g., 'python', 'go') */
  id: string;

  /** Human-readable display name (e.g., 'Python', 'Go') */
  displayName: string;

  /** File extensions (e.g., ['.py', '.pyw', '.pyi']) */
  extensions: string[];

  /** Tree-sitter grammar for this language */
  grammar: unknown;

  /**
   * Optional: package name for lazy grammar loading (Phase 3).
   * If grammar is null, this package will be dynamically imported.
   * e.g., 'tree-sitter-ruby'
   */
  grammarPackage?: string;

  /** Tree-sitter node type mappings */
  nodeTypes: {
    /** Node types for function/method declarations */
    functions: string[];
    /** Node types for class/struct declarations */
    classes: string[];
    /** Node types for interface/trait declarations */
    interfaces?: string[];
    /** Node types for variable/constant declarations */
    variables?: string[];
    /** Node types for import statements */
    imports: string[];
    /** Node types for type alias/enum declarations */
    types?: string[];
    /** Node types for call expressions (for extractCalls) */
    calls?: string[];
  };

  /** Field name mappings for AST node children.
   *  Most tree-sitter grammars use consistent names, but some differ —
   *  e.g., Java's method_invocation uses 'name' for the callee instead of 'function'.
   */
  fields?: {
    /** Field name for the entity name (default: 'name') */
    name?: string;
    /** Field name for function parameters (default: 'parameters') */
    parameters?: string;
    /** Field name for return type (default: 'return_type') */
    returnType?: string;
    /** Field name for function/class body (default: 'body') */
    body?: string;
    /** Field name for superclass/base class (default: 'superclasses') */
    superclass?: string;
    /** Field name for callee in call expressions (default: 'function').
     *  Java's method_invocation uses 'name' instead. */
    callee?: string;
  };

  // --- Phase 2 Configs ---

  /** Structured import extraction config (Phase 2a) */
  importConfig?: ImportConfig;

  /** Rich parameter extraction config (Phase 2b) */
  paramConfig?: ParamConfig;

  /** Docstring/comment extraction strategy (Phase 2c) */
  docstringConfig?: DocstringConfig;

  /** Visibility/export detection strategy (Phase 2d) */
  visibilityConfig?: VisibilityConfig;

  /** Language-specific override functions */
  overrides?: {
    /** Check if a node represents an exported/public declaration */
    isExported?(node: SyntaxNode, name: string): boolean;

    /** Check if a function node is async */
    isAsync?(node: SyntaxNode): boolean;

    /** Extract documentation comment/docstring from a node */
    extractDocstring?(node: SyntaxNode): string | undefined;

    /** Extract parameters from a function node */
    extractParameters?(node: SyntaxNode): ParamInfo[];

    /** Extract return type string from a function node */
    extractReturnType?(node: SyntaxNode): string | undefined;

    /** Extract class name (overrides default field lookup) */
    extractClassName?(node: SyntaxNode): string | undefined;

    /** Extract superclass names from a class node */
    extractSuperclasses?(node: SyntaxNode): string[];

    /** Check if a class is abstract */
    isAbstract?(node: SyntaxNode): boolean;

    /** Custom function extraction (replaces generic entirely) */
    extractFunctions?(root: SyntaxNode, filePath: string): FunctionEntity[];

    /** Custom class extraction (replaces generic entirely) */
    extractClasses?(root: SyntaxNode, filePath: string): ClassEntity[];

    /** Custom interface extraction (replaces generic entirely) */
    extractInterfaces?(root: SyntaxNode, filePath: string): InterfaceEntity[];

    /** Custom variable extraction (replaces generic entirely) */
    extractVariables?(root: SyntaxNode, filePath: string): VariableEntity[];

    /** Custom import extraction (replaces generic entirely) */
    extractImports?(root: SyntaxNode, filePath: string): ImportEntity[];

    /** Custom type extraction (replaces generic entirely) */
    extractTypes?(root: SyntaxNode, filePath: string): TypeEntity[];

    /** Custom call extraction (replaces generic entirely) */
    extractCalls?(root: SyntaxNode, filePath: string): CallReference[];

    /** Custom inheritance extraction (replaces generic entirely) */
    extractInheritance?(root: SyntaxNode, filePath: string): InheritanceReference[];

    /** Set of built-in function names to skip in call extraction */
    builtinFunctions?: Set<string>;
  };
}

// ============================================================================
// Phase 2 Generic Strategies
// ============================================================================

/**
 * Phase 2d: Determine if a declaration is exported/public using the configured strategy.
 */
function isExportedByConfig(node: SyntaxNode, name: string, config: GenericLanguageConfig): boolean {
  const vc = config.visibilityConfig;
  if (!vc || vc.strategy === 'all-public') return true;

  if (vc.strategy === 'naming') {
    if (vc.uppercaseExported) {
      // Go convention: exported if first letter is uppercase
      return name.length > 0 && name[0] === name[0].toUpperCase() && name[0] !== name[0].toLowerCase();
    }
    if (vc.privatePrefix) {
      return !name.startsWith(vc.privatePrefix);
    }
    return true;
  }

  if (vc.strategy === 'modifier') {
    return hasModifier(node, vc.modifierField, vc.modifierNodeTypes, vc.exportedModifiers ?? ['public']);
  }

  if (vc.strategy === 'keyword') {
    // Check if the parent is an export statement or the node has an export keyword sibling
    const parent = node.parent;
    if (parent && (parent.type === 'export_statement' || parent.type === 'export_declaration')) {
      return true;
    }
    // Check for preceding keyword sibling
    const prev = node.previousNamedSibling;
    if (prev && vc.exportKeyword && prev.text === vc.exportKeyword) return true;
    return false;
  }

  return true;
}

/**
 * Phase 2d: Check if a node has a specific modifier.
 */
function hasModifier(
  node: SyntaxNode,
  modifierField?: string,
  modifierNodeTypes?: string[],
  modifierValues?: string[],
): boolean {
  if (!modifierValues || modifierValues.length === 0) return false;

  // Strategy 1: Check a named field
  if (modifierField) {
    const modNode = node.childForFieldName(modifierField);
    if (modNode) {
      const text = modNode.text.toLowerCase();
      return modifierValues.some(m => text.includes(m.toLowerCase()));
    }
  }

  // Strategy 2: Check child nodes by type
  if (modifierNodeTypes) {
    for (const child of node.children) {
      if (modifierNodeTypes.includes(child.type)) {
        const text = child.text.toLowerCase();
        if (modifierValues.some(m => text.includes(m.toLowerCase()))) return true;
      }
    }
  }

  // Strategy 3: Check any child named 'modifiers' as fallback
  for (const child of node.children) {
    if (child.type === 'modifiers' || child.type === 'modifier') {
      const text = child.text.toLowerCase();
      if (modifierValues.some(m => text.includes(m.toLowerCase()))) return true;
    }
  }

  return false;
}

/**
 * Phase 2d: Detect async using visibility config or override.
 */
function isAsyncByConfig(node: SyntaxNode, config: GenericLanguageConfig): boolean {
  if (config.overrides?.isAsync) return config.overrides.isAsync(node);
  const vc = config.visibilityConfig;
  if (!vc?.asyncModifier) return false;
  return hasModifier(node, vc.modifierField, vc.modifierNodeTypes, [vc.asyncModifier]);
}

/**
 * Phase 2d: Detect abstract using visibility config or override.
 */
function isAbstractByConfig(node: SyntaxNode, config: GenericLanguageConfig): boolean {
  if (config.overrides?.isAbstract) return config.overrides.isAbstract(node);
  const vc = config.visibilityConfig;
  if (!vc?.abstractModifier) return false;
  return hasModifier(node, vc.modifierField, vc.modifierNodeTypes, [vc.abstractModifier]);
}

/**
 * Phase 2c: Extract docstring using the configured strategy.
 */
function extractDocstringByConfig(node: SyntaxNode, config: GenericLanguageConfig): string | undefined {
  if (config.overrides?.extractDocstring) return config.overrides.extractDocstring(node);

  const dc = config.docstringConfig;
  if (!dc || dc.strategy === 'none') return undefined;

  if (dc.strategy === 'preceding-comment') {
    return extractPrecedingComment(node, dc);
  }

  if (dc.strategy === 'body-first-string') {
    return extractBodyFirstString(node, config.fields?.body ?? 'body', dc);
  }

  return undefined;
}

/**
 * Phase 2c: Extract a doc comment from the node immediately preceding a declaration.
 */
function extractPrecedingComment(node: SyntaxNode, dc: DocstringConfig): string | undefined {
  const commentTypes = dc.commentNodeTypes ?? ['comment', 'block_comment'];
  const prev = node.previousNamedSibling;
  if (!prev || !commentTypes.includes(prev.type)) return undefined;

  let text = prev.text;

  // Strip common prefixes
  if (dc.stripPrefixes) {
    for (const prefix of dc.stripPrefixes) {
      text = text.split('\n').map((line: string) => {
        const trimmed = line.trim();
        return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length).trim() : trimmed;
      }).join('\n');
    }
  }

  text = text.trim();
  return text || undefined;
}

/**
 * Phase 2c: Extract docstring from the first string expression in a function body (Python-style).
 */
function extractBodyFirstString(
  node: SyntaxNode,
  bodyField: string,
  dc: DocstringConfig,
): string | undefined {
  const body = node.childForFieldName(bodyField);
  if (!body) return undefined;

  const stringTypes = dc.stringNodeTypes ?? ['string', 'expression_statement'];

  // Look at the first child
  for (const child of body.namedChildren) {
    if (stringTypes.includes(child.type)) {
      // If it's an expression_statement, get the inner string
      const actual = child.type === 'expression_statement' ? child.firstNamedChild : child;
      if (actual && (actual.type === 'string' || actual.type === 'concatenated_string')) {
        let text = actual.text;
        // Strip triple quotes
        if (text.startsWith('"""') || text.startsWith("'''")) {
          text = text.slice(3, -3);
        } else if (text.startsWith('"') || text.startsWith("'")) {
          text = text.slice(1, -1);
        }
        return text.trim() || undefined;
      }
    }
    // Only check the first named child
    break;
  }

  return undefined;
}

// ============================================================================
// Generic Extraction Helpers
// ============================================================================

/**
 * Generic function extraction.
 * Finds nodes of the configured types, extracts standard fields,
 * and applies override callbacks or Phase 2 configs for language-specific behavior.
 */
function genericExtractFunctions(
  root: SyntaxNode,
  filePath: string,
  config: GenericLanguageConfig,
): FunctionEntity[] {
  const functions: FunctionEntity[] = [];
  const nameField = config.fields?.name ?? 'name';
  const nodes = findNodesOfType(root, config.nodeTypes.functions);

  for (const node of nodes) {
    const nameNode = node.childForFieldName(nameField);
    if (!nameNode) continue;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    const isExported = config.overrides?.isExported
      ? config.overrides.isExported(node, name)
      : isExportedByConfig(node, name, config);

    const isAsync = isAsyncByConfig(node, config);

    const params = config.overrides?.extractParameters
      ? config.overrides.extractParameters(node)
      : genericExtractParams(node, config);

    const returnType = config.overrides?.extractReturnType
      ? config.overrides.extractReturnType(node)
      : node.childForFieldName(config.fields?.returnType ?? 'return_type')?.text;

    const docstring = extractDocstringByConfig(node, config);

    const scopeKey = buildLexicalScopeKey(node);
    const sameScope = nodes.filter((candidate) =>
      candidate.childForFieldName(nameField)?.text === name &&
      buildLexicalScopeKey(candidate) === scopeKey
    );
    let disambiguator = '';
    if (sameScope.length > 1) {
      const signature = signatureDisambiguator(genericFunctionSignature(params, returnType));
      const sameSignature = sameScope.filter((candidate) => {
        const candidateParams = config.overrides?.extractParameters
          ? config.overrides.extractParameters(candidate)
          : genericExtractParams(candidate, config);
        const candidateReturn = config.overrides?.extractReturnType
          ? config.overrides.extractReturnType(candidate)
          : candidate.childForFieldName(config.fields?.returnType ?? 'return_type')?.text;
        return signatureDisambiguator(genericFunctionSignature(candidateParams, candidateReturn)) === signature;
      });
      const occurrence = sameSignature.findIndex((candidate) => candidate.startIndex === node.startIndex) + 1;
      disambiguator = sameSignature.length > 1
        ? `${signature}/${occurrenceDisambiguator(occurrence)}`
        : signature;
    }
    const identity = sourceIdentity(node, filePath, 'Function', name, disambiguator);

    const entity: FunctionEntity = {
      ...identity,
      name,
      filePath,
      startLine,
      endLine,
      isExported,
      isAsync,
      isArrow: false,
      params,
    };

    if (returnType) entity.returnType = returnType;
    if (docstring) entity.docstring = docstring;

    functions.push(entity);
  }

  return functions;
}

function genericFunctionSignature(params: ParamInfo[], returnType: string | undefined): string {
  return `(${params.map((param) => `${param.type ?? '_'}${param.optional ? '?' : ''}`).join(',')})=>${returnType ?? '_'}`;
}

/**
 * Phase 2b: Rich parameter extraction.
 * Uses paramConfig for typed parameters, defaults, and filtering.
 * Falls back to basic identifier scanning if no config provided.
 */
function genericExtractParams(node: SyntaxNode, config: GenericLanguageConfig): ParamInfo[] {
  const paramField = config.fields?.parameters ?? 'parameters';
  const params: ParamInfo[] = [];
  const paramsNode = node.childForFieldName(paramField);
  if (!paramsNode) return params;

  const pc = config.paramConfig;
  const filterNames = new Set(pc?.filterNames ?? []);
  const typedTypes = new Set(pc?.typedParamNodeTypes ?? []);
  const defaultTypes = new Set(pc?.defaultParamNodeTypes ?? []);
  const identTypes = new Set(pc?.identifierNodeTypes ?? ['identifier']);
  const typeField = pc?.typeField ?? 'type';

  for (const child of paramsNode.namedChildren) {
    // Typed parameter (e.g., `name: string`, `int x`)
    if (typedTypes.has(child.type)) {
      const nameNode = child.childForFieldName('name')
        ?? child.namedChildren.find((c: SyntaxNode) => identTypes.has(c.type));
      if (!nameNode) continue;
      const name = nameNode.text;
      if (filterNames.has(name)) continue;

      const typeNode = child.childForFieldName(typeField);
      params.push({
        name,
        type: typeNode?.text,
        optional: false,
      });
      continue;
    }

    // Default parameter (e.g., `x = 5`)
    if (defaultTypes.has(child.type)) {
      const nameNode = child.childForFieldName('name')
        ?? child.namedChildren.find((c: SyntaxNode) => identTypes.has(c.type));
      if (!nameNode) continue;
      const name = nameNode.text;
      if (filterNames.has(name)) continue;

      const typeNode = child.childForFieldName(typeField);
      params.push({
        name,
        type: typeNode?.text,
        optional: true,
      });
      continue;
    }

    // Plain identifier parameter
    if (identTypes.has(child.type)) {
      const name = child.text;
      if (filterNames.has(name)) continue;
      params.push({ name });
      continue;
    }

    // Fallback: try to find an identifier child
    const idChild = child.namedChildren.find((c: SyntaxNode) => identTypes.has(c.type));
    if (idChild) {
      const name = idChild.text;
      if (filterNames.has(name)) continue;
      params.push({ name });
    }
  }

  return params;
}

/**
 * Generic class extraction.
 */
function genericExtractClasses(
  root: SyntaxNode,
  filePath: string,
  config: GenericLanguageConfig,
): ClassEntity[] {
  const classes: ClassEntity[] = [];
  const nameField = config.fields?.name ?? 'name';
  const nodes = findNodesOfType(root, config.nodeTypes.classes);

  for (const node of nodes) {
    const name = config.overrides?.extractClassName
      ? config.overrides.extractClassName(node)
      : node.childForFieldName(nameField)?.text;
    if (!name) continue;

    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    const isExported = config.overrides?.isExported
      ? config.overrides.isExported(node, name)
      : isExportedByConfig(node, name, config);

    const isAbstract = isAbstractByConfig(node, config);

    const superclasses = config.overrides?.extractSuperclasses
      ? config.overrides.extractSuperclasses(node)
      : genericExtractSuperclasses(node, config.fields?.superclass ?? 'superclasses');

    const docstring = extractDocstringByConfig(node, config);

    const identity = sourceIdentity(
      node,
      filePath,
      'Class',
      name,
      sameScopeOccurrence(node, nodes, name, nameField),
    );

    const entity: ClassEntity = {
      ...identity,
      name,
      filePath,
      startLine,
      endLine,
      isExported,
      isAbstract,
    };

    if (superclasses.length > 0) entity.extends = superclasses[0];
    if (superclasses.length > 1) entity.implements = superclasses.slice(1);
    if (docstring) entity.docstring = docstring;

    classes.push(entity);
  }

  return classes;
}

/**
 * Generic superclass extraction from a configured field.
 */
function genericExtractSuperclasses(node: SyntaxNode, field: string): string[] {
  const superNode = node.childForFieldName(field);
  if (!superNode) return [];

  const names: string[] = [];
  for (const child of superNode.namedChildren) {
    if (child.type === 'identifier' || child.type === 'attribute' ||
        child.type === 'type_identifier' || child.type === 'simple_identifier' ||
        child.type === 'scoped_identifier' || child.type === 'generic_type') {
      // For generic types like List<T>, use just the base name
      if (child.type === 'generic_type') {
        const baseName = child.childForFieldName('name') ?? child.firstNamedChild;
        if (baseName) names.push(baseName.text);
      } else {
        names.push(child.text);
      }
    }
  }
  return names;
}

/**
 * Generic interface extraction (for languages with interfaces/traits).
 */
function genericExtractInterfaces(
  root: SyntaxNode,
  filePath: string,
  config: GenericLanguageConfig,
): InterfaceEntity[] {
  if (!config.nodeTypes.interfaces || config.nodeTypes.interfaces.length === 0) return [];

  const interfaces: InterfaceEntity[] = [];
  const nameField = config.fields?.name ?? 'name';
  const nodes = findNodesOfType(root, config.nodeTypes.interfaces);

  for (const node of nodes) {
    const nameNode = node.childForFieldName(nameField);
    if (!nameNode) continue;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    const isExported = config.overrides?.isExported
      ? config.overrides.isExported(node, name)
      : isExportedByConfig(node, name, config);

    const docstring = extractDocstringByConfig(node, config);

    const identity = sourceIdentity(
      node,
      filePath,
      'Interface',
      name,
      sameScopeOccurrence(node, nodes, name, nameField),
    );

    const entity: InterfaceEntity = {
      ...identity,
      name,
      filePath,
      startLine,
      endLine,
      isExported,
    };

    if (docstring) entity.docstring = docstring;
    interfaces.push(entity);
  }

  return interfaces;
}

/**
 * Generic variable extraction.
 */
function genericExtractVariables(
  root: SyntaxNode,
  filePath: string,
  config: GenericLanguageConfig,
): VariableEntity[] {
  if (!config.nodeTypes.variables || config.nodeTypes.variables.length === 0) return [];

  const variables: VariableEntity[] = [];
  const nameField = config.fields?.name ?? 'name';
  const nodes = findNodesOfType(root, config.nodeTypes.variables);

  for (const node of nodes) {
    const nameNode = node.childForFieldName(nameField);
    if (!nameNode) continue;

    const name = nameNode.text;
    const line = node.startPosition.row + 1;

    const isExported = config.overrides?.isExported
      ? config.overrides.isExported(node, name)
      : isExportedByConfig(node, name, config);

    const identity = sourceIdentity(
      node,
      filePath,
      'Variable',
      name,
      sameScopeOccurrence(node, nodes, name, nameField, true),
      true,
    );

    variables.push({
      ...identity,
      name,
      filePath,
      line,
      kind: 'let' as const,
      isExported,
    });
  }

  return variables;
}

function sourceIdentity(
  node: SyntaxNode,
  filePath: string,
  label: SourceSymbolLabel,
  declaredName: string,
  disambiguator = '',
  includeBlockScopes = false,
) {
  return buildSymbolIdentity({
    label,
    filePath,
    scopeKey: buildLexicalScopeKey(node, { includeBlockScopes }),
    declaredName,
    disambiguator,
  });
}

function sameScopeOccurrence(
  node: SyntaxNode,
  nodes: SyntaxNode[],
  name: string,
  nameField: string,
  includeBlockScopes = false,
): string {
  const scopeKey = buildLexicalScopeKey(node, { includeBlockScopes });
  const peers = nodes.filter((candidate) =>
    candidate.childForFieldName(nameField)?.text === name &&
    buildLexicalScopeKey(candidate, { includeBlockScopes }) === scopeKey
  );
  if (peers.length <= 1) return '';
  const occurrence = peers.findIndex((candidate) => candidate.startIndex === node.startIndex) + 1;
  return occurrenceDisambiguator(occurrence);
}

/**
 * Phase 2a: Structured import extraction.
 * Uses importConfig for module field, specifier extraction, aliases.
 * Falls back to basic node.text if no importConfig.
 */
function genericExtractImports(
  root: SyntaxNode,
  filePath: string,
  config: GenericLanguageConfig,
): ImportEntity[] {
  const imports: ImportEntity[] = [];
  const nodes = findNodesOfType(root, config.nodeTypes.imports);
  const ic = config.importConfig;

  for (const node of nodes) {
    const line = node.startPosition.row + 1;

    // Try structured extraction if importConfig is provided
    let source: string;
    let specifiers: Array<{ name: string; alias?: string }> = [];
    let isNamespace = false;

    if (ic) {
      // Extract module source
      source = extractModuleSource(node, ic);

      // Extract specifiers
      if (ic.specifierNodeTypes) {
        specifiers = extractSpecifiers(node, ic);
      }

      // Check namespace import
      if (ic.isNamespaceImport) {
        isNamespace = ic.isNamespaceImport(node);
      }
    } else {
      // Fallback: use the entire node text as source
      source = node.text;
    }

    const id = generateEntityId(filePath, 'import', source.slice(0, 40), line);

    imports.push({
      id,
      filePath,
      source,
      isDefault: false,
      isNamespace,
      specifiers: specifiers.map(s => ({
        name: s.name,
        ...(s.alias ? { alias: s.alias } : {}),
      })),
    });
  }

  return imports;
}

/**
 * Phase 2a: Extract the module/source path from an import node.
 */
function extractModuleSource(node: SyntaxNode, ic: ImportConfig): string {
  // Strategy 1: Named field
  if (ic.moduleField) {
    const modNode = node.childForFieldName(ic.moduleField);
    if (modNode) {
      return ic.stripQuotes !== false ? stripQuotes(modNode.text) : modNode.text;
    }
  }

  // Strategy 2: Child by node type
  if (ic.moduleNodeTypes) {
    for (const child of node.descendantsOfType(ic.moduleNodeTypes)) {
      if (child) {
        return ic.stripQuotes !== false ? stripQuotes(child.text) : child.text;
      }
    }
  }

  // Fallback: entire node text
  return node.text;
}

/**
 * Phase 2a: Extract specifiers from an import node.
 */
function extractSpecifiers(
  node: SyntaxNode,
  ic: ImportConfig,
): Array<{ name: string; alias?: string }> {
  const specifiers: Array<{ name: string; alias?: string }> = [];
  if (!ic.specifierNodeTypes) return specifiers;

  const specNodes = node.descendantsOfType(ic.specifierNodeTypes);
  for (const specNode of specNodes) {
    const nameNode = specNode.childForFieldName('name') ?? specNode;
    const name = nameNode.text;

    let alias: string | undefined;
    if (ic.aliasField) {
      const aliasNode = specNode.childForFieldName(ic.aliasField);
      if (aliasNode) alias = aliasNode.text;
    }

    specifiers.push({ name, alias });
  }

  return specifiers;
}

/**
 * Strip wrapping quotes from a string.
 */
function stripQuotes(text: string): string {
  if ((text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  if (text.startsWith('`') && text.endsWith('`')) {
    return text.slice(1, -1);
  }
  return text;
}

/** What a locally-bound imported name resolves to: the file that declares
 *  it, and the name it is actually declared under THERE (which may differ
 *  from the local alias a consumer imported it as). */
interface ImportedSymbolTarget {
  resolvedPath: string | undefined;
  /** The name as declared at the target file, e.g. `fn` for
   *  `from .mod import fn as f` (not `f`, the call-site's local alias). */
  declaredName: string;
}

/**
 * Build two import maps from a file's imports, mirroring the TS calls
 * extractor's buildImportMaps (packages/plugin-typescript/src/extractors/
 * calls.ts), plus the DECLARED name at the target so a renamed import
 * resolves to the name the target file actually uses, not the local alias:
 * - `symbols`: any locally-bound import name (named specifier, its alias, a
 *   default alias, or a namespace alias) -> `{ resolvedPath, declaredName }`.
 *   For a plain (non-aliased) specifier, declaredName equals the local name.
 *   For `from .mod import fn as f`, the map key is `f` (what call sites
 *   write) but declaredName is `fn` (what mod.py actually calls it) --
 *   without this, a callee id built from the local alias names a Function
 *   node that does not exist at the target file, and the graph's
 *   {name, filePath} MATCH (packages/graph/src/operations.ts
 *   CREATE_CALLS_EDGE) silently finds nothing. `resolvedPath` is undefined
 *   for an import the language's own extractImports never resolved to a
 *   real file, which is the common case today for most generic-factory
 *   languages; those names simply never produce a cross-file callee below.
 * - `namespaces`: only namespace aliases -> resolvedPath. Used to resolve an
 *   attribute/member call whose LHS is a whole-module import (Python's
 *   `import module` followed by `module.fn()`), separately from a plain
 *   identifier call. No declared-name rewrite is needed here: the attribute
 *   name at the call site (`fn` in `module.fn()`) is read directly off the
 *   target's own name, unaffected by any alias on the MODULE itself.
 */
function buildImportedNameMap(imports: ImportEntity[]): {
  symbols: Map<string, ImportedSymbolTarget>;
  namespaces: Map<string, string | undefined>;
} {
  const symbols = new Map<string, ImportedSymbolTarget>();
  const namespaces = new Map<string, string | undefined>();
  for (const imp of imports) {
    if (imp.isDefault && imp.defaultAlias) {
      symbols.set(imp.defaultAlias, { resolvedPath: imp.resolvedPath, declaredName: imp.defaultAlias });
    }
    if (imp.isNamespace && imp.namespaceAlias) {
      symbols.set(imp.namespaceAlias, { resolvedPath: imp.resolvedPath, declaredName: imp.namespaceAlias });
      namespaces.set(imp.namespaceAlias, imp.resolvedPath);
    }
    for (const spec of imp.specifiers) {
      const localName = spec.alias ?? spec.name;
      symbols.set(localName, { resolvedPath: imp.resolvedPath, declaredName: spec.name });
    }
  }
  return { symbols, namespaces };
}

/**
 * Generic call extraction.
 *
 * `context.imports`, when supplied, lets a call to a name imported from
 * another file resolve to that file (`calleeFilePath`), instead of being
 * silently dropped the moment it isn't also a local function. Same-file
 * resolution (a call to a function defined in THIS file) is checked first
 * and always wins, unconditionally of context. A name that is neither local
 * nor a known, resolved import stays dropped, exactly as before: this
 * extractor never guesses.
 */
function genericExtractCalls(
  root: SyntaxNode,
  filePath: string,
  config: GenericLanguageConfig,
  functions: FunctionEntity[],
  context?: CallExtractionContext,
): CallReference[] {
  if (!config.nodeTypes.calls || config.nodeTypes.calls.length === 0) return [];

  const calls: CallReference[] = [];
  const builtins = config.overrides?.builtinFunctions ?? new Set<string>();
  const localFunctionNames = new Set(functions.map((f) => f.name));
  const { symbols: importedSymbols, namespaces: importedNamespaces } = buildImportedNameMap(context?.imports ?? []);

  const funcNodes = findNodesOfType(root, config.nodeTypes.functions);

  for (const funcNode of funcNodes) {
    const callerNameNode = funcNode.childForFieldName(config.fields?.name ?? 'name');
    if (!callerNameNode) continue;
    const callerName = callerNameNode.text;

    const bodyNode = funcNode.childForFieldName(config.fields?.body ?? 'body');
    if (!bodyNode) continue;

    const callNodes = findNodesOfType(bodyNode, config.nodeTypes.calls);

    for (const callNode of callNodes) {
      const calleeField = config.fields?.callee ?? 'function';
      const funcExpr = callNode.childForFieldName(calleeField);
      if (!funcExpr) continue;

      let calleeName: string | undefined;
      let namespaceLhs: string | undefined;

      if (funcExpr.type === 'identifier' || funcExpr.type === 'simple_identifier') {
        calleeName = funcExpr.text;
      } else if (funcExpr.type === 'attribute' || funcExpr.type === 'member_expression' ||
                 funcExpr.type === 'member_access_expression' || funcExpr.type === 'field_expression') {
        const attr = funcExpr.childForFieldName('attribute')
          ?? funcExpr.childForFieldName('property')
          ?? funcExpr.childForFieldName('name');
        if (attr) calleeName = attr.text;

        // Module-qualified call (`module.fn()`): capture the receiver so it
        // can be resolved through a namespace import below, if the plain
        // callee name itself isn't a local function or a direct import.
        const object = funcExpr.childForFieldName('object')
          ?? funcExpr.childForFieldName('value');
        if (object && (object.type === 'identifier' || object.type === 'simple_identifier')) {
          namespaceLhs = object.text;
        }
      }

      if (!calleeName || builtins.has(calleeName)) continue;

      const line = callNode.startPosition.row + 1;

      if (localFunctionNames.has(calleeName)) {
        calls.push({ callerName, calleeName, line, filePath });
        continue;
      }

      const importedCallee = importedSymbols.get(calleeName);
      if (importedCallee?.resolvedPath) {
        // calleeName is rewritten to the DECLARED name at the target file
        // here (not the call-site's local alias): see buildImportedNameMap.
        calls.push({
          callerName,
          calleeName: importedCallee.declaredName,
          line,
          filePath,
          calleeFilePath: importedCallee.resolvedPath,
        });
        continue;
      }

      if (namespaceLhs) {
        const namespacePath = importedNamespaces.get(namespaceLhs);
        if (namespacePath) {
          calls.push({ callerName, calleeName, line, filePath, calleeFilePath: namespacePath });
        }
      }
    }
  }

  return calls;
}

/**
 * Generic inheritance extraction from class entities.
 */
function genericExtractInheritance(
  root: SyntaxNode,
  filePath: string,
  config: GenericLanguageConfig,
  classes: ClassEntity[],
  interfaces?: InterfaceEntity[],
): InheritanceReference[] {
  const refs: InheritanceReference[] = [];

  // Class inheritance (extends + implements)
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
      for (const impl of cls.implements) {
        refs.push({
          childName: cls.name,
          parentName: impl,
          type: 'implements',
          filePath,
        });
      }
    }
  }

  // Interface extension (interface extends interface)
  if (interfaces) {
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
  }

  return refs;
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a complete LanguagePlugin from a declarative config.
 *
 * The factory:
 *   1. Sets up grammar helpers (getGrammarForExtension, etc.)
 *   2. Wires up standard or overridden extractors (with Phase 2 configs)
 *   3. Composes extractAllEntities
 *   4. Returns a LanguagePlugin conforming to the @codegraph/types interface
 *
 * @param config - Language configuration
 * @returns A fully-formed LanguagePlugin
 */
export function createLanguagePlugin(config: GenericLanguageConfig): LanguagePlugin {
  // Grammar setup
  const extensionToGrammar: Record<string, unknown> = {};
  for (const ext of config.extensions) {
    extensionToGrammar[ext] = config.grammar;
  }
  createGrammarHelpers(extensionToGrammar);

  // Wire up extractors (custom overrides take precedence over generic)
  const extractFunctions = config.overrides?.extractFunctions
    ?? ((root: SyntaxNode, filePath: string) => genericExtractFunctions(root, filePath, config));

  const extractClasses = config.overrides?.extractClasses
    ?? ((root: SyntaxNode, filePath: string) => genericExtractClasses(root, filePath, config));

  const extractInterfaces = config.overrides?.extractInterfaces
    ?? ((root: SyntaxNode, filePath: string) => genericExtractInterfaces(root, filePath, config));

  const extractVariables = config.overrides?.extractVariables
    ?? ((root: SyntaxNode, filePath: string) => genericExtractVariables(root, filePath, config));

  const extractImports = config.overrides?.extractImports
    ?? ((root: SyntaxNode, filePath: string) => genericExtractImports(root, filePath, config));

  const extractTypes = config.overrides?.extractTypes ?? undefined;

  const extractCalls = config.overrides?.extractCalls
    ?? (config.nodeTypes.calls && config.nodeTypes.calls.length > 0
      ? (root: SyntaxNode, filePath: string, context?: CallExtractionContext) => {
          const fns = extractFunctions(root, filePath);
          return genericExtractCalls(root, filePath, config, fns, context);
        }
      : undefined);

  const extractInheritance = config.overrides?.extractInheritance
    ?? ((root: SyntaxNode, filePath: string) => {
      const cls = extractClasses(root, filePath);
      const ifaces = extractInterfaces(root, filePath);
      return genericExtractInheritance(root, filePath, config, cls, ifaces);
    });

  // Compose extractAllEntities
  function extractAllEntities(root: SyntaxNode, filePath: string): ExtractedEntities {
    return {
      functions: extractFunctions(root, filePath),
      classes: extractClasses(root, filePath),
      interfaces: extractInterfaces(root, filePath),
      variables: extractVariables(root, filePath),
      imports: extractImports(root, filePath),
      types: extractTypes ? extractTypes(root, filePath) : [],
      components: [],
    };
  }

  return {
    id: config.id,
    displayName: config.displayName,
    extensions: config.extensions,
    getGrammar: () => config.grammar,
    extractors: {
      extractFunctions,
      extractClasses,
      extractVariables,
      extractImports,
      extractInterfaces,
      ...(extractTypes != null ? { extractTypes } : {}),
      ...(extractCalls != null ? { extractCalls } : {}),
      extractInheritance,
    },
    extractAllEntities,
  };
}

// Re-export helpers for configs to use
export { findNodesOfType, generateEntityId } from '@codegraph/plugin-common';
