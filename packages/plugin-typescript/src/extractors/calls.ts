/**
 * Calls Extractor
 * Extracts function call references from TypeScript/JavaScript AST
 */

import Parser from 'tree-sitter';
import type { FunctionEntity, ImportEntity } from '@codegraph/types';
import { findNodesOfTypes } from './types';

/**
 * Represents a function call reference
 */
export interface CallReference {
  /** Name of the function containing the call */
  callerName: string;
  /** File path of the caller */
  callerFilePath: string;
  /** Name of the function being called */
  calleeName: string;
  /** File path of the callee (undefined if external/unresolved) */
  calleeFilePath?: string;
  /** Line number of the call */
  line: number;
}

/**
 * Extract all function call references from a syntax tree
 * @param rootNode - Root node of the syntax tree
 * @param filePath - Path of the file being parsed
 * @param functions - Functions defined in this file
 * @param imports - Imports in this file (for cross-file resolution)
 * @param includeExternals - Whether to include unresolved external calls
 */
export function extractCalls(
  rootNode: Parser.SyntaxNode,
  filePath: string,
  functions: FunctionEntity[],
  imports: ImportEntity[],
  includeExternals: boolean = false
): CallReference[] {
  const calls: CallReference[] = [];

  // Build lookup maps
  const localFunctions = new Map(functions.map(f => [f.name, f]));
  const importedSymbols = buildImportMap(imports);

  // For each function, find calls within its body
  const functionNodes = findNodesOfTypes(rootNode, [
    'function_declaration',
    'function_expression',
    'arrow_function',
    'method_definition',
  ]);

  for (const funcNode of functionNodes) {
    const callerName = getFunctionName(funcNode);
    if (!callerName) continue;

    // Find the function body
    const body = funcNode.childForFieldName('body');
    if (!body) continue;

    // Find all call_expression nodes within the body
    const callNodes = findNodesOfTypes(body, ['call_expression']);

    for (const callNode of callNodes) {
      const callInfo = parseCallExpression(callNode);
      if (!callInfo) continue;

      const { calleeName, line } = callInfo;

      // Try to resolve the callee
      let calleeFilePath: string | undefined;

      // Check if it's a local function
      if (localFunctions.has(calleeName)) {
        calleeFilePath = filePath;
      }
      // Check if it's an imported symbol
      else if (importedSymbols.has(calleeName)) {
        calleeFilePath = importedSymbols.get(calleeName);
      }

      // Skip external calls unless requested
      if (!calleeFilePath && !includeExternals) {
        continue;
      }

      // Build the call reference (only set calleeFilePath if defined)
      const callRef: CallReference = {
        callerName,
        callerFilePath: filePath,
        calleeName,
        line,
      };
      if (calleeFilePath) {
        callRef.calleeFilePath = calleeFilePath;
      }

      calls.push(callRef);
    }
  }

  return calls;
}

/**
 * Build a map of imported symbol names to their resolved file paths
 */
function buildImportMap(imports: ImportEntity[]): Map<string, string | undefined> {
  const map = new Map<string, string | undefined>();

  for (const imp of imports) {
    // Default import
    if (imp.isDefault && imp.defaultAlias) {
      map.set(imp.defaultAlias, imp.resolvedPath);
    }

    // Namespace import (* as X)
    if (imp.isNamespace && imp.namespaceAlias) {
      map.set(imp.namespaceAlias, imp.resolvedPath);
    }

    // Named imports
    for (const spec of imp.specifiers) {
      const localName = spec.alias || spec.name;
      map.set(localName, imp.resolvedPath);
    }
  }

  return map;
}

/**
 * Get the name of a function from its node
 */
function getFunctionName(node: Parser.SyntaxNode): string | undefined {
  // Direct name field
  const nameNode = node.childForFieldName('name');
  if (nameNode) return nameNode.text;

  // For arrow functions, look at parent variable declaration
  if (node.type === 'arrow_function') {
    const parent = node.parent;
    if (parent?.type === 'variable_declarator') {
      const varName = parent.childForFieldName('name');
      if (varName) return varName.text;
    }
  }

  return undefined;
}

/**
 * Parse a call_expression node to extract callee info
 */
function parseCallExpression(node: Parser.SyntaxNode): { calleeName: string; line: number } | null {
  const funcNode = node.childForFieldName('function');
  if (!funcNode) return null;

  let calleeName: string | undefined;

  // Simple identifier: foo()
  if (funcNode.type === 'identifier') {
    calleeName = funcNode.text;
  }
  // Member expression: obj.method() - extract the method name
  else if (funcNode.type === 'member_expression') {
    const property = funcNode.childForFieldName('property');
    if (property?.type === 'property_identifier') {
      calleeName = property.text;
    }
  }
  // Call expression chain: foo()() - skip these complex cases
  else if (funcNode.type === 'call_expression') {
    return null;
  }

  if (!calleeName) return null;

  // Skip built-in functions and common patterns
  if (isBuiltinOrCommon(calleeName)) {
    return null;
  }

  return {
    calleeName,
    line: node.startPosition.row + 1,
  };
}

/**
 * Check if a function name is a builtin or common utility to skip
 */
function isBuiltinOrCommon(name: string): boolean {
  const builtins = new Set([
    // Console
    'log', 'warn', 'error', 'info', 'debug', 'trace',
    // Common utilities
    'require', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite',
    // Array methods
    'map', 'filter', 'reduce', 'forEach', 'find', 'some', 'every',
    'push', 'pop', 'shift', 'unshift', 'slice', 'splice', 'concat',
    // String methods
    'split', 'join', 'trim', 'replace', 'match', 'includes', 'startsWith', 'endsWith',
    // Object methods
    'keys', 'values', 'entries', 'assign', 'freeze',
    // Promise
    'then', 'catch', 'finally', 'resolve', 'reject', 'all', 'race',
  ]);

  return builtins.has(name);
}
