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
  SyntaxNode,
  HasMethodEdgeDescriptor,
  HasPropertyEdgeDescriptor,
  Visibility,
} from '@codegraph/types';
import { findNodesOfType, generateEntityId, calculateComplexity } from '@codegraph/plugin-common';
import { createLanguagePlugin } from '@codegraph/plugin-generic';

/** Get the tree-sitter grammar for Python */
export function getGrammar(): unknown {
  return Python;
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

    // Check if async — the 'async' keyword appears as a child of function_definition
    const isAsync = node.children.some((c: SyntaxNode) => c.type === 'async');

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

    // Universal complexity metrics
    const metrics = calculateComplexity(node);
    entity.complexity = metrics.cyclomatic;
    entity.cognitiveComplexity = metrics.cognitive;
    entity.nestingDepth = metrics.nestingDepth;

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

// ============================================================================
// Python visibility helper
// ============================================================================

/**
 * Derive Python visibility from name convention.
 * Leading underscore (single or double, but not dunder like __init__) → private.
 * Dunder methods (__x__) are treated as public per Python convention.
 */
function pythonVisibility(name: string): Visibility {
  if (name.startsWith('__') && name.endsWith('__')) return 'public'; // dunder methods are public
  if (name.startsWith('_')) return 'private';
  return 'public';
}

/** Result of extractClassesWithEdges */
export interface ClassExtractionResult {
  classes: ClassEntity[];
  methodEntities: FunctionEntity[];
  propertyEntities: VariableEntity[];
  hasMethodEdges: HasMethodEdgeDescriptor[];
  hasPropertyEdges: HasPropertyEdgeDescriptor[];
}

/**
 * Extract class definitions together with their method-Function entities,
 * class-attribute-Variable entities, and HAS_METHOD/HAS_PROPERTY edge descriptors.
 *
 * The pipeline picks up the edges automatically via the ExtractedEntities fields
 * already wired in batchUpsert.
 */
export function extractClassesWithEdges(root: SyntaxNode, filePath: string): ClassExtractionResult {
  const classes: ClassEntity[] = [];
  const methodEntities: FunctionEntity[] = [];
  const propertyEntities: VariableEntity[] = [];
  const hasMethodEdges: HasMethodEdgeDescriptor[] = [];
  const hasPropertyEdges: HasPropertyEdgeDescriptor[] = [];

  const classNodes = findNodesOfType(root, ['class_definition']);

  for (const node of classNodes) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) continue;

    const name = nameNode.text;
    const startLine = node.startPosition.row + 1;
    const endLine = node.endPosition.row + 1;
    const isExported = !name.startsWith('_');

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

    const classId = generateEntityId(filePath, 'class', name, startLine);

    const classEntity: ClassEntity = {
      id: classId,
      name,
      filePath,
      startLine,
      endLine,
      isExported,
      isAbstract: false,
    };
    if (extendsClause.length > 0) classEntity.extends = extendsClause[0];
    if (docstring) classEntity.docstring = docstring;

    classes.push(classEntity);

    // Walk class body for methods and class-level attributes
    const bodyNode = node.childForFieldName('body');
    if (!bodyNode) continue;

    const methodNameCount = new Map<string, number>();
    const propNameCount = new Map<string, number>();

    for (const member of bodyNode.children) {
      // ---- Method: function_definition or decorated_definition wrapping one ----
      let funcNode: SyntaxNode | null = null;
      let isStatic = false;

      if (member.type === 'function_definition') {
        funcNode = member;
      } else if (member.type === 'decorated_definition') {
        // Check for @staticmethod or @classmethod decorators
        for (const child of member.children) {
          if (child.type === 'decorator') {
            const decoratorName = child.children.find(
              (c: SyntaxNode) => c.type === 'identifier'
            )?.text;
            if (decoratorName === 'staticmethod' || decoratorName === 'classmethod') {
              isStatic = true;
            }
          }
        }
        // Find the wrapped function_definition
        const inner = member.children.find((c: SyntaxNode) => c.type === 'function_definition');
        if (inner) funcNode = inner;
      }

      if (funcNode) {
        const methodNameNode = funcNode.childForFieldName('name');
        if (!methodNameNode) continue;
        const methodName = methodNameNode.text;

        const count = methodNameCount.get(methodName) ?? 0;
        methodNameCount.set(methodName, count + 1);
        const suffix = count > 0 ? `:${count}` : '';

        const methodId = `${classId}::method::${methodName}${suffix}`;
        const methodStartLine = funcNode.startPosition.row + 1;
        const methodEndLine = funcNode.endPosition.row + 1;

        const isAsync = funcNode.children.some((c: SyntaxNode) => c.type === 'async');
        const params = extractParameters(funcNode);
        const returnTypeNode = funcNode.childForFieldName('return_type');
        const returnType = returnTypeNode?.text?.replace(/^->\s*/, '').trim();
        const methodDocstring = extractDocstring(funcNode);
        const metrics = calculateComplexity(funcNode);

        const methodEntity: FunctionEntity = {
          id: methodId,
          name: methodName,
          filePath,
          startLine: methodStartLine,
          endLine: methodEndLine,
          isExported,
          isAsync,
          isArrow: false,
          params,
          complexity: metrics.cyclomatic,
          cognitiveComplexity: metrics.cognitive,
          nestingDepth: metrics.nestingDepth,
        };
        if (returnType) methodEntity.returnType = returnType;
        if (methodDocstring) methodEntity.docstring = methodDocstring;

        methodEntities.push(methodEntity);
        hasMethodEdges.push({
          fromId: classId,
          toId: methodId,
          isStatic,
          visibility: pythonVisibility(methodName),
        });
        continue;
      }

      // ---- Class-level attribute: assignment or typed assignment ----
      // Handles: `name: str = ""` (annotated_assignment) and `name = value` (expression_statement > assignment)
      let propName: string | undefined;
      let propType: string | undefined;
      let propStartLine: number | undefined;
      let propEndLine: number | undefined;

      if (member.type === 'expression_statement') {
        const expr = member.firstChild;
        if (expr?.type === 'assignment') {
          const leftNode = expr.childForFieldName('left');
          if (leftNode?.type === 'identifier') {
            propName = leftNode.text;
            propStartLine = member.startPosition.row + 1;
            propEndLine = member.endPosition.row + 1;
          }
        }
      } else if (member.type === 'annotated_assignment') {
        const leftNode = member.childForFieldName('left');
        if (leftNode?.type === 'identifier') {
          propName = leftNode.text;
          propStartLine = member.startPosition.row + 1;
          propEndLine = member.endPosition.row + 1;
          const typeAnnotation = member.childForFieldName('type');
          if (typeAnnotation) {
            propType = typeAnnotation.text;
          }
        }
      }

      if (propName && propStartLine !== undefined && propEndLine !== undefined) {
        const count = propNameCount.get(propName) ?? 0;
        propNameCount.set(propName, count + 1);
        const suffix = count > 0 ? `:${count}` : '';

        const propId = `${classId}::prop::${propName}${suffix}`;

        const propEntity: VariableEntity = {
          id: propId,
          name: propName,
          filePath,
          line: propStartLine,
          kind: 'const',
          isExported,
        };
        if (propType) propEntity.type = propType;

        propertyEntities.push(propEntity);
        hasPropertyEdges.push({
          fromId: classId,
          toId: propId,
          isStatic: true, // class-body level assignments are class attributes (static in Python's model)
          visibility: pythonVisibility(propName),
          isReadonly: false,
        });
      }
    }
  }

  return { classes, methodEntities, propertyEntities, hasMethodEdges, hasPropertyEdges };
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

// ============================================================================
// Plugin Export (via generic factory)
// ============================================================================

export const pythonPlugin = createLanguagePlugin({
  id: 'python',
  displayName: 'Python',
  extensions: ['.py', '.pyw', '.pyi'],
  grammar: Python,
  nodeTypes: {
    functions: ['function_definition'],
    classes: ['class_definition'],
    imports: ['import_statement', 'import_from_statement'],
    calls: ['call'],
  },
  overrides: {
    extractFunctions,
    extractClasses,
    extractVariables,
    extractImports,
    builtinFunctions: PYTHON_BUILTINS,
    // extractCalls — uses generic (call → function field, identifier + attribute types)
    // extractInheritance — uses generic (derives from ClassEntity.extends)
  },
});

// Re-export all extractors for backward compatibility
export const extractInheritance = pythonPlugin.extractors.extractInheritance;
export const extractCalls = pythonPlugin.extractors.extractCalls!;

/**
 * Extract all entities from a Python AST, including HAS_METHOD and HAS_PROPERTY
 * edge descriptors produced by extractClassesWithEdges.
 *
 * Overrides the generic factory's extractAllEntities so the edge fields are populated.
 * The pipeline picks them up automatically via ParsedFileEntities.
 *
 * Function entities appear in two forms:
 *  - generateEntityId style (from extractFunctions) — targets for CALLS/CONTAINS edges
 *  - ::method:: style (from extractClassesWithEdges) — targets for HAS_METHOD edges
 * This matches the TypeScript plugin's pattern.
 */
export function extractAllEntities(root: SyntaxNode, filePath: string) {
  const allFunctions = extractFunctions(root, filePath);
  const classExtraction = extractClassesWithEdges(root, filePath);

  return {
    // Merge: generateEntityId-style functions + ::method:: entities from class extraction
    functions: [...allFunctions, ...classExtraction.methodEntities],
    classes: classExtraction.classes,
    interfaces: [],
    variables: [
      ...extractVariables(root, filePath),
      ...classExtraction.propertyEntities,
    ],
    imports: extractImports(root, filePath),
    types: [],
    components: [],
    hasMethodEdges: classExtraction.hasMethodEdges,
    hasPropertyEdges: classExtraction.hasPropertyEdges,
  };
}
