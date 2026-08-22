/**
 * CodeGraph Edge Types
 * Based on CodeGraph MVP Specification Section 3.2
 */

import type { SymbolLabel } from './labels';

/**
 * The node labels an EXPORTS or IMPORTS_SYMBOL edge can point at: every
 * SYMBOL_LABELS entry except 'File' itself (a file can't export or be
 * imported as a symbol of itself).
 */
export type ExportableSymbolKind = Exclude<SymbolLabel, 'File'>;

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

/**
 * Pipeline transport descriptor for IMPORTS_SYMBOL edges: the importing
 * File node to the imported symbol node (not the imported File, that's what
 * IMPORTS is for). Produced in @codegraph/core's pipeline from each
 * ImportEntity's named specifiers that carry a resolvedPath.
 *
 * `symbolName`/`toFilePath` are the DECLARED name and file, not necessarily
 * the local specifier's own name/path: when the barrel-aware
 * ResolvedImportMap (built from wave 3a/3b's re-export chain resolution) has
 * already chased the local name to its true origin, that origin is used;
 * otherwise the specifier's own name plus the import's resolvedPath stand in
 * unchanged, which is already correct for a plain, non-barrel import.
 *
 * Cardinality is one edge per (named specifier, merged declaration). When a
 * language merges declarations under one name, such as a TypeScript Class
 * and Interface named `Joined`, importing that name intentionally targets
 * both declaration nodes.
 */
export interface ImportsSymbolEdgeDescriptor {
  /** Canonical importing File id once resolved by the pipeline. */
  fromId?: string;
  /** Canonical imported symbol id once resolved by the pipeline. */
  toId?: string;
  /** Importing file's path (File node). */
  fromFilePath: string;
  /** File path where the imported symbol is actually declared. */
  toFilePath: string;
  /** The symbol's name as declared at toFilePath, not the local alias. */
  symbolName: string;
  /** Local alias, when the import renamed it (`import { x as y }`). */
  alias?: string;
  /** Whether this is a default import. */
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

/**
 * Pipeline transport descriptor for EXPORTS edges (File to exported symbol).
 * Produced in @codegraph/core's pipeline from the `isExported` flag every
 * language plugin already stamps on functions, classes, interfaces,
 * variables, types, and components: see buildParsedFileEntities's
 * exportsEdges collection.
 *
 * Matched by name/filePath/kind (not `id`) when written: `id` on a symbol
 * node is populated by the TypeScript extractor but isn't guaranteed for
 * every language plugin, and `symbolKind` is needed anyway to disambiguate
 * declaration-merged names sharing (name, filePath), the same reasoning
 * CALLS edges use `callerKind` for (see CREATE_CALLS_EDGE in
 * @codegraph/graph's operations.ts).
 */
export interface ExportsEdgeDescriptor {
  /** Canonical exporting File id once resolved by the pipeline. */
  fromId?: string;
  /** Canonical exported symbol id once resolved by the pipeline. */
  toId?: string;
  /** Exporting file's path (File node). */
  filePath: string;
  /** Exported symbol's name. */
  symbolName: string;
  /** Node label of the exported symbol (disambiguates declaration merging). */
  symbolKind: ExportableSymbolKind;
  /** Export alias (`export { foo as bar }`), when known. */
  asName?: string;
  /** Whether this is the default export, when known. */
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

// A document attaching its sections, code blocks, and links was originally
// meant to use three dedicated edge types (HAS_SECTION, CONTAINS_CODE,
// LINKS_TO), but the write layer has only ever used the generic CONTAINS
// edge for all three (see BATCH_UPSERT_SECTIONS / BATCH_UPSERT_CODEBLOCKS /
// BATCH_UPSERT_LINKS in @codegraph/graph's operations.ts), so those three
// types were removed here rather than left declared and never written.
// PARENT_SECTION is real: it's the one document edge actually created, for
// section-to-section heading nesting within one document.

/** Section is a parent of another section (heading hierarchy) */
export interface ParentSectionEdge extends BaseEdge {
  type: 'PARENT_SECTION';
}

// ============================================================================
// Bridge Edges (Knowledge Graph to Code Graph)
// ============================================================================

/**
 * ABOUT: connects a knowledge entity to a code graph node.
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
  | ParentSectionEdge
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
  | 'PARENT_SECTION'
  | 'ABOUT';
