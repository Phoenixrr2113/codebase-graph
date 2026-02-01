/**
 * CodeGraph Node Entity Types
 * Based on CodeGraph MVP Specification Section 3.1
 */

// ============================================================================
// Base Types
// ============================================================================

/** Common properties for all entities with location info */
export interface BaseEntity {
  /** Unique identifier for the entity */
  id?: string;
  /** Name of the entity */
  name: string;
  /** Absolute path to the file containing this entity */
  filePath: string;
}

/** Common properties for entities with line ranges */
export interface RangeEntity extends BaseEntity {
  /** Starting line number (1-indexed) */
  startLine: number;
  /** Ending line number (1-indexed) */
  endLine: number;
}

// ============================================================================
// File Entity
// ============================================================================

/** Represents a source file in the codebase */
export interface FileEntity {
  /** Unique identifier */
  id?: string;
  /** Absolute path to the file */
  path: string;
  /** File name without path */
  name: string;
  /** File extension (e.g., 'ts', 'tsx', 'js', 'jsx') */
  extension: string;
  /** Lines of code */
  loc: number;
  /** Last modification timestamp (ISO 8601) */
  lastModified: string;
  /** Content hash for change detection */
  hash: string;
}

// ============================================================================
// Class Entity
// ============================================================================

/** Represents a class declaration */
export interface ClassEntity extends RangeEntity {
  /** Whether the class is exported */
  isExported: boolean;
  /** Whether the class is abstract */
  isAbstract: boolean;
  /** Parent class name (if extends) */
  extends?: string;
  /** Implemented interfaces */
  implements?: string[];
  /** JSDoc/docstring content */
  docstring?: string;
}

// ============================================================================
// Interface Entity
// ============================================================================

/** Represents an interface declaration */
export interface InterfaceEntity extends RangeEntity {
  /** Whether the interface is exported */
  isExported: boolean;
  /** Extended interfaces */
  extends?: string[];
  /** JSDoc/docstring content */
  docstring?: string;
}

// ============================================================================
// Function Entity
// ============================================================================

/** Represents a function parameter */
export interface FunctionParam {
  /** Parameter name */
  name: string;
  /** Parameter type annotation */
  type?: string;
  /** Whether parameter is optional */
  optional?: boolean;
  /** Default value (as string) */
  defaultValue?: string;
  /** Whether parameter is rest parameter */
  isRest?: boolean;
}

/** Represents a function or method declaration */
export interface FunctionEntity extends RangeEntity {
  /** Whether the function is exported */
  isExported: boolean;
  /** Whether the function is async */
  isAsync: boolean;
  /** Whether the function is an arrow function */
  isArrow: boolean;
  /** Whether the function is a generator */
  isGenerator?: boolean;
  /** Function parameters */
  params: FunctionParam[];
  /** Return type annotation */
  returnType?: string;
  /** JSDoc/docstring content */
  docstring?: string;
  /** Cyclomatic complexity (1 + decision points) */
  complexity?: number;
  /** Cognitive complexity (flow breaks + nesting penalties) */
  cognitiveComplexity?: number;
  /** Maximum nesting depth */
  nestingDepth?: number;
}

// ============================================================================
// Variable Entity
// ============================================================================

/** Variable declaration kind */
export type VariableKind = 'const' | 'let' | 'var';

/** Represents a variable declaration */
export interface VariableEntity {
  /** Unique identifier */
  id?: string;
  /** Variable name */
  name: string;
  /** Absolute path to the file containing this variable */
  filePath: string;
  /** Line number */
  line: number;
  /** Declaration kind (const, let, var) */
  kind: VariableKind;
  /** Whether the variable is exported */
  isExported: boolean;
  /** Type annotation */
  type?: string;
}

// ============================================================================
// Import Entity
// ============================================================================

/** Represents an import specifier */
export interface ImportSpecifier {
  /** Imported name */
  name: string;
  /** Local alias (if different from name) */
  alias?: string;
}

/** Represents an import statement */
export interface ImportEntity {
  /** Unique identifier */
  id?: string;
  /** Import source path/module */
  source: string;
  /** Absolute path to the file containing this import */
  filePath: string;
  /** Whether this is a default import */
  isDefault: boolean;
  /** Whether this is a namespace import (import * as X) */
  isNamespace: boolean;
  /** Import specifiers for named imports */
  specifiers: ImportSpecifier[];
  /** Namespace alias (for import * as X) */
  namespaceAlias?: string;
  /** Default import alias */
  defaultAlias?: string;
  /** Resolved absolute path to the imported file (for relative imports) */
  resolvedPath?: string;
}

// ============================================================================
// Type Entity
// ============================================================================

/** Type entity kind */
export type TypeKind = 'type' | 'enum';

/** Represents a type alias or enum declaration */
export interface TypeEntity extends RangeEntity {
  /** Whether the type is exported */
  isExported: boolean;
  /** Type kind (type alias or enum) */
  kind: TypeKind;
  /** JSDoc/docstring content */
  docstring?: string;
}

// ============================================================================
// Component Entity (React)
// ============================================================================

/** Represents a React component prop */
export interface ComponentProp {
  /** Prop name */
  name: string;
  /** Prop type */
  type?: string;
  /** Whether prop is required */
  required?: boolean;
}

/** Represents a React component */
export interface ComponentEntity extends RangeEntity {
  /** Whether the component is exported */
  isExported: boolean;
  /** Component props interface/type */
  props?: ComponentProp[];
  /** Props type name (if referenced) */
  propsType?: string;
}

// ============================================================================
// Commit Entity (Git History)
// ============================================================================

/** Represents a git commit in the repository history */
export interface CommitEntity {
  /** Unique identifier (commit hash) */
  id?: string;
  /** Git commit hash (SHA-1, 40 characters) */
  hash: string;
  /** Commit message */
  message: string;
  /** Author name */
  author: string;
  /** Author email */
  email: string;
  /** Commit date (ISO 8601) */
  date: string;
}

// ============================================================================
// Project Entity
// ============================================================================

/** Represents a parsed project in the graph */
export interface ProjectEntity {
  /** Unique identifier (generated UUID) */
  id: string;
  /** Project name (directory name) */
  name: string;
  /** Absolute path to project root */
  rootPath: string;
  /** ISO 8601 timestamp when project was first parsed */
  createdAt: string;
  /** ISO 8601 timestamp of last parse */
  lastParsed: string;
  /** Number of files in the project */
  fileCount?: number;
}

// ============================================================================
// Union Types
// ============================================================================

/** Union of all entity types */
export type Entity =
  | FileEntity
  | ClassEntity
  | InterfaceEntity
  | FunctionEntity
  | VariableEntity
  | ImportEntity
  | TypeEntity
  | ComponentEntity
  | CommitEntity;

/** Node label types matching FalkorDB schema */
export type NodeLabel =
  | 'File'
  | 'Class'
  | 'Interface'
  | 'Function'
  | 'Variable'
  | 'Import'
  | 'Type'
  | 'Component'
  | 'Commit'
  | 'MarkdownDocument'
  | 'Section'
  | 'CodeBlock'
  | 'Link';

