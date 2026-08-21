import { describe, it, expect } from 'vitest';
import {
  NODE_LABELS,
  SYMBOL_LABELS,
  REFERENCEABLE_LABELS,
  EMBEDDABLE_LABELS,
  SUMMARY_LABELS,
  ALL_GRAPH_LABELS,
  resolveNodeLabel,
} from '../labels';

/**
 * Locks in the exact membership of every canonical label constant. These
 * constants replace inline string arrays that had already drifted apart
 * across packages/graph, so this test is the single place a future label
 * addition or removal has to be reconciled, instead of six call sites
 * quietly disagreeing again.
 */
describe('canonical label constants', () => {
  it('NODE_LABELS: every NodeLabel value, matching getLabelFromLabels old validLabels list', () => {
    expect([...NODE_LABELS].sort()).toEqual(
      [
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
      ].sort(),
    );
  });

  it('SYMBOL_LABELS: the 7-label union used by embedding/vector-search sites in operations.ts', () => {
    expect([...SYMBOL_LABELS].sort()).toEqual(
      ['File', 'Function', 'Class', 'Interface', 'Variable', 'Type', 'Component'].sort(),
    );
  });

  it('REFERENCEABLE_LABELS: SYMBOL_LABELS plus External, matching GET_FULL_GRAPH_NODES and the edge target side', () => {
    expect([...REFERENCEABLE_LABELS].sort()).toEqual(
      ['File', 'Function', 'Class', 'Interface', 'Variable', 'Type', 'Component', 'External'].sort(),
    );
  });

  it('EMBEDDABLE_LABELS: SYMBOL_LABELS plus Entity, matching falkordb-shared provenance and vector target lists', () => {
    expect([...EMBEDDABLE_LABELS].sort()).toEqual(
      ['File', 'Function', 'Class', 'Interface', 'Variable', 'Type', 'Component', 'Entity'].sort(),
    );
  });

  it('SUMMARY_LABELS: the 5-label subset used by fileTree.ts getIndexSummary', () => {
    expect([...SUMMARY_LABELS].sort()).toEqual(
      ['File', 'Function', 'Class', 'Interface', 'Component'].sort(),
    );
  });

  it('ALL_GRAPH_LABELS: every label FalkorDB may see, matching falkordb-shared dummy-node allLabels list', () => {
    expect([...ALL_GRAPH_LABELS].sort()).toEqual(
      [
        'File',
        'Function',
        'Class',
        'Interface',
        'Variable',
        'Type',
        'TypeRef',
        'Component',
        'Entity',
        'Project',
        'Commit',
        'Metadata',
        'MarkdownDocument',
        'Section',
        'CodeBlock',
        'Link',
      ].sort(),
    );
  });

  it('REFERENCEABLE_LABELS and EMBEDDABLE_LABELS both extend SYMBOL_LABELS with no member dropped', () => {
    for (const label of SYMBOL_LABELS) {
      expect(REFERENCEABLE_LABELS).toContain(label);
      expect(EMBEDDABLE_LABELS).toContain(label);
    }
  });

  it('SUMMARY_LABELS is a subset of SYMBOL_LABELS', () => {
    for (const label of SUMMARY_LABELS) {
      expect(SYMBOL_LABELS).toContain(label);
    }
  });

  it('ALL_GRAPH_LABELS is a superset of SYMBOL_LABELS', () => {
    for (const label of SYMBOL_LABELS) {
      expect(ALL_GRAPH_LABELS).toContain(label);
    }
  });
});

describe('resolveNodeLabel', () => {
  it('classifies every NODE_LABELS member from a single-label list', () => {
    for (const label of NODE_LABELS) {
      expect(resolveNodeLabel([label])).toBe(label);
    }
  });

  it('classifies a Commit node correctly, unlike a classifier limited to the 7 symbol labels', () => {
    expect(resolveNodeLabel(['Commit'])).toBe('Commit');
  });

  it('classifies MarkdownDocument, Section, CodeBlock and Link, the other labels a narrower allowlist would miss', () => {
    expect(resolveNodeLabel(['MarkdownDocument'])).toBe('MarkdownDocument');
    expect(resolveNodeLabel(['Section'])).toBe('Section');
    expect(resolveNodeLabel(['CodeBlock'])).toBe('CodeBlock');
    expect(resolveNodeLabel(['Link'])).toBe('Link');
  });

  it('returns undefined for a label list with no recognized NodeLabel value', () => {
    expect(resolveNodeLabel(['External'])).toBeUndefined();
    expect(resolveNodeLabel(['Entity'])).toBeUndefined();
    expect(resolveNodeLabel([])).toBeUndefined();
  });

  it('prefers the real label over a marker label, in whatever order the database returned them', () => {
    // An External-marked File node carries both labels; the real label must
    // win regardless of which position it appears in.
    expect(resolveNodeLabel(['File', 'External'])).toBe('File');
    expect(resolveNodeLabel(['External', 'File'])).toBe('File');
  });
});
