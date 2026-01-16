/**
 * CodeGraph Edge Types
 * Based on CodeGraph MVP Specification Section 3.2
 */

// ============================================================================
// Base Edge Types
// ============================================================================

/** Base edge interface */
export interface BaseEdge {
  /** Source node ID */
  from: string;
  /** Target node ID */
  to: string;
}

// ============================================================================
// Structural Edges
// ============================================================================

/** File contains entity (File → Class/Function/Variable/Type) */
export interface ContainsEdge extends BaseEdge {
  type: 'CONTAINS';
}

// ============================================================================
// Import Edges
// ============================================================================

/** File imports from another file */
export interface ImportsEdge extends BaseEdge {
  type: 'IMPORTS';
  /** Import specifiers */
  specifiers?: string[];
}

/** File imports a specific symbol */
export interface ImportsSymbolEdge extends BaseEdge {
  type: 'IMPORTS_SYMBOL';
  /** Import alias (if renamed) */
  alias?: string;
  /** Whether this is the default import */
  isDefault: boolean;
}

// ============================================================================
// Call Edges
// ============================================================================

/** Function calls another function */
export interface CallsEdge extends BaseEdge {
  type: 'CALLS';
  /** Line number where the call occurs */
  line: number;
  /** Number of times this call occurs (for aggregation) */
  count?: number;
}

// ============================================================================
// Inheritance Edges
// ============================================================================

/** Class extends another class */
export interface ExtendsEdge extends BaseEdge {
  type: 'EXTENDS';
}

/** Class implements an interface */
export interface ImplementsEdge extends BaseEdge {
  type: 'IMPLEMENTS';
}

// ============================================================================
// Type Usage Edges
// ============================================================================

/** Function/Variable uses a type */
export interface UsesTypeEdge extends BaseEdge {
  type: 'USES_TYPE';
}

/** Function returns a type */
export interface ReturnsEdge extends BaseEdge {
  type: 'RETURNS';
}

/** Function has a parameter of a type */
export interface HasParamEdge extends BaseEdge {
  type: 'HAS_PARAM';
  /** Parameter name */
  paramName: string;
  /** Parameter position (0-indexed) */
  position: number;
}

// ============================================================================
// Class Member Edges
// ============================================================================

/** Visibility modifier */
export type Visibility = 'public' | 'private' | 'protected';

/** Class has a method */
export interface HasMethodEdge extends BaseEdge {
  type: 'HAS_METHOD';
  /** Method visibility */
  visibility: Visibility;
}

/** Class has a property */
export interface HasPropertyEdge extends BaseEdge {
  type: 'HAS_PROPERTY';
  /** Property visibility */
  visibility: Visibility;
}

// ============================================================================
// React-Specific Edges
// ============================================================================

/** Component renders another component */
export interface RendersEdge extends BaseEdge {
  type: 'RENDERS';
  /** Line number where the render occurs */
  line: number;
}

/** Component uses a React hook */
export interface UsesHookEdge extends BaseEdge {
  type: 'USES_HOOK';
  /** Hook name (e.g., 'useState', 'useEffect') */
  hookName: string;
}

// ============================================================================
// Union Types
// ============================================================================

/** Union of all edge types */
export type Edge =
  | ContainsEdge
  | ImportsEdge
  | ImportsSymbolEdge
  | CallsEdge
  | ExtendsEdge
  | ImplementsEdge
  | UsesTypeEdge
  | ReturnsEdge
  | HasParamEdge
  | HasMethodEdge
  | HasPropertyEdge
  | RendersEdge
  | UsesHookEdge;

/** Edge label types matching FalkorDB schema */
export type EdgeLabel =
  | 'CONTAINS'
  | 'IMPORTS'
  | 'IMPORTS_SYMBOL'
  | 'CALLS'
  | 'EXTENDS'
  | 'IMPLEMENTS'
  | 'USES_TYPE'
  | 'RETURNS'
  | 'HAS_PARAM'
  | 'HAS_METHOD'
  | 'HAS_PROPERTY'
  | 'RENDERS'
  | 'USES_HOOK';
