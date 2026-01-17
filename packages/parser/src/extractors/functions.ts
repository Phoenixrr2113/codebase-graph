/**
 * Function Entity Extractor
 * Extracts function/method declarations from TypeScript/JavaScript AST
 */

import Parser from 'tree-sitter';
import type { FunctionEntity, FunctionParam } from '@codegraph/types';
import { findNodesOfTypes, getLocation, generateEntityId } from './types';

/** Node types that represent function declarations */
const FUNCTION_TYPES = [
  'function_declaration',
  'function_expression',
  'arrow_function',
  'method_definition',
  'generator_function_declaration',
];

/**
 * Extract all function entities from a syntax tree
 */
export function extractFunctions(
  rootNode: Parser.SyntaxNode,
  filePath: string
): FunctionEntity[] {
  const functions: FunctionEntity[] = [];
  
  const functionNodes = findNodesOfTypes(rootNode, FUNCTION_TYPES);
  
  for (const node of functionNodes) {
    const functionEntity = parseFunctionNode(node, filePath);
    if (functionEntity) {
      functions.push(functionEntity);
    }
  }
  
  return functions;
}

/**
 * Parse a function node into a FunctionEntity
 */
function parseFunctionNode(
  node: Parser.SyntaxNode,
  filePath: string
): FunctionEntity | null {
  // Get function name
  const name = getFunctionName(node);
  if (!name) return null; // Skip anonymous functions without name
  
  const location = getLocation(node);
  const isExported = checkIsExported(node);
  const isAsync = checkIsAsync(node);
  const isArrow = node.type === 'arrow_function';
  const isGenerator = node.type === 'generator_function_declaration' ||
    node.type.includes('generator');
  
  const params = extractParameters(node);
  const returnType = getReturnType(node);
  const docstring = getDocstring(node);
  
  const id = generateEntityId(filePath, 'function', name, location.startLine);
  
  // Build entity with optional properties only when defined
  const entity: FunctionEntity = {
    id,
    name,
    filePath,
    startLine: location.startLine,
    endLine: location.endLine,
    isExported,
    isAsync,
    isArrow,
    params,
  };
  
  if (isGenerator) entity.isGenerator = isGenerator;
  if (returnType) entity.returnType = returnType;
  if (docstring) entity.docstring = docstring;
  
  return entity;
}

/**
 * Get the name of a function from various node types
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
 * Check if the function is exported
 */
function checkIsExported(node: Parser.SyntaxNode): boolean {
  let current = node.parent;
  while (current) {
    if (current.type === 'export_statement') return true;
    if (current.type === 'lexical_declaration' ||
        current.type === 'variable_declaration') {
      const grandParent = current.parent;
      if (grandParent?.type === 'export_statement') return true;
    }
    current = current.parent;
  }
  return false;
}

/**
 * Check if the function is async
 */
function checkIsAsync(node: Parser.SyntaxNode): boolean {
  // Check for async keyword in children
  for (const child of node.children) {
    if (child.text === 'async') return true;
  }
  
  // Check parent for arrow functions in async context
  if (node.type === 'arrow_function') {
    const parent = node.parent;
    if (parent) {
      for (const sibling of parent.children) {
        if (sibling.text === 'async') return true;
      }
    }
  }
  
  return false;
}

/**
 * Extract function parameters
 */
function extractParameters(node: Parser.SyntaxNode): FunctionParam[] {
  const params: FunctionParam[] = [];
  
  // Find formal_parameters node
  const parametersNode = node.childForFieldName('parameters');
  if (!parametersNode) return params;
  
  for (const child of parametersNode.children) {
    const param = parseParameter(child);
    if (param) {
      params.push(param);
    }
  }
  
  return params;
}

/**
 * Parse a single parameter
 */
function parseParameter(node: Parser.SyntaxNode): FunctionParam | null {
  // Skip punctuation
  if (node.type === ',' || node.type === '(' || node.type === ')') {
    return null;
  }
  
  let name: string | undefined;
  let type: string | undefined;
  let optional = false;
  let defaultValue: string | undefined;
  let isRest = false;
  
  if (node.type === 'identifier') {
    name = node.text;
  } else if (node.type === 'required_parameter' ||
             node.type === 'optional_parameter') {
    const pattern = node.childForFieldName('pattern');
    name = pattern?.text;
    optional = node.type === 'optional_parameter';
    
    const typeAnnotation = node.childForFieldName('type');
    type = typeAnnotation?.text?.replace(/^:\s*/, '');
    
    const value = node.childForFieldName('value');
    defaultValue = value?.text;
  } else if (node.type === 'rest_pattern') {
    isRest = true;
    // First child after ... is the identifier
    for (const child of node.children) {
      if (child.type === 'identifier') {
        name = child.text;
        break;
      }
    }
  }
  
  if (!name) return null;
  
  // Build param with optional properties only when defined
  const param: FunctionParam = { name };
  if (type) param.type = type;
  if (optional) param.optional = optional;
  if (defaultValue) param.defaultValue = defaultValue;
  if (isRest) param.isRest = isRest;
  
  return param;
}

/**
 * Get return type annotation
 */
function getReturnType(node: Parser.SyntaxNode): string | undefined {
  const returnType = node.childForFieldName('return_type');
  return returnType?.text?.replace(/^:\s*/, '');
}

/**
 * Get JSDoc comment above the function
 */
function getDocstring(node: Parser.SyntaxNode): string | undefined {
  // Look for comment node immediately before this node
  const parent = node.parent;
  if (!parent) return undefined;
  
  const siblings = parent.children;
  const index = siblings.indexOf(node);
  
  if (index > 0) {
    const prevSibling = siblings[index - 1];
    if (prevSibling && prevSibling.type === 'comment' &&
        prevSibling.text.startsWith('/**')) {
      return prevSibling.text;
    }
  }
  
  return undefined;
}
