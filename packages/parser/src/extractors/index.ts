/**
 * Entity Extractors Index
 * Aggregates all entity extraction functions
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

// Re-export individual extractors
export { extractImports } from './imports';
export { extractFunctions } from './functions';
export { extractClasses } from './classes';
export { extractVariables } from './variables';
export { extractTypes, extractInterfaces } from './type-aliases';
export { extractComponents } from './jsx';
export { extractCalls } from './calls';
export { extractRenders } from './renders';
export { extractInheritance } from './inheritance';
export type { CallReference } from './calls';
export type { RenderReference } from './renders';
export type { ExtendsReference, ImplementsReference, InheritanceResult } from './inheritance';

// Re-export utility types and functions
export { getLocation, findNodesOfType, generateEntityId } from './types';
export type { SourceLocation } from './types';

// Import for the combined extractor
import { extractImports } from './imports';
import { extractFunctions } from './functions';
import { extractClasses } from './classes';
import { extractVariables } from './variables';
import { extractTypes, extractInterfaces } from './type-aliases';
import { extractComponents } from './jsx';
// Note: extractCalls/extractRenders are re-exported above, used directly by parseService

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

/**
 * Extract all entities from a syntax tree
 * 
 * @param rootNode - Root node of the syntax tree
 * @param filePath - Path to the source file
 * @returns All extracted entities grouped by type
 */
export function extractAllEntities(
  rootNode: Parser.SyntaxNode,
  filePath: string
): ExtractedEntities {
  return {
    imports: extractImports(rootNode, filePath),
    functions: extractFunctions(rootNode, filePath),
    classes: extractClasses(rootNode, filePath),
    variables: extractVariables(rootNode, filePath),
    types: extractTypes(rootNode, filePath),
    interfaces: extractInterfaces(rootNode, filePath),
    components: extractComponents(rootNode, filePath),
  };
}
