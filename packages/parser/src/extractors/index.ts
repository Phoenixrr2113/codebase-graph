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
export { extractImports } from './imports.js';
export { extractFunctions } from './functions.js';
export { extractClasses } from './classes.js';
export { extractVariables } from './variables.js';
export { extractTypes, extractInterfaces } from './type-aliases.js';
export { extractComponents } from './jsx.js';
export { extractCalls } from './calls.js';
export { extractRenders } from './renders.js';
export type { CallReference } from './calls.js';
export type { RenderReference } from './renders.js';

// Re-export utility types and functions
export { getLocation, findNodesOfType, generateEntityId } from './types.js';
export type { SourceLocation } from './types.js';

// Import for the combined extractor
import { extractImports } from './imports.js';
import { extractFunctions } from './functions.js';
import { extractClasses } from './classes.js';
import { extractVariables } from './variables.js';
import { extractTypes, extractInterfaces } from './type-aliases.js';
import { extractComponents } from './jsx.js';
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
