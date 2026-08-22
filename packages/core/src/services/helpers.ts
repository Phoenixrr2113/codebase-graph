/**
 * Shared helpers for service layer.
 * @module services/helpers
 */

import type { CypherDialect } from '@codegraph/graph';
import type { NodeLabel } from '@codegraph/types';
import { SYMBOL_LABELS, resolveNodeLabel } from '@codegraph/types';

/** Build OR-separated label check expression */
export function labelOr(dialect: CypherDialect, alias: string, labels: string[]): string {
  return labels.map(l => dialect.labelCheckExpr(alias, l)).join(' OR ');
}

// SYMBOL_LABELS is the shared source of truth (packages/types/src/labels.ts).
// This was a hand-copied 7-item array before; kept as its own mutable
// `string[]` (rather than exporting SYMBOL_LABELS directly) because
// graph-data-service.ts passes it straight into labelOr's `labels: string[]`
// parameter.
export const ALL_LABELS: string[] = [...SYMBOL_LABELS];

export function extractNodeProps(node: Record<string, unknown>): Record<string, unknown> {
  if (node['properties'] && typeof node['properties'] === 'object') {
    return node['properties'] as Record<string, unknown>;
  }
  return node;
}

/**
 * Classify a node's raw FalkorDB label list against the full canonical
 * NodeLabel set (via resolveNodeLabel from @codegraph/types), falling back
 * to 'File' when nothing matches.
 *
 * This used to check only an 8-label allowlist (the 7 embeddable code-symbol
 * labels plus 'Import'), so a Commit, MarkdownDocument, Section, CodeBlock or
 * Link node fell through to the 'File' fallback and produced a nonsensical
 * id from generateNodeId (a File-shaped id built from a node with no
 * filePath). Reachable only via CodeGraphService.getNodesPaginated when a
 * caller explicitly requests one of those types; exported but currently
 * uncalled in production.
 */
export function getLabelFromLabels(labels: string[]): NodeLabel {
  return resolveNodeLabel(labels) ?? 'File';
}

/** True string property lookup: rejects missing, non-string, and empty values. */
function stringProp(props: Record<string, unknown>, key: string): string | undefined {
  const value = props[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** True numeric property lookup: rejects missing and non-number values (0 is valid). */
function numberProp(props: Record<string, unknown>, key: string): number | undefined {
  const value = props[key];
  return typeof value === 'number' ? value : undefined;
}

/**
 * Build a unique, stable id for a node from the property that actually
 * identifies its label, not a one-size-fits-all name/filePath/line guess.
 *
 * Real identity per label, confirmed against packages/graph/src/schema.ts's
 * node-props types and the MERGE keys in packages/graph/src/operations.ts
 * and packages/graph/src/knowledge-operations.ts:
 *   - File: filePath alone (existing single-key scheme, unchanged)
 *   - Function, Class, Interface, Variable, Type, Component: name plus
 *     filePath plus startLine (or line for Variable). Existing scheme,
 *     unchanged, and already matches these labels' own MERGE keys.
 *   - Commit: MERGE (c:Commit {hash}), so the identity is hash.
 *   - MarkdownDocument: MERGE (d:MarkdownDocument {path}), so the identity is path.
 *   - Section: MERGE (s:Section {filePath, startLine}), so the identity is
 *     filePath plus startLine. Sections have no `name` property.
 *   - CodeBlock: MERGE (cb:CodeBlock {filePath, startLine}), so the identity
 *     is filePath plus startLine. CodeBlocks have no `name` property.
 *   - Link: MERGE (l:Link {filePath, line, target}), so the identity is
 *     filePath plus line plus target. Links have no `name` property.
 *   - Entity: MERGE (n:Entity {text, type}), so the identity is text plus
 *     type. Entity is not a NodeLabel value (it is a knowledge-graph label,
 *     not a code-graph one), but a real Entity node reaches this function
 *     today through graph-data-service.ts's getNeighborsImpl, which builds
 *     `nodeLabel` straight from the database's own `labels(neighbor)[0]`
 *     string rather than through getLabelFromLabels.
 *
 * The old version used the symbol-label scheme (name, filePath, and
 * startLine or line) for every label, including these. None of Commit,
 * MarkdownDocument, Section, CodeBlock, Link or Entity carry those
 * properties, so every node of a given one of those labels collapsed onto
 * the same id (every Commit became "Commit::0", regardless of which commit
 * it was), a real collision, not just an ugly id, since callers use this id
 * to tell nodes apart. A label with no identity contract established here
 * (there is no MERGE for an Import node anywhere in packages/graph, so one
 * is never actually reachable) falls back to an explicit "unknown" marker
 * instead of silently reusing a scheme that does not apply to it.
 */
export function generateNodeId(label: NodeLabel | 'Entity', props: Record<string, unknown>): string {
  switch (label) {
    case 'File':
      return `File:${stringProp(props, 'filePath') ?? ''}`;

    case 'Function':
    case 'Class':
    case 'Interface':
    case 'Variable':
    case 'Type':
    case 'Component': {
      return stringProp(props, 'id') ?? `${label}:unknown`;
    }

    case 'Commit': {
      const hash = stringProp(props, 'hash');
      return hash ? `Commit:${hash}` : 'Commit:unknown';
    }

    case 'MarkdownDocument': {
      const path = stringProp(props, 'path');
      return path ? `MarkdownDocument:${path}` : 'MarkdownDocument:unknown';
    }

    case 'Section': {
      const filePath = stringProp(props, 'filePath');
      const startLine = numberProp(props, 'startLine');
      return filePath !== undefined && startLine !== undefined
        ? `Section:${filePath}:${startLine}`
        : 'Section:unknown';
    }

    case 'CodeBlock': {
      const filePath = stringProp(props, 'filePath');
      const startLine = numberProp(props, 'startLine');
      return filePath !== undefined && startLine !== undefined
        ? `CodeBlock:${filePath}:${startLine}`
        : 'CodeBlock:unknown';
    }

    case 'Link': {
      const filePath = stringProp(props, 'filePath');
      const line = numberProp(props, 'line');
      const target = stringProp(props, 'target');
      return filePath !== undefined && line !== undefined && target !== undefined
        ? `Link:${filePath}:${line}:${target}`
        : 'Link:unknown';
    }

    case 'Entity': {
      const text = stringProp(props, 'text');
      const type = stringProp(props, 'type');
      return text !== undefined && type !== undefined
        ? `Entity:${type}:${text}`
        : 'Entity:unknown';
    }

    // 'Import' (never materialized as a graph node; no MERGE for :Import
    // exists anywhere in packages/graph) and any other label this function
    // does not yet have an identity contract for.
    default:
      return `${label}:unknown`;
  }
}
