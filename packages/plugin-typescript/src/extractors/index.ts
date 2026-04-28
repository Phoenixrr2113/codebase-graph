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
  HasMethodEdgeDescriptor,
  HasPropertyEdgeDescriptor,
  HasParamEdgeDescriptor,
  ReturnsEdgeDescriptor,
  UsesTypeEdgeDescriptor,
  TypeRefEntity,
} from '@codegraph/types';

// Re-export individual extractors (still available for standalone use)
export { extractImports, extractImportsFromNodes } from './imports';
export { extractFunctions, extractFunctionsFromNodes, extractFunctionsWithNodes } from './functions';
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
import { extractFunctionsFromNodes, extractFunctionsWithNodes } from './functions';
import { extractClassesWithEdgesFromNodes } from './classes';
import { extractVariablesFromNodes } from './variables';
import { extractTypesFromNodes, extractInterfacesFromNodes } from './type-aliases';
import { extractComponentsFromNodes } from './jsx';
import { extractTypeRefsForFunction } from './type-refs';

/** Combined result of all entity extraction */
export interface ExtractedEntities {
  imports: ImportEntity[];
  functions: FunctionEntity[];
  classes: ClassEntity[];
  variables: VariableEntity[];
  types: TypeEntity[];
  interfaces: InterfaceEntity[];
  components: ComponentEntity[];
  hasMethodEdges: HasMethodEdgeDescriptor[];
  hasPropertyEdges: HasPropertyEdgeDescriptor[];
  typeRefs: TypeRefEntity[];
  hasParamEdges: HasParamEdgeDescriptor[];
  returnsEdges: ReturnsEdgeDescriptor[];
  usesTypeEdges: UsesTypeEdgeDescriptor[];
}

/** All node types we need to collect in a single walk */
const ALL_ENTITY_NODE_TYPES = [
  // Imports
  'import_statement',
  // Functions
  'function_declaration', 'function_expression', 'arrow_function',
  'method_definition', 'generator_function_declaration',
  // Classes
  'class_declaration', 'abstract_class_declaration', 'class',
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

  // method_definition nodes are excluded from the function extractor — class methods
  // are owned by extractClassesWithEdgesFromNodes, which emits them with
  // generateEntityId-format ids that match this extractor's id format. Adding
  // method_definition here would produce duplicate Function entities for the same
  // source method (same name/filePath/startLine natural key) and cause HAS_METHOD
  // edge toIds to mismatch the persisted node id after MERGE.
  const functionNodes = [
    ...(nodesByType.get('function_declaration') ?? []),
    ...(nodesByType.get('function_expression') ?? []),
    ...(nodesByType.get('arrow_function') ?? []),
    ...(nodesByType.get('generator_function_declaration') ?? []),
  ];

  const functions = extractFunctionsFromNodes(functionNodes, filePath);

  // Top-level function nodes paired with their entities, used for type-ref edge emission.
  // method_definition nodes are handled via classExtraction.methodEntities (see below).
  const topLevelFunctionPairs = extractFunctionsWithNodes(functionNodes, filePath);

  // extractClassesWithEdgesFromNodes returns class entities + method Function entities +
  // property Variable entities + HAS_METHOD / HAS_PROPERTY edge descriptors in one pass.
  const classExtraction = extractClassesWithEdgesFromNodes([
    ...(nodesByType.get('class_declaration') ?? []),
    ...(nodesByType.get('abstract_class_declaration') ?? []),
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

  // Merge method Function entities and property Variable entities from class extraction
  // into the top-level entity arrays so they get upserted into the graph as full nodes.
  const allFunctions = [...functions, ...classExtraction.methodEntities];
  const allVariables = [...variables, ...classExtraction.propertyEntities];

  // ── Type-relationship edges (HAS_PARAM / RETURNS / USES_TYPE) ──────────────
  // The single walk already collected all method_definition nodes. We use those
  // directly for class methods instead of re-walking the tree.
  const typeRefMap = new Map<string, TypeRefEntity>();
  const allHasParamEdges: HasParamEdgeDescriptor[] = [];
  const allReturnsEdges: ReturnsEdgeDescriptor[] = [];
  const allUsesTypeEdges: UsesTypeEdgeDescriptor[] = [];

  function accumulateTypeRefs(node: Parser.SyntaxNode, entityId: string): void {
    const result = extractTypeRefsForFunction(node, entityId, filePath);
    for (const ref of result.typeRefs) {
      if (!typeRefMap.has(ref.id)) typeRefMap.set(ref.id, ref);
    }
    allHasParamEdges.push(...result.hasParamEdges);
    allReturnsEdges.push(...result.returnsEdges);
    allUsesTypeEdges.push(...result.usesTypeEdges);
  }

  // Top-level functions (non-methods): pairs are correctly aligned.
  for (const { node, entity } of topLevelFunctionPairs) {
    if (!entity.id) continue;
    accumulateTypeRefs(node, entity.id);
  }

  // Class methods: match AST nodes from the already-collected method_definition bucket.
  const methodDefinitionNodes = nodesByType.get('method_definition') ?? [];
  for (const methodEntity of classExtraction.methodEntities) {
    if (!methodEntity.id) continue;
    const astNode = methodDefinitionNodes.find(
      n =>
        n.startPosition.row + 1 === methodEntity.startLine &&
        n.childForFieldName('name')?.text === methodEntity.name,
    );
    if (!astNode) continue;
    accumulateTypeRefs(astNode, methodEntity.id);
  }

  return {
    imports,
    functions: allFunctions,
    classes: classExtraction.classes,
    variables: allVariables,
    types,
    interfaces,
    components,
    hasMethodEdges: classExtraction.hasMethodEdges,
    hasPropertyEdges: classExtraction.hasPropertyEdges,
    typeRefs: Array.from(typeRefMap.values()),
    hasParamEdges: allHasParamEdges,
    returnsEdges: allReturnsEdges,
    usesTypeEdges: allUsesTypeEdges,
  };
}
