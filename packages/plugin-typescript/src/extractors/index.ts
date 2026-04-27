/**
 * Entity Extractors Index
 * Aggregates all entity extraction functions
 *
 * Performance: extractAllEntities uses a single-pass AST walk via collectNodesByType,
 * replacing the previous 9-10 separate tree traversals with one.
 */

import Parser from 'tree-sitter';
import type {
  ImportEntity,
  FunctionEntity,
  ClassEntity,
  VariableEntity,
  TypeEntity,
  InterfaceEntity,
  ComponentEntity,
} from '@codegraph/types';

// Re-export individual extractors (still available for standalone use)
export { extractImports, extractImportsFromNodes } from './imports';
export { extractFunctions, extractFunctionsFromNodes } from './functions';
export { extractClasses, extractClassesFromNodes, extractClassesWithEdges, extractClassesWithEdgesFromNodes } from './classes';
export type { ClassExtractionResult, HasMethodEdgeDescriptor, HasPropertyEdgeDescriptor, Visibility } from './classes';
export { extractVariables, extractVariablesFromNodes } from './variables';
export { extractTypes, extractInterfaces, extractTypesFromNodes, extractInterfacesFromNodes } from './type-aliases';
export { extractComponents, extractComponentsFromNodes } from './jsx';
export { extractCalls } from './calls';
export { extractRenders } from './renders';
export { extractInheritance } from './inheritance';
export type { CallReference } from './calls';
export type { RenderReference } from './renders';
export type { ExtendsReference, ImplementsReference, InheritanceResult } from './inheritance';

// Re-export utility types and functions
export { getLocation, findNodesOfType, generateEntityId, collectNodesByType } from './types';
export type { SourceLocation } from './types';

// Import for the combined single-pass extractor
import { collectNodesByType } from './types';
import { extractImportsFromNodes } from './imports';
import { extractFunctionsFromNodes } from './functions';
import { extractClassesFromNodes } from './classes';
import { extractVariablesFromNodes } from './variables';
import { extractTypesFromNodes, extractInterfacesFromNodes } from './type-aliases';
import { extractComponentsFromNodes } from './jsx';

/** Combined result of all entity extraction */
export interface ExtractedEntities {
  imports: ImportEntity[];
  functions: FunctionEntity[];
  classes: ClassEntity[];
  variables: VariableEntity[];
  types: TypeEntity[];
  interfaces: InterfaceEntity[];
  components: ComponentEntity[];
}

/** All node types we need to collect in a single walk */
const ALL_ENTITY_NODE_TYPES = [
  // Imports
  'import_statement',
  // Functions
  'function_declaration', 'function_expression', 'arrow_function',
  'method_definition', 'generator_function_declaration',
  // Classes
  'class_declaration', 'class',
  // Variables
  'variable_declaration', 'lexical_declaration',
  // Types
  'type_alias_declaration', 'enum_declaration',
  // Interfaces
  'interface_declaration',
];

/**
 * Extract all entities from a syntax tree using a single AST walk.
 *
 * Previous implementation did 9-10 separate tree traversals. This version
 * collects all relevant nodes in ONE walk, then processes each bucket.
 */
export function extractAllEntities(
  rootNode: Parser.SyntaxNode,
  filePath: string
): ExtractedEntities {
  // Single walk — collect all relevant nodes by type
  const nodesByType = collectNodesByType(rootNode, ALL_ENTITY_NODE_TYPES);

  // Process each bucket with the appropriate extractor (no additional tree walking)
  const imports = extractImportsFromNodes(
    nodesByType.get('import_statement') ?? [], filePath
  );

  const functions = extractFunctionsFromNodes([
    ...(nodesByType.get('function_declaration') ?? []),
    ...(nodesByType.get('function_expression') ?? []),
    ...(nodesByType.get('arrow_function') ?? []),
    ...(nodesByType.get('method_definition') ?? []),
    ...(nodesByType.get('generator_function_declaration') ?? []),
  ], filePath);

  const classes = extractClassesFromNodes([
    ...(nodesByType.get('class_declaration') ?? []),
    ...(nodesByType.get('class') ?? []),
  ], filePath);

  const variables = extractVariablesFromNodes([
    ...(nodesByType.get('variable_declaration') ?? []),
    ...(nodesByType.get('lexical_declaration') ?? []),
  ], filePath);

  const types = extractTypesFromNodes(
    nodesByType.get('type_alias_declaration') ?? [],
    nodesByType.get('enum_declaration') ?? [],
    filePath,
  );

  const interfaces = extractInterfacesFromNodes(
    nodesByType.get('interface_declaration') ?? [], filePath
  );

  // Component detection: check which functions return JSX (checks subtree only, not full walk)
  const components = extractComponentsFromNodes([
    ...(nodesByType.get('function_declaration') ?? []),
    ...(nodesByType.get('arrow_function') ?? []),
    ...(nodesByType.get('function_expression') ?? []),
  ], filePath);

  return { imports, functions, classes, variables, types, interfaces, components };
}
