/**
 * Canonical FalkorDB node-label constants.
 *
 * The set of labels a code-graph node can carry had drifted before: the
 * same conceptual list of "code symbol" labels was hand-copied as inline
 * string arrays and union types across packages/graph, and each copy
 * accumulated its own accidental differences (one included 'External',
 * another didn't; one included 'Entity', another didn't; and so on).
 *
 * Every array below is derived from SYMBOL_LABELS (or, for SYMBOL_LABELS
 * itself, from the full NodeLabel union) so a new code-node label only ever
 * needs to be added in one place. Order carries no meaning: every array
 * here is consumed as an unordered label set (an OR'd WHERE clause, a Set
 * for membership checks, or a list of labels to pre-create), never
 * depended on for position.
 */

import type { NodeLabel } from './nodes';

// ============================================================================
// Exhaustiveness helper
// ============================================================================

/**
 * Curried tuple-literal checker: `asExhaustiveArray<NodeLabel>()([...])`
 * type-errors at the array literal if any element isn't a NodeLabel value
 * (normal excess-property checking) *and* if the literal is missing a
 * NodeLabel value (the conditional collapses the parameter type to `never`
 * when `T` isn't fully covered by the array's own member union). This is
 * what enforces "NODE_LABELS is exactly NodeLabel" at compile time, not
 * just "NODE_LABELS only contains NodeLabel values".
 */
function asExhaustiveArray<T extends string>() {
  return function build<L extends readonly T[]>(
    array: L & ([T] extends [L[number]] ? unknown : never),
  ): L {
    return array;
  };
}

// ============================================================================
// NODE_LABELS: every value of the NodeLabel union
// ============================================================================

/**
 * Every value of the `NodeLabel` union, as a runtime array. Used where code
 * needs to enumerate "all real code-graph node labels", e.g. resolving a
 * node's canonical single label from its full FalkorDB label list.
 */
export const NODE_LABELS = asExhaustiveArray<NodeLabel>()([
  'File',
  'Function',
  'Class',
  'Interface',
  'Variable',
  'Type',
  'Component',
  'Import',
  'Commit',
  'MarkdownDocument',
  'Section',
  'CodeBlock',
  'Link',
] as const);

// ============================================================================
// SYMBOL_LABELS: declarations that can be embedded, vector-searched, and
// carry ProvenanceFields
// ============================================================================

/**
 * The seven "code symbol" labels: source declarations that get an
 * embedding, are vector-searchable, and carry ProvenanceFields
 * (sourcePipeline/sourceTask/processedAt). This was previously hand-copied
 * as a 7-member union type plus a matching VALID_NODE_TYPES set at every
 * embedding/vector-search call site in packages/graph/src/operations.ts.
 */
export const SYMBOL_LABELS = [
  'File',
  'Function',
  'Class',
  'Interface',
  'Variable',
  'Type',
  'Component',
] as const satisfies readonly NodeLabel[];

export type SymbolLabel = (typeof SYMBOL_LABELS)[number];

// ============================================================================
// REFERENCEABLE_LABELS: SYMBOL_LABELS plus the synthetic 'External' marker
// ============================================================================

/**
 * SYMBOL_LABELS plus the synthetic 'External' pseudo-label a FalkorDB node
 * carries when it stands in for a symbol outside the indexed project (an
 * import from node_modules, for example). 'External' is not a real
 * NodeLabel value, it's an additional marker a node carries alongside its
 * real label, so it's layered on top of the canonical array rather than
 * folded into NodeLabel itself.
 */
export const REFERENCEABLE_LABELS = [...SYMBOL_LABELS, 'External'] as const;

export type ReferenceableLabel = (typeof REFERENCEABLE_LABELS)[number];

// ============================================================================
// EMBEDDABLE_LABELS: SYMBOL_LABELS plus knowledge-graph Entity nodes
// ============================================================================

/**
 * SYMBOL_LABELS plus 'Entity' (knowledge-graph entities), which also carry
 * ProvenanceFields and an embedding vector. Used for the provenance indexes
 * and the vector indexes in falkordb-shared.ts, which cover exactly this
 * set of labels: previously two separately hand-copied arrays that
 * happened to agree.
 */
export const EMBEDDABLE_LABELS = [...SYMBOL_LABELS, 'Entity'] as const;

export type EmbeddableLabel = (typeof EMBEDDABLE_LABELS)[number];

// ============================================================================
// SUMMARY_LABELS: the labels shown in the compact index summary
// ============================================================================

/**
 * Subset of SYMBOL_LABELS shown by buildFileTree's getIndexSummary: the
 * labels a human skimming an indexing report cares about. Deliberately
 * excludes Variable and Type, which are numerous and not usually what "how
 * big is this codebase" questions are about.
 */
export const SUMMARY_LABELS = [
  'File',
  'Function',
  'Class',
  'Interface',
  'Component',
] as const satisfies readonly SymbolLabel[];

export type SummaryLabel = (typeof SUMMARY_LABELS)[number];

// ============================================================================
// ALL_GRAPH_LABELS: every label FalkorDB may ever see written to it
// ============================================================================

/**
 * Every label FalkorDB may ever see written to it, across both the code
 * graph and the knowledge graph. Used only to pre-create one dummy node per
 * label before concurrent writes start (FalkorDB #1240 workaround: a race
 * condition where concurrent writes that introduce a brand-new label can
 * crash the engine) - see ensureSchemaImpl in
 * packages/graph/src/drivers/falkordb-shared.ts.
 */
export const ALL_GRAPH_LABELS = [
  ...SYMBOL_LABELS,
  'TypeRef',
  'Entity',
  'Project',
  'Commit',
  'Metadata',
  'MarkdownDocument',
  'Section',
  'CodeBlock',
  'Link',
] as const;

export type AllGraphLabel = (typeof ALL_GRAPH_LABELS)[number];

// ============================================================================
// resolveNodeLabel: classify a raw FalkorDB label list against NODE_LABELS
// ============================================================================

/**
 * Find the first entry in a node's raw FalkorDB label list that is a
 * recognized NodeLabel value.
 *
 * A FalkorDB node can carry more than one label at once (an External-marked
 * class, for example, carries both its real label and 'External'), so this
 * walks `labels` in the order the database returned it and returns the
 * first recognized one, rather than picking whichever NodeLabel happens to
 * be checked first. That ordering is what lets a caller that special-cases
 * a marker label (like 'External') put a real label like 'Class' or 'File'
 * ahead of the marker without this function needing to know about markers
 * at all.
 *
 * Returns undefined when none of `labels` is a recognized NodeLabel value;
 * callers decide their own fallback, since "no recognized label" means
 * different things in different contexts (packages/graph/src/queries.ts
 * treats a pure 'External' node as a 'Class' stand-in; other callers just
 * default to 'File').
 */
export function resolveNodeLabel(labels: readonly string[]): NodeLabel | undefined {
  return labels.find((l): l is NodeLabel => NODE_LABELS.includes(l as NodeLabel));
}
