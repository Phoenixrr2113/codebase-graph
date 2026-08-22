/**
 * Variable Entity Extractor
 * Extracts variable declarations from TypeScript/JavaScript AST
 */

import Parser from 'tree-sitter';
import type { VariableEntity, VariableKind } from '@codegraph/types';
import { findNodesOfTypes, symbolIdentityForNode } from './types';
import { buildLexicalScopeKey, occurrenceDisambiguator } from '@codegraph/plugin-common';

/** Node types for variable declarations */
const VARIABLE_TYPES = [
  'variable_declaration',
  'lexical_declaration',
];

/**
 * Extract all variable entities from a syntax tree
 */
export function extractVariables(
  rootNode: Parser.SyntaxNode,
  filePath: string
): VariableEntity[] {
  const declarationNodes = findNodesOfTypes(rootNode, VARIABLE_TYPES);
  return extractVariablesFromNodes(declarationNodes, filePath);
}

/**
 * Extract variables from pre-collected declaration nodes (single-pass mode)
 */
export function extractVariablesFromNodes(
  declarationNodes: Parser.SyntaxNode[],
  filePath: string
): VariableEntity[] {
  const candidates: Array<{
    node: Parser.SyntaxNode;
    name: string;
    kind: VariableKind;
    isExported: boolean;
    scopeKey: string;
  }> = [];

  for (const node of declarationNodes) {
    const kind = getVariableKind(node);
    const isExported = checkIsExported(node);
    for (const child of node.children) {
      if (child.type !== 'variable_declarator') continue;
      const nameNode = child.childForFieldName('name');
      if (!nameNode || nameNode.type === 'object_pattern' || nameNode.type === 'array_pattern') {
        continue;
      }
      candidates.push({
        node: child,
        name: nameNode.text,
        kind,
        isExported,
        scopeKey: buildLexicalScopeKey(child, { includeBlockScopes: true }),
      });
    }
  }

  const groupSizes = new Map<string, number>();
  for (const candidate of candidates) {
    const key = `${candidate.scopeKey}\u0000${candidate.name}`;
    groupSizes.set(key, (groupSizes.get(key) ?? 0) + 1);
  }
  const occurrences = new Map<string, number>();

  return candidates.flatMap((candidate) => {
    const key = `${candidate.scopeKey}\u0000${candidate.name}`;
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    const disambiguator = (groupSizes.get(key) ?? 0) > 1
      ? occurrenceDisambiguator(occurrence)
      : '';
    const entity = parseVariableDeclarator(
      candidate.node,
      filePath,
      candidate.kind,
      candidate.isExported,
      disambiguator,
    );
    return entity ? [entity] : [];
  });
}

/**
 * Get the kind of variable declaration
 */
function getVariableKind(node: Parser.SyntaxNode): VariableKind {
  // Look for the keyword child
  for (const child of node.children) {
    if (child.text === 'const') return 'const';
    if (child.text === 'let') return 'let';
    if (child.text === 'var') return 'var';
  }
  
  // Default based on node type
  if (node.type === 'lexical_declaration') {
    return 'const'; // or let, but default to const
  }
  return 'var';
}

/**
 * Check if the variable is exported
 */
function checkIsExported(node: Parser.SyntaxNode): boolean {
  const parent = node.parent;
  return parent?.type === 'export_statement';
}

/**
 * Parse a single variable declarator
 */
function parseVariableDeclarator(
  node: Parser.SyntaxNode,
  filePath: string,
  kind: VariableKind,
  isExported: boolean,
  disambiguator: string,
): VariableEntity | null {
  // Get the variable name
  const nameNode = node.childForFieldName('name');
  const name = nameNode?.text;
  if (!name) return null;
  
  // Skip object destructuring patterns for now
  if (nameNode.type === 'object_pattern' || nameNode.type === 'array_pattern') {
    return null;
  }
  
  const line = node.startPosition.row + 1;
  
  // Get type annotation if present
  const typeAnnotation = node.childForFieldName('type');
  const type = typeAnnotation?.text?.replace(/^:\s*/, '');
  
  const identity = symbolIdentityForNode({
    node,
    filePath,
    label: 'Variable',
    declaredName: name,
    disambiguator,
    includeBlockScopes: true,
  });
  
  // Build entity with optional properties only when defined
  const entity: VariableEntity = {
    ...identity,
    name,
    filePath,
    line,
    kind,
    isExported,
  };
  
  if (type) entity.type = type;
  
  return entity;
}
