/**
 * @codegraph/plugin-python
 * Python language plugin for CodeGraph
 */

import Python from 'tree-sitter-python';
import type {
  FunctionEntity,
  ClassEntity,
  VariableEntity,
  ImportEntity,
  InheritanceReference,
  CallReference,
  ExtractedEntities,
  SyntaxNode,
} from '@codegraph/types';

// ============================================================================
// Grammar Export
// ============================================================================

/** Get the tree-sitter grammar for Python */
export function getGrammar(): unknown {
  return Python;
}

/** Extension to grammar mapping */
const extensionToGrammar: Record<string, unknown> = {
  '.py': Python,
  '.pyw': Python,
  '.pyi': Python,
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
// Python Extractors
// ============================================================================

/**
 * Extract function definitions from Python AST
 * Handles: def function_name(...): and async def function_name(...):
 */
export function extractFunctions(root: SyntaxNode, filePath: string): FunctionEntity[] {
  const functions: FunctionEntity[] = [];
  const functionNodes = findNodesOfType(root, ['function_definition']);

  for (const node of functionNodes) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    // Check if async (look for 'async' keyword in parent decorated_definition or preceding siblings)
    let isAsync = false;
    const parent = node.parent;
    if (parent?.type === 'decorated_definition') {
      // Check for async in the parent's text
      isAsync = parent.text.startsWith('async ');
    } else {
      // Check for async keyword before function_definition
      const prevSibling = node.previousSibling;
      if (prevSibling?.type === 'async') {
        isAsync = true;
      }
    }

    // Extract parameters
    const params = extractParameters(node);

    // Extract return type annotation if present
    const returnTypeNode = node.childForFieldName('return_type');
    const returnType = returnTypeNode?.text?.replace(/^->\\s*/, '').trim();

    // Extract docstring
    const docstring = extractDocstring(node);

    // Check if method (inside class)
    const isMethod = isInsideClass(node);

    const id = generateEntityId(filePath, 'function', name, startLine);

    const entity: FunctionEntity = {
      id,
      name,
      filePath,
      startLine,
      endLine,
      isExported: !name.startsWith('_'), // Python convention: _ prefix means private
      isAsync,
      isArrow: false, // Python doesn't have arrow functions
      params,
    };

    if (returnType) entity.returnType = returnType;
    if (docstring) entity.docstring = docstring;

    functions.push(entity);
  }

  return functions;
}

function extractParameters(funcNode: SyntaxNode): { name: string; type?: string; optional?: boolean }[] {
  const params: { name: string; type?: string; optional?: boolean }[] = [];
  const parametersNode = funcNode.childForFieldName('parameters');
  if (!parametersNode) return params;

  for (const child of parametersNode.children) {
    if (child.type === 'identifier') {
      // Simple parameter
      params.push({ name: child.text });
    } else if (child.type === 'typed_parameter') {
      // Parameter with type annotation
      const nameNode = child.children.find(c => c.type === 'identifier');
      const typeNode = child.childForFieldName('type');
      if (nameNode) {
        params.push({
          name: nameNode.text,
          type: typeNode?.text,
        });
      }
    } else if (child.type === 'default_parameter' || child.type === 'typed_default_parameter') {
      // Parameter with default value
      const nameNode = child.children.find(c => c.type === 'identifier');
      const typeNode = child.childForFieldName('type');
      if (nameNode) {
        params.push({
          name: nameNode.text,
          type: typeNode?.text,
          optional: true,
        });
      }
    }
  }

  // Filter out 'self' and 'cls' parameters
  return params.filter(p => p.name !== 'self' && p.name !== 'cls');
}

function extractDocstring(node: SyntaxNode): string | undefined {
  // Look for string as first statement in function body
  const bodyNode = node.childForFieldName('body');
  if (!bodyNode) return undefined;

  const firstChild = bodyNode.firstChild;
  if (firstChild?.type === 'expression_statement') {
    const expr = firstChild.firstChild;
    if (expr?.type === 'string') {
      // Remove quotes and clean up
      let text = expr.text;
      if (text.startsWith('"""') || text.startsWith("'''")) {
        text = text.slice(3, -3);
      } else if (text.startsWith('"') || text.startsWith("'")) {
        text = text.slice(1, -1);
      }
      return text.trim();
    }
  }

  return undefined;
}

function isInsideClass(node: SyntaxNode): boolean {
  let parent = node.parent;
  while (parent) {
    if (parent.type === 'class_definition') {
      return true;
    }
    parent = parent.parent;
  }
  return false;
}

/**
 * Extract class definitions from Python AST
 */
export function extractClasses(root: SyntaxNode, filePath: string): ClassEntity[] {
  const classes: ClassEntity[] = [];
  const classNodes = findNodesOfType(root, ['class_definition']);

  for (const node of classNodes) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;

    // Extract superclasses
    const superclassesNode = node.childForFieldName('superclasses');
    const extendsClause: string[] = [];
    if (superclassesNode) {
      for (const child of superclassesNode.children) {
        if (child.type === 'identifier' || child.type === 'attribute') {
          extendsClause.push(child.text);
        }
      }
    }

    // Extract docstring
    const docstring = extractDocstring(node);

    // Count methods
    const bodyNode = node.childForFieldName('body');
    const methods: string[] = [];
    if (bodyNode) {
      for (const child of bodyNode.children) {
        if (child.type === 'function_definition') {
          const methodName = child.childForFieldName('name')?.text;
          if (methodName) {
            methods.push(methodName);
          }
        }
      }
    }

    const id = generateEntityId(filePath, 'class', name, startLine);

    const entity: ClassEntity = {
      id,
      name,
      filePath,
      startLine,
      endLine,
      isExported: !name.startsWith('_'),
      isAbstract: false, // Python uses ABC, need deeper analysis
    };

    if (extendsClause.length > 0) entity.extends = extendsClause[0];
    if (docstring) entity.docstring = docstring;

    classes.push(entity);
  }

  return classes;
}

/**
 * Extract import statements from Python AST
 */
export function extractImports(root: SyntaxNode, filePath: string): ImportEntity[] {
  const imports: ImportEntity[] = [];
  const importNodes = findNodesOfType(root, ['import_statement', 'import_from_statement']);

  for (const node of importNodes) {
    const line = node.startPosition.row + 1;

    if (node.type === 'import_statement') {
      // import foo, bar, baz
      for (const child of node.children) {
        if (child.type === 'dotted_name' || child.type === 'aliased_import') {
          const moduleName = child.type === 'aliased_import'
            ? child.childForFieldName('name')?.text
            : child.text;
          if (moduleName) {
            const id = generateEntityId(filePath, 'import', moduleName, line);
            imports.push({
              id,
              filePath,
              source: moduleName,
              isDefault: false,
              isNamespace: true,
              specifiers: [],
              namespaceAlias: moduleName,
            });
          }
        }
      }
    } else if (node.type === 'import_from_statement') {
      // from module import foo, bar
      const moduleNode = node.childForFieldName('module_name');
      const moduleName = moduleNode?.text || '';

      const specifiers: { name: string; alias?: string }[] = [];

      for (const child of node.children) {
        if (child.type === 'dotted_name' && child !== moduleNode) {
          specifiers.push({ name: child.text });
        } else if (child.type === 'aliased_import') {
          const name = child.childForFieldName('name')?.text;
          const alias = child.childForFieldName('alias')?.text;
          if (name) {
            specifiers.push({ name, alias });
          }
        }
      }

      const id = generateEntityId(filePath, 'import', moduleName, line);
      imports.push({
        id,
        filePath,
        source: moduleName,
        isDefault: false,
        isNamespace: specifiers.length === 0,
        specifiers: specifiers.map(s => ({
          name: s.name,
          alias: s.alias,
        })),
      });
    }
  }

  return imports;
}

// ============================================================================
// Import Path Resolution
// ============================================================================

/**
 * Resolve a Python import to a file path
 * @param moduleName - The module path (e.g., 'api.analyzers.analyzer')
 * @param importingFilePath - Path of the file containing the import
 * @param projectRoot - Root path of the project
 * @returns Resolved file path or undefined if external/not found
 */
export function resolvePythonImport(
  moduleName: string,
  importingFilePath: string,
  projectRoot: string
): string | undefined {
  if (!moduleName) return undefined;

  // Convert module path to potential file path
  // e.g., 'api.analyzers.analyzer' -> 'api/analyzers/analyzer'
  const modulePath = moduleName.replace(/\./g, '/');

  // Get the directory of the importing file
  const importingDir = importingFilePath.substring(0, importingFilePath.lastIndexOf('/'));

  // Possible file locations to check
  const candidates: string[] = [];

  // Handle relative imports (starts with '.')
  if (moduleName.startsWith('.')) {
    // Relative import: . is current dir, .. is parent dir
    let baseDir = importingDir;
    let relPath = modulePath;

    // Count leading dots and adjust path
    const match = moduleName.match(/^(\.+)/);
    if (match) {
      const dots = match[1].length;
      // Each dot after the first goes up one directory
      for (let i = 1; i < dots; i++) {
        baseDir = baseDir.substring(0, baseDir.lastIndexOf('/'));
      }
      relPath = modulePath.substring(dots); // Remove leading dots
    }

    if (relPath) {
      candidates.push(`${baseDir}/${relPath}.py`);
      candidates.push(`${baseDir}/${relPath}/__init__.py`);
    } else {
      candidates.push(`${baseDir}/__init__.py`);
    }
  } else {
    // Absolute import - check from project root
    candidates.push(`${projectRoot}/${modulePath}.py`);
    candidates.push(`${projectRoot}/${modulePath}/__init__.py`);

    // Also check if it could be relative to importing file's package
    const packageDir = findPackageRoot(importingDir, projectRoot);
    if (packageDir && packageDir !== projectRoot) {
      candidates.push(`${packageDir}/${modulePath}.py`);
      candidates.push(`${packageDir}/${modulePath}/__init__.py`);
    }
  }

  // Return the first candidate that looks like a project file
  // (We can't do file system checks at extraction time, so we return the most likely path)
  for (const candidate of candidates) {
    if (candidate.startsWith(projectRoot) && !candidate.includes('/site-packages/')) {
      return candidate;
    }
  }

  return undefined;
}

/**
 * Find the package root directory (directory with __init__.py up the tree)
 */
function findPackageRoot(dir: string, projectRoot: string): string | undefined {
  let current = dir;
  while (current.length >= projectRoot.length) {
    // Return this dir as potential package root
    if (current !== projectRoot) {
      return current;
    }
    current = current.substring(0, current.lastIndexOf('/'));
  }
  return projectRoot;
}

/**
 * Extract module-level variable assignments from Python AST
 */
export function extractVariables(root: SyntaxNode, filePath: string): VariableEntity[] {
  const variables: VariableEntity[] = [];

  // Only look at top-level assignments
  for (const child of root.children) {
    if (child.type === 'expression_statement') {
      const expr = child.firstChild;
      if (expr?.type === 'assignment') {
        const leftNode = expr.childForFieldName('left');
        const rightNode = expr.childForFieldName('right');

        if (leftNode?.type === 'identifier') {
          const name = leftNode.text;
          const line = child.startPosition.row + 1;

          // Determine kind based on naming convention
          // UPPER_CASE = constant, lower_case = variable
          const isConstant = name === name.toUpperCase() && name.includes('_');

          const id = generateEntityId(filePath, 'variable', name, line);

          variables.push({
            id,
            name,
            filePath,
            line,
            kind: isConstant ? 'const' : 'let',
            isExported: !name.startsWith('_'),
            type: rightNode?.type, // Basic type inference
          });
        }
      }
    }
  }

  return variables;
}

// ============================================================================
// Inheritance Extraction
// ============================================================================

/**
 * Extract inheritance relationships from Python classes
 * Returns InheritanceReference[] for EXTENDS edges
 */
export function extractInheritance(root: SyntaxNode, filePath: string): InheritanceReference[] {
  const refs: InheritanceReference[] = [];
  const classes = extractClasses(root, filePath);

  for (const cls of classes) {
    if (cls.extends) {
      refs.push({
        childName: cls.name,
        parentName: cls.extends,
        type: 'extends',
        filePath,
      });
    }
  }

  return refs;
}

// ============================================================================
// Call Extraction
// ============================================================================

/** Python builtins to skip when extracting calls */
const PYTHON_BUILTINS = new Set([
  // Built-in functions
  'print', 'len', 'range', 'str', 'int', 'float', 'list', 'dict', 'set', 'tuple',
  'type', 'isinstance', 'issubclass', 'hasattr', 'getattr', 'setattr', 'delattr',
  'open', 'input', 'format', 'repr', 'abs', 'min', 'max', 'sum', 'sorted', 'reversed',
  'enumerate', 'zip', 'map', 'filter', 'any', 'all', 'next', 'iter', 'id', 'hash',
  'dir', 'vars', 'globals', 'locals', 'callable', 'super', 'property', 'classmethod',
  'staticmethod', 'object', 'bool', 'bytes', 'bytearray', 'memoryview', 'complex',
  'divmod', 'pow', 'round', 'chr', 'ord', 'bin', 'oct', 'hex', 'slice', 'frozenset',
  'compile', 'exec', 'eval', 'breakpoint', 'help', 'exit', 'quit',
  // Common assert/test methods
  'assert', 'assertEqual', 'assertTrue', 'assertFalse', 'assertRaises', 'assertIn',
  'assertIsNone', 'assertIsNotNone', 'assertIs', 'assertIsNot', 'fail',
  // Logging
  'info', 'debug', 'warning', 'error', 'critical', 'exception',
]);

/**
 * Extract function calls from Python AST
 * Returns CallReference[] for CALLS edges
 */
export function extractCalls(root: SyntaxNode, filePath: string): CallReference[] {
  const calls: CallReference[] = [];

  // Get all functions in the file for local function lookup
  const functions = extractFunctions(root, filePath);
  const localFunctionNames = new Set(functions.map(f => f.name));

  // Find all function definitions and extract calls from their bodies
  const funcNodes = findNodesOfType(root, ['function_definition']);

  for (const funcNode of funcNodes) {
    const callerNameNode = funcNode.childForFieldName('name');
    if (!callerNameNode) continue;
    const callerName = callerNameNode.text;

    // Find all call expressions in this function's body
    const bodyNode = funcNode.childForFieldName('body');
    if (!bodyNode) continue;

    const callNodes = findNodesOfType(bodyNode, ['call']);

    for (const callNode of callNodes) {
      const funcExpr = callNode.childForFieldName('function');
      if (!funcExpr) continue;

      let calleeName: string | undefined;

      // Simple identifier: foo()
      if (funcExpr.type === 'identifier') {
        calleeName = funcExpr.text;
      }
      // Attribute: obj.method() - extract method name
      else if (funcExpr.type === 'attribute') {
        const attr = funcExpr.childForFieldName('attribute');
        if (attr) {
          calleeName = attr.text;
        }
      }

      if (!calleeName || PYTHON_BUILTINS.has(calleeName)) continue;

      // For now, only create edges for local function calls
      // (Cross-file resolution would require import resolution)
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
// Extract All Entities (Single Pass)
// ============================================================================

/**
 * Extract all entities from a Python file in a single pass
 */
export function extractAllEntities(root: SyntaxNode, filePath: string): ExtractedEntities {
  return {
    functions: extractFunctions(root, filePath),
    classes: extractClasses(root, filePath),
    variables: extractVariables(root, filePath),
    imports: extractImports(root, filePath),
    interfaces: [], // Not applicable for Python
    types: [], // Not applicable for Python  
    components: [], // Not applicable for Python
  };
}

// ============================================================================
// Plugin Export
// ============================================================================

export const pythonPlugin = {
  id: 'python',
  displayName: 'Python',
  extensions: ['.py', '.pyw', '.pyi'],
  getGrammar,
  extractors: {
    extractFunctions,
    extractClasses,
    extractVariables,
    extractImports,
    extractInheritance,
    extractCalls,
  },
  extractAllEntities,
};
