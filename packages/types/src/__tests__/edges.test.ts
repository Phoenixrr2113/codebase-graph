import { describe, it, expect } from 'vitest';
import type { EdgeLabel, ExportsEdgeDescriptor, ImportsSymbolEdgeDescriptor } from '../edges';

/**
 * Locks in the batch-three edge-truthfulness cleanup: INSTANTIATES,
 * HAS_SECTION, CONTAINS_CODE, and LINKS_TO were declared in EdgeLabel/Edge
 * (and, for INSTANTIATES, backed by a Cypher template) but had zero call
 * sites ever writing them, so no node in the graph could ever actually carry
 * one. They were removed rather than left as edge types the schema promises
 * but the write layer never delivers.
 *
 * The actual compile-time enforcement lives in ../edge-label-invariants.ts,
 * not here: this package's tsconfig excludes `**\/*.test.ts` from
 * `tsc --noEmit`/`tsc build`, and vitest's default `run` mode does not
 * type-check test files at all (types are erased by the transform before
 * tests execute), so a `: SomeType = value` annotation in THIS file would
 * never actually fail even if the type were wrong. The checks below are
 * runtime-only: string/array comparisons that hold regardless of whether
 * anything type-checked them, kept here as a readable, always-executed
 * companion to the real (type-level) guarantee in edge-label-invariants.ts.
 */

describe('EdgeLabel union: batch-three edge-truthfulness cleanup', () => {
  it('runtime spot-check: the full known-good EdgeLabel set matches exactly, no more no less', () => {
    // Deliberately hand-typed, not derived from EdgeLabel: catches an
    // accidental duplicate addition to the union too (a union doesn't
    // record duplicates, so a type-level check alone wouldn't notice).
    const knownLabels: readonly EdgeLabel[] = [
      'CONTAINS', 'IMPORTS', 'IMPORTS_SYMBOL', 'CALLS', 'EXTENDS', 'IMPLEMENTS',
      'USES_TYPE', 'RETURNS', 'HAS_PARAM', 'HAS_METHOD', 'HAS_PROPERTY', 'RENDERS',
      'INTRODUCED_IN', 'MODIFIED_IN', 'DELETED_IN', 'EXPORTS', 'PARENT_SECTION', 'ABOUT',
    ];
    expect(new Set(knownLabels).size).toBe(knownLabels.length);
    expect(knownLabels).toHaveLength(18);

    const removed = ['INSTANTIATES', 'HAS_SECTION', 'CONTAINS_CODE', 'LINKS_TO'];
    for (const label of removed) {
      expect(knownLabels).not.toContain(label);
    }
  });

  it('ExportsEdgeDescriptor and ImportsSymbolEdgeDescriptor are usable pipeline transport shapes', () => {
    const exportsDescriptor: ExportsEdgeDescriptor = {
      filePath: '/proj/lib.ts',
      symbolName: 'doThing',
      symbolKind: 'Function',
    };
    const importsSymbolDescriptor: ImportsSymbolEdgeDescriptor = {
      fromFilePath: '/proj/app.ts',
      toFilePath: '/proj/lib.ts',
      symbolName: 'doThing',
      isDefault: false,
    };
    expect(exportsDescriptor.symbolKind).toBe('Function');
    expect(importsSymbolDescriptor.isDefault).toBe(false);
  });
});
