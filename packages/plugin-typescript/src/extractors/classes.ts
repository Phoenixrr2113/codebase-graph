/**
 * Class Entity Extractor
 * Extracts class declarations from TypeScript/JavaScript AST
 */

import Parser from 'tree-sitter';
import type {
  ClassEntity,
  FunctionEntity,
  VariableEntity,
  FunctionParam,
  HasMethodEdgeDescriptor,
  HasPropertyEdgeDescriptor,
} from '@codegraph/types';
import { findNodesOfType, getLocation, generateEntityId } from './types';
import { calculateComplexity } from '@codegraph/plugin-common';

/** Visibility modifier */
export type Visibility = 'public' | 'private' | 'protected';

// Re-export shared descriptor types so consumers can import from this module
export type { HasMethodEdgeDescriptor, HasPropertyEdgeDescriptor };

/** Result of extractClassesWithEdges */
export interface ClassExtractionResult {
  classes: ClassEntity[];
  methodEntities: FunctionEntity[];
  propertyEntities: VariableEntity[];
  hasMethodEdges: HasMethodEdgeDescriptor[];
  hasPropertyEdges: HasPropertyEdgeDescriptor[];
}

/**
 * Compatibility wrapper — delegates to extractClassesWithEdges.
 * Returns only the Class entities (not method/property entities or edges).
 * @deprecated Use extractClassesWithEdges or extractAllEntities instead.
 */
export function extractClasses(
  rootNode: Parser.SyntaxNode,
  filePath: string
): ClassEntity[] {
  return extractClassesWithEdges(rootNode, filePath).classes;
}

/**
 * Compatibility wrapper — delegates to extractClassesWithEdgesFromNodes.
 * Returns only the Class entities (not method/property entities or edges).
 * @deprecated Use extractClassesWithEdgesFromNodes or extractAllEntities instead.
 */
export function extractClassesFromNodes(
  classNodes: Parser.SyntaxNode[],
  filePath: string
): ClassEntity[] {
  return extractClassesWithEdgesFromNodes(classNodes, filePath).classes;
}

/**
 * Extract classes along with their method/property entities and HAS_METHOD/HAS_PROPERTY edges.
 * Returns the same ClassEntity objects as extractClasses, plus Function entities for each method,
 * Variable entities for each property field, and edge descriptors connecting them.
 *
 * The inline Class.methods / Class.properties arrays are NOT populated here — ClassEntity type
 * does not define those fields; the edge graph IS the authoritative membership record.
 */
export function extractClassesWithEdges(
  rootNode: Parser.SyntaxNode,
  filePath: string
): ClassExtractionResult {
  const allClassNodes = [
    ...findNodesOfType(rootNode, 'class_declaration'),
    ...findNodesOfType(rootNode, 'abstract_class_declaration'),
    ...findNodesOfType(rootNode, 'class'),
  ];
  return extractClassesWithEdgesFromNodes(allClassNodes, filePath);
}

/**
 * Extract classes with edges from pre-collected class nodes (single-pass mode).
 */
export function extractClassesWithEdgesFromNodes(
  classNodes: Parser.SyntaxNode[],
  filePath: string
): ClassExtractionResult {
  const classes: ClassEntity[] = [];
  const methodEntities: FunctionEntity[] = [];
  const propertyEntities: VariableEntity[] = [];
  const hasMethodEdges: HasMethodEdgeDescriptor[] = [];
  const hasPropertyEdges: HasPropertyEdgeDescriptor[] = [];

  for (const node of classNodes) {
    const classEntity = parseClassNode(node, filePath);
    if (!classEntity) continue;
    classes.push(classEntity);

    // id is always set by parseClassNode via generateEntityId — guard for type safety
    const classId = classEntity.id;
    if (!classId) continue;

    // Walk the class body for method_definition and public_field_definition nodes
    const bodyNode = node.childForFieldName('body');
    if (!bodyNode) continue;

    // Track method name counts for duplicate overload detection
    const methodNameCount = new Map<string, number>();
    const propNameCount = new Map<string, number>();

    for (const member of bodyNode.children) {
      if (member.type === 'method_definition') {
        const methodName = member.childForFieldName('name')?.text;
        if (!methodName) continue;

        const count = methodNameCount.get(methodName) ?? 0;
        methodNameCount.set(methodName, count + 1);
        const suffix = count > 0 ? `:${count}` : '';

        const methodId = `${classId}::method::${methodName}${suffix}`;
        const location = getLocation(member);
        const isStatic = hasMemberModifier(member, 'static');
        const visibility = getMemberVisibility(member);
        const isAsync = hasMemberModifier(member, 'async');
        const params = extractMethodParameters(member);
        const returnType = getMethodReturnType(member);
        const metrics = calculateComplexity(member);

        const methodEntity: FunctionEntity = {
          id: methodId,
          name: methodName,
          filePath,
          startLine: location.startLine,
          endLine: location.endLine,
          isExported: classEntity.isExported,
          isAsync,
          isArrow: false,
          params,
          complexity: metrics.cyclomatic,
          cognitiveComplexity: metrics.cognitive,
          nestingDepth: metrics.nestingDepth,
        };
        if (returnType) methodEntity.returnType = returnType;

        methodEntities.push(methodEntity);
        hasMethodEdges.push({
          fromId: classId,
          toId: methodId,
          isStatic,
          visibility,
        });

      } else if (member.type === 'public_field_definition') {
        const propName = member.childForFieldName('name')?.text;
        if (!propName) continue;

        const count = propNameCount.get(propName) ?? 0;
        propNameCount.set(propName, count + 1);
        const suffix = count > 0 ? `:${count}` : '';

        const propId = `${classId}::prop::${propName}${suffix}`;
        const line = member.startPosition.row + 1;
        const isStatic = hasMemberModifier(member, 'static');
        const visibility = getMemberVisibility(member);
        const isReadonly = hasMemberModifier(member, 'readonly');

        // Extract type annotation
        const typeAnnotation = member.childForFieldName('type');
        const type = typeAnnotation?.text?.replace(/^:\s*/, '') ?? '';

        const propEntity: VariableEntity = {
          id: propId,
          name: propName,
          filePath,
          line,
          kind: 'const',
          isExported: classEntity.isExported,
        };
        if (type) propEntity.type = type;

        propertyEntities.push(propEntity);
        hasPropertyEdges.push({
          fromId: classId,
          toId: propId,
          isStatic,
          visibility,
          isReadonly,
        });
      }
    }
  }

  return { classes, methodEntities, propertyEntities, hasMethodEdges, hasPropertyEdges };
}

// ============================================================================
// Member AST helpers
// ============================================================================

/** Check if a class member node has the given modifier keyword */
function hasMemberModifier(node: Parser.SyntaxNode, modifier: string): boolean {
  for (const child of node.children) {
    if (child.text === modifier) return true;
  }
  return false;
}

/** Get the visibility of a class member (default 'public') */
function getMemberVisibility(node: Parser.SyntaxNode): Visibility {
  for (const child of node.children) {
    if (child.type === 'accessibility_modifier') {
      const text = child.text;
      if (text === 'private') return 'private';
      if (text === 'protected') return 'protected';
      return 'public';
    }
  }
  return 'public';
}

/** Extract parameters from a method_definition node */
function extractMethodParameters(node: Parser.SyntaxNode): FunctionParam[] {
  const params: FunctionParam[] = [];
  const parametersNode = node.childForFieldName('parameters');
  if (!parametersNode) return params;

  for (const child of parametersNode.children) {
    if (child.type === ',' || child.type === '(' || child.type === ')') continue;

    let name: string | undefined;
    let type: string | undefined;
    let optional = false;

    if (child.type === 'identifier') {
      name = child.text;
    } else if (child.type === 'required_parameter' || child.type === 'optional_parameter') {
      name = child.childForFieldName('pattern')?.text;
      optional = child.type === 'optional_parameter';
      type = child.childForFieldName('type')?.text?.replace(/^:\s*/, '');
    } else if (child.type === 'rest_pattern') {
      for (const c of child.children) {
        if (c.type === 'identifier') { name = c.text; break; }
      }
    }

    if (!name) continue;
    const param: FunctionParam = { name };
    if (type) param.type = type;
    if (optional) param.optional = optional;
    params.push(param);
  }
  return params;
}

/** Get return type annotation from a method_definition node */
function getMethodReturnType(node: Parser.SyntaxNode): string | undefined {
  return node.childForFieldName('return_type')?.text?.replace(/^:\s*/, '');
}

/**
 * Parse a class node into a ClassEntity
 */
function parseClassNode(
  node: Parser.SyntaxNode,
  filePath: string
): ClassEntity | null {
  // Get class name
  const nameNode = node.childForFieldName('name');
  const name = nameNode?.text;
  if (!name) return null; // Skip anonymous classes
  
  const location = getLocation(node);
  const isExported = checkIsExported(node);
  const isAbstract = checkIsAbstract(node);
  const extendsClass = getExtendsClass(node);
  const implementsList = getImplementsList(node);
  const docstring = getDocstring(node);
  
  const id = generateEntityId(filePath, 'class', name, location.startLine);
  
  // Build entity with optional properties only when defined
  const entity: ClassEntity = {
    id,
    name,
    filePath,
    startLine: location.startLine,
    endLine: location.endLine,
    isExported,
    isAbstract,
  };
  
  if (extendsClass) entity.extends = extendsClass;
  if (implementsList && implementsList.length > 0) entity.implements = implementsList;
  if (docstring) entity.docstring = docstring;
  
  return entity;
}

/**
 * Check if the class is exported
 */
function checkIsExported(node: Parser.SyntaxNode): boolean {
  const parent = node.parent;
  return parent?.type === 'export_statement';
}

/**
 * Check if the class is abstract
 */
function checkIsAbstract(node: Parser.SyntaxNode): boolean {
  // Look for abstract keyword
  for (const child of node.children) {
    if (child.type === 'abstract') return true;
  }
  
  // Also check parent for abstract modifier
  const parent = node.parent;
  if (parent) {
    for (const sibling of parent.children) {
      if (sibling.text === 'abstract') return true;
    }
  }
  
  return false;
}

/**
 * Get the extended class name
 */
function getExtendsClass(node: Parser.SyntaxNode): string | undefined {
  // Find class_heritage node
  for (const child of node.children) {
    if (child.type === 'class_heritage') {
      // Look for extends_clause
      for (const heritageChild of child.children) {
        if (heritageChild.type === 'extends_clause') {
          // Get the extended type
          const typeNode = heritageChild.childForFieldName('value') ||
            heritageChild.children.find(c => c.type === 'identifier' || c.type === 'type_identifier');
          return typeNode?.text;
        }
      }
    }
  }
  return undefined;
}

/**
 * Get the list of implemented interfaces
 */
function getImplementsList(node: Parser.SyntaxNode): string[] {
  const implementsList: string[] = [];
  
  for (const child of node.children) {
    if (child.type === 'class_heritage') {
      for (const heritageChild of child.children) {
        if (heritageChild.type === 'implements_clause') {
          // Get all implemented types
          for (const typeChild of heritageChild.children) {
            if (typeChild.type === 'type_identifier' ||
                typeChild.type === 'identifier') {
              implementsList.push(typeChild.text);
            }
          }
        }
      }
    }
  }
  
  return implementsList;
}

/**
 * Get JSDoc comment above the class
 */
function getDocstring(node: Parser.SyntaxNode): string | undefined {
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
