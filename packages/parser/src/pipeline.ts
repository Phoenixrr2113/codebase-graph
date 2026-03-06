/**
 * @codegraph/parser - Extraction Pipeline
 *
 * Shared extraction pipeline used by all consumers (API, CLI, MCP server).
 * Provides language-aware entity extraction, complexity enrichment, and
 * builds the complete ParsedFileEntities structure for graph persistence.
 */

import Parser from 'tree-sitter';
import type { FileEntity, FunctionEntity, ParsedFileEntities } from '@codegraph/types';
import { extractAllEntities, type ExtractedEntities } from './extractors';
import { extractCalls } from './extractors/calls';
import { extractRenders } from './extractors/renders';
import { extractInheritance } from './extractors/inheritance';
import { calculateComplexity } from './analysis/complexity';
import {
  extractFunctions as extractPythonFunctions,
  extractClasses as extractPythonClasses,
  extractImports as extractPythonImports,
  extractVariables as extractPythonVariables,
  extractInheritance as extractPythonInheritance,
  extractCalls as extractPythonCalls,
  resolvePythonImport,
} from '@codegraph/plugin-python';
import {
  extractFunctions as extractCSharpFunctions,
  extractClasses as extractCSharpClasses,
  extractInterfaces as extractCSharpInterfaces,
  extractVariables as extractCSharpVariables,
  extractImports as extractCSharpImports,
  extractTypes as extractCSharpTypes,
  extractInheritance as extractCSharpInheritance,
  extractCalls as extractCSharpCalls,
} from '@codegraph/plugin-csharp';
import { stat, readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { createHash } from 'node:crypto';

// ============================================================================
// Constants
// ============================================================================

/** Supported file extensions for parsing */
export const SUPPORTED_EXTENSIONS: readonly string[] = [
  // TypeScript/JavaScript
  '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs',
  // Python
  '.py', '.pyw', '.pyi',
  // C#
  '.cs',
];

/** Python file extensions */
export const PYTHON_EXTENSIONS: readonly string[] = ['.py', '.pyw', '.pyi'];

/** C# file extensions */
export const CSHARP_EXTENSIONS: readonly string[] = ['.cs'];

/** Default glob patterns to ignore during parsing and watching */
export const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/coverage/**',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/__tests__/**',
  '**/__mocks__/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/__pycache__/**',
  '**/.venv/**',
  '**/venv/**',
  '**/*.pyc',
];

// ============================================================================
// Language Detection
// ============================================================================

/** Check if file is a Python file */
export function isPythonFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return PYTHON_EXTENSIONS.includes(ext);
}

/** Check if file is a C# file */
export function isCSharpFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase();
  return CSHARP_EXTENSIONS.includes(ext);
}

/** Get the language category for a file */
export function getLanguageCategory(filePath: string): 'typescript' | 'python' | 'csharp' | 'unknown' {
  if (isPythonFile(filePath)) return 'python';
  if (isCSharpFile(filePath)) return 'csharp';
  const ext = extname(filePath).toLowerCase();
  if (['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'].includes(ext)) return 'typescript';
  return 'unknown';
}

// ============================================================================
// File Entity Creation
// ============================================================================

/**
 * Create a FileEntity from a file on disk.
 * Reads the file to compute hash, LOC, and mtime.
 */
export async function createFileEntity(filePath: string): Promise<FileEntity> {
  const fileStat = await stat(filePath);
  const content = await readFile(filePath, 'utf-8');
  const loc = content.split('\n').length;
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 16);

  return {
    path: filePath,
    name: basename(filePath),
    extension: extname(filePath).slice(1), // Remove leading dot
    loc,
    lastModified: fileStat.mtime.toISOString(),
    hash,
  };
}

// ============================================================================
// Language-Aware Entity Extraction
// ============================================================================

/**
 * Extract entities from a parsed file's AST, dispatching to the correct
 * language plugin based on file extension.
 */
export function extractEntitiesForFile(
  rootNode: Parser.SyntaxNode,
  filePath: string,
): ExtractedEntities {
  if (isPythonFile(filePath)) {
    return {
      functions: extractPythonFunctions(rootNode as any, filePath),
      classes: extractPythonClasses(rootNode as any, filePath),
      variables: extractPythonVariables(rootNode as any, filePath),
      imports: extractPythonImports(rootNode as any, filePath),
      interfaces: [],
      types: [],
      components: [],
    };
  }

  if (isCSharpFile(filePath)) {
    return {
      functions: extractCSharpFunctions(rootNode as any, filePath),
      classes: extractCSharpClasses(rootNode as any, filePath),
      interfaces: extractCSharpInterfaces(rootNode as any, filePath),
      variables: extractCSharpVariables(rootNode as any, filePath),
      imports: extractCSharpImports(rootNode as any, filePath),
      types: extractCSharpTypes(rootNode as any, filePath),
      components: [],
    };
  }

  // TypeScript/JavaScript — use built-in extractors
  return extractAllEntities(rootNode, filePath);
}

// ============================================================================
// Complexity Enrichment
// ============================================================================

/** Node types that represent function declarations */
const FUNCTION_TYPES = [
  'function_declaration',
  'function_expression',
  'arrow_function',
  'method_definition',
  'generator_function_declaration',
];

/**
 * Calculate and attach complexity metrics to all functions in extracted entities.
 * Walks the AST to find function nodes and matches them by startLine.
 * Mutates the function entities in place.
 */
export function enrichFunctionsWithComplexity(
  rootNode: Parser.SyntaxNode,
  functions: FunctionEntity[],
): void {
  // Build a map of startLine -> function entity for quick lookup
  const functionsByLine = new Map<number, FunctionEntity>();
  for (const fn of functions) {
    functionsByLine.set(fn.startLine, fn);
  }

  // Walk the AST to find function nodes
  function walk(node: Parser.SyntaxNode): void {
    if (FUNCTION_TYPES.includes(node.type)) {
      const startLine = node.startPosition.row + 1; // Convert to 1-indexed
      const functionEntity = functionsByLine.get(startLine);
      if (functionEntity) {
        const metrics = calculateComplexity(node);
        functionEntity.complexity = metrics.cyclomatic;
        functionEntity.cognitiveComplexity = metrics.cognitive;
        functionEntity.nestingDepth = metrics.nestingDepth;
      }
    }
    for (const child of node.children) {
      walk(child);
    }
  }

  walk(rootNode);
}

// ============================================================================
// Build ParsedFileEntities
// ============================================================================

/** Options for the extraction pipeline */
export interface PipelineOptions {
  deepAnalysis?: boolean;
  includeExternals?: boolean;
}

/**
 * Build the complete ParsedFileEntities structure from extracted entities.
 * Resolves imports, inheritance, calls, and renders into edge arrays
 * ready for graph persistence via batchUpsert().
 */
export function buildParsedFileEntities(
  file: FileEntity,
  extracted: ExtractedEntities,
  rootNode?: Parser.SyntaxNode,
  options: PipelineOptions = {},
  projectRoot?: string,
): ParsedFileEntities {
  const { deepAnalysis = false, includeExternals = false } = options;

  // Enrich functions with complexity metrics if AST is available
  if (rootNode) {
    enrichFunctionsWithComplexity(rootNode, extracted.functions);
  }

  // --- Import edges ---
  let importsEdges: ParsedFileEntities['importsEdges'] = [];

  if (isPythonFile(file.path) && projectRoot) {
    for (const imp of extracted.imports) {
      const resolvedPath = resolvePythonImport(imp.source, file.path, projectRoot);
      if (resolvedPath) {
        importsEdges.push({
          fromFilePath: file.path,
          toFilePath: resolvedPath,
          specifiers: imp.specifiers.map((s) => s.name),
        });
      }
    }
  } else if (isCSharpFile(file.path)) {
    for (const imp of extracted.imports) {
      importsEdges.push({
        fromFilePath: file.path,
        toFilePath: `external:${imp.source}`,
        specifiers: imp.specifiers.map((s) => s.name),
      });
    }
  } else {
    importsEdges = extracted.imports
      .filter((imp) => imp.resolvedPath)
      .map((imp) => ({
        fromFilePath: file.path,
        toFilePath: imp.resolvedPath!,
        specifiers: imp.specifiers.map((s) => s.name),
      }));
  }

  // --- Extends / Implements edges ---
  let extendsEdges: ParsedFileEntities['extendsEdges'] = [];
  let implementsEdges: ParsedFileEntities['implementsEdges'] = [];

  if (isPythonFile(file.path)) {
    const inheritanceRefs = extractPythonInheritance(rootNode as any, file.path);
    for (const ref of inheritanceRefs) {
      const cls = extracted.classes.find((c) => c.name === ref.childName);
      if (cls) {
        extendsEdges.push({
          childId: `Class:${file.path}:${cls.name}:${cls.startLine}`,
          parentId: `Class:external:${ref.parentName}`,
        });
      }
    }
  } else if (isCSharpFile(file.path)) {
    const inheritanceRefs = extractCSharpInheritance(rootNode as any, file.path);
    for (const ref of inheritanceRefs) {
      const cls = extracted.classes.find((c) => c.name === ref.childName);
      const iface = extracted.interfaces.find((i) => i.name === ref.childName);

      if (ref.type === 'extends') {
        if (cls) {
          extendsEdges.push({
            childId: `Class:${file.path}:${cls.name}:${cls.startLine}`,
            parentId: `Class:external:${ref.parentName}`,
          });
        } else if (iface) {
          extendsEdges.push({
            childId: `Interface:${file.path}:${iface.name}:${iface.startLine}`,
            parentId: `Interface:external:${ref.parentName}`,
          });
        }
      } else if (ref.type === 'implements' && cls) {
        implementsEdges.push({
          classId: `Class:${file.path}:${cls.name}:${cls.startLine}`,
          interfaceId: `Interface:external:${ref.parentName}`,
        });
      }
    }
  } else {
    // TypeScript/JavaScript
    const inheritance = extractInheritance(
      file.path,
      extracted.classes,
      extracted.interfaces,
      extracted.imports,
      includeExternals,
    );

    extendsEdges = inheritance.extends.map((ext) => ({
      childId: `Class:${ext.childFilePath}:${ext.childName}:${ext.childStartLine}`,
      parentId: ext.parentFilePath
        ? `Class:${ext.parentFilePath}:${ext.parentName}`
        : `Class:external:${ext.parentName}`,
    }));

    implementsEdges = inheritance.implements.map((impl) => ({
      classId: `Class:${impl.classFilePath}:${impl.className}:${impl.classStartLine}`,
      interfaceId: impl.interfaceFilePath
        ? `Interface:${impl.interfaceFilePath}:${impl.interfaceName}`
        : `Interface:external:${impl.interfaceName}`,
    }));
  }

  // --- Call edges (deep analysis only) ---
  let callEdges: ParsedFileEntities['callEdges'] = [];
  if (deepAnalysis && rootNode) {
    if (isPythonFile(file.path)) {
      const pythonCalls = extractPythonCalls(
        rootNode as unknown as import('@codegraph/types').SyntaxNode,
        file.path,
      );
      callEdges = pythonCalls.map((call) => ({
        callerId: `Function:${call.filePath}:${call.callerName}`,
        calleeId: `Function:${call.filePath}:${call.calleeName}`,
        line: call.line,
      }));
    } else if (isCSharpFile(file.path)) {
      const csharpCalls = extractCSharpCalls(
        rootNode as unknown as import('@codegraph/types').SyntaxNode,
        file.path,
      );
      callEdges = csharpCalls.map((call) => ({
        callerId: `Function:${call.filePath}:${call.callerName}`,
        calleeId: `Function:${call.filePath}:${call.calleeName}`,
        line: call.line,
      }));
    } else {
      const calls = extractCalls(
        rootNode,
        file.path,
        extracted.functions,
        extracted.imports,
        includeExternals,
      );
      callEdges = calls.map((call) => ({
        callerId: `Function:${call.callerFilePath}:${call.callerName}`,
        calleeId: call.calleeFilePath
          ? `Function:${call.calleeFilePath}:${call.calleeName}`
          : `Function:external:${call.calleeName}`,
        line: call.line,
      }));
    }
  }

  // --- Render edges (deep analysis only, TS/JS components) ---
  let rendersEdges: ParsedFileEntities['rendersEdges'] = [];
  if (deepAnalysis && rootNode) {
    const renders = extractRenders(
      rootNode,
      file.path,
      extracted.components,
      extracted.imports,
      includeExternals,
    );
    rendersEdges = renders.map((render) => ({
      parentId: `Component:${render.parentFilePath}:${render.parentName}`,
      childId: render.childFilePath
        ? `Component:${render.childFilePath}:${render.childName}`
        : `Component:external:${render.childName}`,
      line: render.line,
    }));
  }

  return {
    file,
    functions: extracted.functions,
    classes: extracted.classes,
    interfaces: extracted.interfaces,
    variables: extracted.variables,
    types: extracted.types,
    components: extracted.components,
    imports: extracted.imports,
    callEdges,
    importsEdges,
    extendsEdges,
    implementsEdges,
    rendersEdges,
  };
}

// ============================================================================
// Counting Helpers
// ============================================================================

/** Count total entities in an extracted result */
export function countEntities(extracted: ExtractedEntities): number {
  return (
    extracted.imports.length +
    extracted.functions.length +
    extracted.classes.length +
    extracted.variables.length +
    extracted.types.length +
    extracted.interfaces.length +
    extracted.components.length
  );
}

/** Count total edges in a parsed file entities structure */
export function countEdges(parsed: ParsedFileEntities): number {
  return (
    parsed.callEdges.length +
    parsed.importsEdges.length +
    parsed.extendsEdges.length +
    parsed.implementsEdges.length +
    parsed.rendersEdges.length
  );
}
