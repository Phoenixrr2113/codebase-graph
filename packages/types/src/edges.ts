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
// Export Edges
// ============================================================================

/** File exports a symbol (Function, Class, Interface, Variable, Type) */
export interface ExportsEdge extends BaseEdge {
  type: 'EXPORTS';
  /** Export alias (for `export { foo as bar }`) */
  asName?: string;
  /** Whether this is the default export */
  isDefault?: boolean;
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

/** Function instantiates a class (new ClassName()) */
export interface InstantiatesEdge extends BaseEdge {
  type: 'INSTANTIATES';
  /** Line number where instantiation occurs */
  line: number;
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
// Class Member Edge Descriptors (for pipeline transport)
// ============================================================================

/**
 * Describes a HAS_METHOD edge to create between a Class node and a Function node.
 * Produced by language plugins during extraction, consumed by graph batchUpsert.
 * Lives here (not in a plugin) so Python/Go/Rust plugins emit the same shape.
 *
 * Uses `fromId`/`toId` (not `from`/`to`) to distinguish these pre-persistence
 * transport objects from the final BaseEdge-derived types that flow through queries.
 */
export interface HasMethodEdgeDescriptor {
  /** Class node id */
  fromId: string;
  /** Function node id */
  toId: string;
  isStatic: boolean;
  visibility: Visibility;
}

/**
 * Describes a HAS_PROPERTY edge to create between a Class node and a Variable node.
 * Produced by language plugins during extraction, consumed by graph batchUpsert.
 * Lives here (not in a plugin) so Python/Go/Rust plugins emit the same shape.
 *
 * Uses `fromId`/`toId` (not `from`/`to`) to distinguish these pre-persistence
 * transport objects from the final BaseEdge-derived types that flow through queries.
 */
export interface HasPropertyEdgeDescriptor {
  /** Class node id */
  fromId: string;
  /** Variable node id */
  toId: string;
  isStatic: boolean;
  visibility: Visibility;
  isReadonly: boolean;
}

// ============================================================================
// Type-Relationship Edge Descriptors (for pipeline transport)
// ============================================================================

/**
 * Pipeline transport descriptor for HAS_PARAM edges (Function → Type).
 * Uses `fromId`/`toId` (not `from`/`to`) to distinguish these
 * pre-persistence transport objects from the final BaseEdge-derived
 * types that flow through queries.
 */
export interface HasParamEdgeDescriptor {
  /** Function node id */
  fromId: string;
  /** Type node id (prim:: or type:: format) */
  toId: string;
  position: number;
  name: string;
  isOptional: boolean;
}

/**
 * Pipeline transport descriptor for RETURNS edges (Function → Type).
 */
export interface ReturnsEdgeDescriptor {
  /** Function node id */
  fromId: string;
  /** Type node id (prim:: or type:: format) */
  toId: string;
  isAsync: boolean;
}

/**
 * Pipeline transport descriptor for USES_TYPE edges (Function → Type).
 */
export interface UsesTypeEdgeDescriptor {
  /** Function node id */
  fromId: string;
  /** Type node id (prim:: or type:: format) */
  toId: string;
  kind: 'annotation' | 'instantiation' | 'cast';
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


// ============================================================================
// Temporal Edges (Git History)
// ============================================================================

/** Entity was introduced in a commit */
export interface IntroducedInEdge extends BaseEdge {
  type: 'INTRODUCED_IN';
}

/** Entity was modified in a commit */
export interface ModifiedInEdge extends BaseEdge {
  type: 'MODIFIED_IN';
  /** Lines added in this commit */
  linesAdded?: number;
  /** Lines removed in this commit */
  linesRemoved?: number;
  /** Change in complexity */
  complexityDelta?: number;
}

/** Entity was deleted in a commit */
export interface DeletedInEdge extends BaseEdge {
  type: 'DELETED_IN';
}

// ============================================================================
// Document Edges (Markdown)
// ============================================================================

/** Document has a section (heading) */
export interface HasSectionEdge extends BaseEdge {
  type: 'HAS_SECTION';
}

/** Section is a parent of another section (heading hierarchy) */
export interface ParentSectionEdge extends BaseEdge {
  type: 'PARENT_SECTION';
}

/** Section or document contains a code block */
export interface ContainsCodeEdge extends BaseEdge {
  type: 'CONTAINS_CODE';
}

/** Document links to another document, file, or URL */
export interface LinksToEdge extends BaseEdge {
  type: 'LINKS_TO';
  /** Anchor/fragment if present (e.g., #section-id) */
  anchor?: string;
}

// ============================================================================
// Bridge Edges (Knowledge Graph ↔ Code Graph)
// ============================================================================

/**
 * ABOUT — connects a knowledge entity to a code graph node.
 * Bridges the knowledge graph layer (entities from conversations, decisions,
 * bug reports) to the code graph layer (functions, classes, files, etc.).
 *
 * Created via:
 *   - Name matching: entity text matches a known symbol name
 *   - Embedding similarity: entity embedding close to code node embedding
 *   - LLM verification: borderline matches confirmed by LLM
 */
export interface AboutEdge extends BaseEdge {
  type: 'ABOUT';
  /** Match confidence (1.0 = exact name, 0.7+ = embedding, 0.9+ = LLM-verified) */
  confidence: number;
  /** How the link was created */
  method: 'exact_match' | 'embedding_similarity' | 'llm_verified' | 'manual';
  /** ISO timestamp when the link was created */
  createdAt?: string;
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
  | IntroducedInEdge
  | ModifiedInEdge
  | DeletedInEdge
  | ExportsEdge
  | InstantiatesEdge
  | HasSectionEdge
  | ParentSectionEdge
  | ContainsCodeEdge
  | LinksToEdge
  | AboutEdge;

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
  | 'INTRODUCED_IN'
  | 'MODIFIED_IN'
  | 'DELETED_IN'
  | 'EXPORTS'
  | 'INSTANTIATES'
  | 'HAS_SECTION'
  | 'PARENT_SECTION'
  | 'CONTAINS_CODE'
  | 'LINKS_TO'
  | 'ABOUT';
