/**
 * Shared helpers for service layer.
 * @module services/helpers
 */

import type { CypherDialect } from '@codegraph/graph';
import type { NodeLabel } from '@codegraph/types';

/** Build OR-separated label check expression */
export function labelOr(dialect: CypherDialect, alias: string, labels: string[]): string {
  return labels.map(l => dialect.labelCheckExpr(alias, l)).join(' OR ');
}

/** Standard code entity labels */
export const CODE_LABELS = ['Function', 'Class', 'Interface', 'Variable', 'Component', 'Type'];
export const ALL_LABELS = ['File', ...CODE_LABELS];

export const VALID_LABELS: NodeLabel[] = [
  'File', 'Function', 'Class', 'Interface', 'Variable', 'Type', 'Component', 'Import',
];

export function extractNodeProps(node: Record<string, unknown>): Record<string, unknown> {
  if (node['properties'] && typeof node['properties'] === 'object') {
    return node['properties'] as Record<string, unknown>;
  }
  return node;
}

export function getLabelFromLabels(labels: string[]): NodeLabel {
  const found = labels.find(l => VALID_LABELS.includes(l as NodeLabel));
  return (found as NodeLabel) ?? 'File';
}

export function generateNodeId(label: NodeLabel, props: Record<string, unknown>): string {
  if (label === 'File') {
    return `File:${props['path'] ?? ''}`;
  }
  const name = props['name'] ?? '';
  const filePath = props['filePath'] ?? '';
  const line = props['startLine'] ?? props['line'] ?? 0;
  return `${label}:${filePath}:${name}:${line}`;
}
