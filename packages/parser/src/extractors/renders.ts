/**
 * Renders Extractor
 * Extracts JSX component render references from React components
 */

import Parser from 'tree-sitter';
import type { ComponentEntity, ImportEntity } from '@codegraph/types';
import { findNodesOfTypes } from './types.js';

/**
 * Represents a component render reference
 */
export interface RenderReference {
  /** Name of the parent component */
  parentName: string;
  /** File path of the parent component */
  parentFilePath: string;
  /** Name of the child component being rendered */
  childName: string;
  /** File path of the child component (undefined if external/unresolved) */
  childFilePath?: string;
  /** Line number of the render */
  line: number;
}

/**
 * Extract all component render references from a syntax tree
 * @param rootNode - Root node of the syntax tree
 * @param filePath - Path of the file being parsed
 * @param components - Components defined in this file
 * @param imports - Imports in this file (for cross-file resolution)
 * @param includeExternals - Whether to include unresolved external components
 */
export function extractRenders(
  rootNode: Parser.SyntaxNode,
  filePath: string,
  components: ComponentEntity[],
  imports: ImportEntity[],
  includeExternals: boolean = false
): RenderReference[] {
  const renders: RenderReference[] = [];

  // Build lookup maps
  const localComponents = new Map(components.map(c => [c.name, c]));
  const importedSymbols = buildImportMap(imports);

  // For each component, find JSX elements within its body
  const componentNodes = findNodesOfTypes(rootNode, [
    'function_declaration',
    'arrow_function',
    'function_expression',
  ]);

  for (const compNode of componentNodes) {
    const parentName = getComponentName(compNode);
    if (!parentName) continue;

    // Must be PascalCase (React component convention)
    if (!/^[A-Z]/.test(parentName)) continue;

    // Check if this function returns JSX
    if (!hasJsxReturn(compNode)) continue;

    // Find the function body
    const body = compNode.childForFieldName('body');
    if (!body) continue;

    // Find all JSX elements
    const jsxNodes = findNodesOfTypes(body, [
      'jsx_element',
      'jsx_self_closing_element',
    ]);

    // Track seen children to avoid duplicates
    const seenChildren = new Set<string>();

    for (const jsxNode of jsxNodes) {
      const childInfo = parseJsxElement(jsxNode);
      if (!childInfo) continue;

      const { childName, line } = childInfo;

      // Skip if already recorded this child
      if (seenChildren.has(childName)) continue;
      seenChildren.add(childName);

      // Skip self-references
      if (childName === parentName) continue;

      // Try to resolve the child component
      let childFilePath: string | undefined;

      // Check if it's a local component
      if (localComponents.has(childName)) {
        childFilePath = filePath;
      }
      // Check if it's an imported component
      else if (importedSymbols.has(childName)) {
        childFilePath = importedSymbols.get(childName);
      }

      // Skip external components unless requested
      if (!childFilePath && !includeExternals) {
        continue;
      }

      // Build the render reference (only set childFilePath if defined)
      const renderRef: RenderReference = {
        parentName,
        parentFilePath: filePath,
        childName,
        line,
      };
      if (childFilePath) {
        renderRef.childFilePath = childFilePath;
      }

      renders.push(renderRef);
    }
  }

  return renders;
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

    // Named imports
    for (const spec of imp.specifiers) {
      const localName = spec.alias || spec.name;
      map.set(localName, imp.resolvedPath);
    }
  }

  return map;
}

/**
 * Get the name of a component from its node
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
 * Check if a function returns JSX
 */
function hasJsxReturn(node: Parser.SyntaxNode): boolean {
  const body = node.childForFieldName('body');
  if (!body) return false;

  // Direct JSX element (arrow function with implicit return)
  if (body.type === 'jsx_element' ||
    body.type === 'jsx_self_closing_element' ||
    body.type === 'jsx_fragment') {
    return true;
  }

  // Look for JSX in body
  const jsxNodes = findNodesOfTypes(body, [
    'jsx_element',
    'jsx_self_closing_element',
    'jsx_fragment',
  ]);

  return jsxNodes.length > 0;
}

/**
 * Parse a JSX element node to extract component info
 */
function parseJsxElement(node: Parser.SyntaxNode): { childName: string; line: number } | null {
  let nameNode: Parser.SyntaxNode | null = null;

  if (node.type === 'jsx_element') {
    // Get opening tag
    const openTag = node.children.find(c => c.type === 'jsx_opening_element');
    if (openTag) {
      nameNode = openTag.children.find(c =>
        c.type === 'identifier' || c.type === 'member_expression'
      ) ?? null;
    }
  } else if (node.type === 'jsx_self_closing_element') {
    nameNode = node.children.find(c =>
      c.type === 'identifier' || c.type === 'member_expression'
    ) ?? null;
  }

  if (!nameNode) return null;

  let childName: string;

  if (nameNode.type === 'identifier') {
    childName = nameNode.text;
  } else if (nameNode.type === 'member_expression') {
    // e.g., Icons.Check -> use the whole expression
    childName = nameNode.text;
  } else {
    return null;
  }

  // Skip HTML elements (lowercase)
  if (/^[a-z]/.test(childName)) {
    return null;
  }

  return {
    childName,
    line: node.startPosition.row + 1,
  };
}
