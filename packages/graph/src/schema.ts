/**
 * @codegraph/graph - Schema Types
 * Cypher-compatible types and mappers for graph operations
 */

import type {
  FileEntity,
  FunctionEntity,
  ClassEntity,
  InterfaceEntity,
  VariableEntity,
  TypeEntity,
  ComponentEntity,
  ImportEntity,
  CommitEntity,
  NodeLabel,
  EdgeLabel,
  MarkdownDocumentEntity,
  SectionEntity,
  CodeBlockEntity,
  LinkEntity,
} from '@codegraph/types';

// ============================================================================
// Provenance Properties (common across all node types)
// ============================================================================

/**
 * Provenance fields for Cypher node properties.
 * Tracks which pipeline/task produced each graph entity.
 */
export interface ProvenanceNodeProps {
  sourcePipeline?: string | null;
  sourceTask?: string | null;
  processedAt?: string | null;
}

// ============================================================================
// Node Property Types (for Cypher MERGE statements)
// ============================================================================

/**
 * File node properties for Cypher operations
 */
export interface FileNodeProps extends ProvenanceNodeProps {
  path: string;
  name: string;
  extension: string;
  loc: number;
  lastModified: string;
  hash: string;
  embedding?: number[] | null;
  embeddingTextHash?: string | null;
}

/**
 * Function node properties for Cypher operations
 */
export interface FunctionNodeProps extends ProvenanceNodeProps {
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  isExported: boolean;
  isAsync: boolean;
  isArrow: boolean;
  params: string; // JSON serialized params
  returnType: string | null;
  docstring: string | null;
  complexity: number | null;
  cognitiveComplexity: number | null;
  nestingDepth: number | null;
  embedding?: number[] | null;
  embeddingTextHash?: string | null;
}

/**
 * Class node properties for Cypher operations
 */
export interface ClassNodeProps extends ProvenanceNodeProps {
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  isExported: boolean;
  isAbstract: boolean;
  extends: string | null;
  implements: string | null; // JSON serialized array
  docstring: string | null;
  embedding?: number[] | null;
  embeddingTextHash?: string | null;
}

/**
 * Interface node properties for Cypher operations
 */
export interface InterfaceNodeProps extends ProvenanceNodeProps {
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  isExported: boolean;
  extends: string | null; // JSON serialized array
  docstring: string | null;
  embedding?: number[] | null;
  embeddingTextHash?: string | null;
}

/**
 * Variable node properties for Cypher operations
 */
export interface VariableNodeProps extends ProvenanceNodeProps {
  name: string;
  filePath: string;
  line: number;
  kind: string;
  isExported: boolean;
  type: string | null;
  embedding?: number[] | null;
  embeddingTextHash?: string | null;
}

/**
 * Type node properties for Cypher operations
 */
export interface TypeNodeProps extends ProvenanceNodeProps {
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  isExported: boolean;
  kind: string;
  docstring: string | null;
  embedding?: number[] | null;
  embeddingTextHash?: string | null;
}

/**
 * Component node properties for Cypher operations
 */
export interface ComponentNodeProps extends ProvenanceNodeProps {
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  isExported: boolean;
  props: string | null; // JSON serialized props
  propsType: string | null;
  embedding?: number[] | null;
  embeddingTextHash?: string | null;
}

/**
 * Commit node properties for Cypher operations
 */
export interface CommitNodeProps extends ProvenanceNodeProps {
  hash: string;
  message: string;
  author: string;
  email: string;
  date: string;
}

/**
 * MarkdownDocument node properties for Cypher operations
 */
export interface MarkdownDocumentNodeProps {
  path: string;
  name: string;
  title: string | null;
  frontmatter: string | null; // JSON serialized
  hash: string;
  lastModified: string;
}

/**
 * Section node properties for Cypher operations
 */
export interface SectionNodeProps {
  heading: string;
  level: number;
  filePath: string;
  startLine: number;
  endLine: number;
}

/**
 * CodeBlock node properties for Cypher operations
 */
export interface CodeBlockNodeProps {
  language: string | null;
  content: string;
  filePath: string;
  startLine: number;
  endLine: number;
}

/**
 * Link node properties for Cypher operations
 */
export interface LinkNodeProps {
  text: string;
  target: string;
  isInternal: boolean;
  filePath: string;
  line: number;
  anchor: string | null;
}

// ============================================================================
// Entity to Node Property Mappers
// ============================================================================

/**
 * Convert FileEntity to Cypher-compatible node properties
 */
export function fileToNodeProps(entity: FileEntity): FileNodeProps {
  return {
    path: entity.path,
    name: entity.name,
    extension: entity.extension,
    loc: entity.loc,
    lastModified: entity.lastModified,
    hash: entity.hash,
    sourcePipeline: entity.sourcePipeline ?? null,
    sourceTask: entity.sourceTask ?? null,
    processedAt: entity.processedAt ?? null,
  };
}

/**
 * Convert FunctionEntity to Cypher-compatible node properties
 */
export function functionToNodeProps(entity: FunctionEntity): FunctionNodeProps {
  return {
    name: entity.name,
    filePath: entity.filePath,
    startLine: entity.startLine,
    endLine: entity.endLine,
    isExported: entity.isExported,
    isAsync: entity.isAsync,
    isArrow: entity.isArrow,
    params: JSON.stringify(entity.params),
    returnType: entity.returnType ?? null,
    docstring: entity.docstring ?? null,
    complexity: entity.complexity ?? null,
    cognitiveComplexity: entity.cognitiveComplexity ?? null,
    nestingDepth: entity.nestingDepth ?? null,
    sourcePipeline: entity.sourcePipeline ?? null,
    sourceTask: entity.sourceTask ?? null,
    processedAt: entity.processedAt ?? null,
  };
}

/**
 * Convert ClassEntity to Cypher-compatible node properties
 */
export function classToNodeProps(entity: ClassEntity): ClassNodeProps {
  return {
    name: entity.name,
    filePath: entity.filePath,
    startLine: entity.startLine,
    endLine: entity.endLine,
    isExported: entity.isExported,
    isAbstract: entity.isAbstract,
    extends: entity.extends ?? null,
    implements: entity.implements ? JSON.stringify(entity.implements) : null,
    docstring: entity.docstring ?? null,
    sourcePipeline: entity.sourcePipeline ?? null,
    sourceTask: entity.sourceTask ?? null,
    processedAt: entity.processedAt ?? null,
  };
}

/**
 * Convert InterfaceEntity to Cypher-compatible node properties
 */
export function interfaceToNodeProps(entity: InterfaceEntity): InterfaceNodeProps {
  return {
    name: entity.name,
    filePath: entity.filePath,
    startLine: entity.startLine,
    endLine: entity.endLine,
    isExported: entity.isExported,
    extends: entity.extends ? JSON.stringify(entity.extends) : null,
    docstring: entity.docstring ?? null,
    sourcePipeline: entity.sourcePipeline ?? null,
    sourceTask: entity.sourceTask ?? null,
    processedAt: entity.processedAt ?? null,
  };
}

/**
 * Convert VariableEntity to Cypher-compatible node properties
 */
export function variableToNodeProps(entity: VariableEntity): VariableNodeProps {
  return {
    name: entity.name,
    filePath: entity.filePath,
    line: entity.line,
    kind: entity.kind,
    isExported: entity.isExported,
    type: entity.type ?? null,
    sourcePipeline: entity.sourcePipeline ?? null,
    sourceTask: entity.sourceTask ?? null,
    processedAt: entity.processedAt ?? null,
  };
}

/**
 * Convert TypeEntity to Cypher-compatible node properties
 */
export function typeToNodeProps(entity: TypeEntity): TypeNodeProps {
  return {
    name: entity.name,
    filePath: entity.filePath,
    startLine: entity.startLine,
    endLine: entity.endLine,
    isExported: entity.isExported,
    kind: entity.kind,
    docstring: entity.docstring ?? null,
    sourcePipeline: entity.sourcePipeline ?? null,
    sourceTask: entity.sourceTask ?? null,
    processedAt: entity.processedAt ?? null,
  };
}

/**
 * Convert ComponentEntity to Cypher-compatible node properties
 */
export function componentToNodeProps(entity: ComponentEntity): ComponentNodeProps {
  return {
    name: entity.name,
    filePath: entity.filePath,
    startLine: entity.startLine,
    endLine: entity.endLine,
    isExported: entity.isExported,
    props: entity.props ? JSON.stringify(entity.props) : null,
    propsType: entity.propsType ?? null,
    sourcePipeline: entity.sourcePipeline ?? null,
    sourceTask: entity.sourceTask ?? null,
    processedAt: entity.processedAt ?? null,
  };
}

/**
 * Convert CommitEntity to Cypher-compatible node properties
 */
export function commitToNodeProps(entity: CommitEntity): CommitNodeProps {
  return {
    hash: entity.hash,
    message: entity.message,
    author: entity.author,
    email: entity.email,
    date: entity.date,
    sourcePipeline: entity.sourcePipeline ?? null,
    sourceTask: entity.sourceTask ?? null,
    processedAt: entity.processedAt ?? null,
  };
}

/**
 * Convert MarkdownDocumentEntity to Cypher-compatible node properties
 */
export function markdownDocumentToNodeProps(entity: MarkdownDocumentEntity): MarkdownDocumentNodeProps {
  return {
    path: entity.path,
    name: entity.name,
    title: entity.title,
    frontmatter: Object.keys(entity.frontmatter).length > 0 ? JSON.stringify(entity.frontmatter) : null,
    hash: entity.hash,
    lastModified: entity.lastModified,
  };
}

/**
 * Convert SectionEntity to Cypher-compatible node properties
 */
export function sectionToNodeProps(entity: SectionEntity): SectionNodeProps {
  return {
    heading: entity.heading,
    level: entity.level,
    filePath: entity.filePath,
    startLine: entity.startLine,
    endLine: entity.endLine,
  };
}

/**
 * Convert CodeBlockEntity to Cypher-compatible node properties
 */
export function codeBlockToNodeProps(entity: CodeBlockEntity): CodeBlockNodeProps {
  return {
    language: entity.language,
    content: entity.content,
    filePath: entity.filePath,
    startLine: entity.startLine,
    endLine: entity.endLine,
  };
}

/**
 * Convert LinkEntity to Cypher-compatible node properties
 */
export function linkToNodeProps(entity: LinkEntity): LinkNodeProps {
  return {
    text: entity.text,
    target: entity.target,
    isInternal: entity.isInternal,
    filePath: entity.filePath,
    line: entity.line,
    anchor: entity.anchor ?? null,
  };
}

// ============================================================================
// ID Generation
// ============================================================================

/**
 * Generate a unique node ID for graph operations
 * Uses a deterministic format based on entity properties
 */
export function generateNodeId(label: NodeLabel, entity: { name: string; filePath: string; startLine?: number; line?: number }): string {
  const line = 'startLine' in entity ? entity.startLine : ('line' in entity ? entity.line : 0);
  return `${label}:${entity.filePath}:${entity.name}:${line}`;
}

/**
 * Generate a File node ID
 */
export function generateFileNodeId(path: string): string {
  return `File:${path}`;
}

/**
 * Generate an edge ID
 */
export function generateEdgeId(label: EdgeLabel, fromId: string, toId: string): string {
  return `${label}:${fromId}->${toId}`;
}

// ============================================================================
// Parsed File Result Type (canonical definition in @codegraph/types)
// ============================================================================

export type { ParsedFileEntities } from '@codegraph/types';

// ============================================================================
// Type Re-exports
// ============================================================================

export type {
  FileEntity,
  FunctionEntity,
  ClassEntity,
  InterfaceEntity,
  VariableEntity,
  TypeEntity,
  ComponentEntity,
  ImportEntity,
  CommitEntity,
  NodeLabel,
  EdgeLabel,
};
