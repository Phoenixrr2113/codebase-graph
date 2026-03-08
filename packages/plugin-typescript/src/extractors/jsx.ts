/**
 * JSX/React Component Entity Extractor
 * Extracts React component declarations from TypeScript/TSX AST
 */

import Parser from 'tree-sitter';
import type { ComponentEntity, ComponentProp } from '@codegraph/types';
import { findNodesOfTypes, getLocation, generateEntityId } from './types';

/**
 * Extract all React component entities from a syntax tree
 */
export function extractComponents(
  rootNode: Parser.SyntaxNode,
  filePath: string
): ComponentEntity[] {
  const components: ComponentEntity[] = [];
  
  // Find function declarations/expressions that return JSX
  const functionNodes = findNodesOfTypes(rootNode, [
    'function_declaration',
    'arrow_function',
    'function_expression',
  ]);
  
  for (const node of functionNodes) {
    if (isReactComponent(node)) {
      const component = parseComponent(node, filePath);
      if (component) {
        components.push(component);
      }
    }
  }
  
  return components;
}

/**
 * Check if a function is a React component (returns JSX)
 */
function isReactComponent(node: Parser.SyntaxNode): boolean {
  // Check if function body contains jsx_element or jsx_self_closing_element
  const body = node.childForFieldName('body');
  if (!body) return false;
  
  return hasJsxReturn(body);
}

/**
 * Check if a node tree contains JSX return
 */
function hasJsxReturn(node: Parser.SyntaxNode): boolean {
  // Direct JSX element (arrow function with implicit return)
  if (node.type === 'jsx_element' ||
      node.type === 'jsx_self_closing_element' ||
      node.type === 'jsx_fragment') {
    return true;
  }
  
  // Check children recursively
  for (const child of node.children) {
    // If we find a return statement with JSX
    if (child.type === 'return_statement') {
      for (const returnChild of child.children) {
        if (isJsxNode(returnChild)) {
          return true;
        }
      }
    }
    
    // Check nested JSX
    if (isJsxNode(child)) {
      return true;
    }
    
    // Recurse into blocks
    if (child.type === 'statement_block' ||
        child.type === 'parenthesized_expression') {
      if (hasJsxReturn(child)) return true;
    }
  }
  
  return false;
}

/**
 * Check if a node is a JSX node
 */
function isJsxNode(node: Parser.SyntaxNode): boolean {
  return node.type === 'jsx_element' ||
         node.type === 'jsx_self_closing_element' ||
         node.type === 'jsx_fragment';
}

/**
 * Parse a React component
 */
function parseComponent(
  node: Parser.SyntaxNode,
  filePath: string
): ComponentEntity | null {
  const name = getComponentName(node);
  if (!name) return null;
  
  // Check for PascalCase (React component convention)
  if (!/^[A-Z]/.test(name)) return null;
  
  const location = getLocation(node);
  const isExported = checkIsExported(node);
  const propsInfo = extractPropsInfo(node);
  
  const id = generateEntityId(filePath, 'component', name, location.startLine);
  
  // Build entity with optional properties only when defined
  const entity: ComponentEntity = {
    id,
    name,
    filePath,
    startLine: location.startLine,
    endLine: location.endLine,
    isExported,
  };
  
  if (propsInfo.props && propsInfo.props.length > 0) entity.props = propsInfo.props;
  if (propsInfo.propsType) entity.propsType = propsInfo.propsType;
  
  return entity;
}

/**
 * Get the name of a component
 */
function getComponentName(node: Parser.SyntaxNode): string | undefined {
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
 * Check if the component is exported
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
 * Extract props information from component
 */
function extractPropsInfo(node: Parser.SyntaxNode): {
  props?: ComponentProp[];
  propsType?: string;
} {
  const result: { props?: ComponentProp[]; propsType?: string } = {};
  
  // Look for parameters with type annotation
  const params = node.childForFieldName('parameters');
  if (!params) return result;
  
  const firstParam = params.children.find(c => 
    c.type === 'required_parameter' || 
    c.type === 'optional_parameter' ||
    c.type === 'identifier'
  );
  
  if (!firstParam) return result;
  
  // Look for type annotation
  const typeAnnotation = firstParam.childForFieldName('type');
  if (typeAnnotation) {
    // Get the type name (e.g., Props, FC<Props>, etc.)
    const typeText = typeAnnotation.text.replace(/^:\s*/, '');
    
    // Extract the props type name
    const match = typeText.match(/(?:React\.)?(?:FC|FunctionComponent)<([^>]+)>/);
    if (match && match[1]) {
      result.propsType = match[1].trim();
    } else if (!typeText.startsWith('{')) {
      result.propsType = typeText;
    }
  }
  
  // Look for destructured props in parameter pattern
  const pattern = firstParam.childForFieldName('pattern') || firstParam;
  if (pattern.type === 'object_pattern') {
    result.props = parseObjectPattern(pattern);
  }
  
  return result;
}

/**
 * Parse object pattern for props
 */
function parseObjectPattern(node: Parser.SyntaxNode): ComponentProp[] {
  const props: ComponentProp[] = [];
  
  for (const child of node.children) {
    if (child.type === 'shorthand_property_identifier_pattern' ||
        child.type === 'shorthand_property_identifier') {
      props.push({
        name: child.text,
        required: true,
      });
    } else if (child.type === 'pair_pattern' ||
               child.type === 'object_assignment_pattern') {
      const key = child.childForFieldName('left') || 
                  child.childForFieldName('key');
      if (key) {
        props.push({
          name: key.text,
          required: child.type === 'pair_pattern',
        });
      }
    }
  }
  
  return props;
}
