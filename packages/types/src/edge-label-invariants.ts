/**
 * Compile-time invariants for the EdgeLabel union (batch-three
 * edge-truthfulness cleanup).
 *
 * These are type-level assertions, not runtime code: each `Assert*` alias
 * only type-checks successfully if the condition it names actually holds.
 * A vitest `*.test.ts` file cannot enforce this on its own, this package's
 * tsconfig excludes `**\/*.test.ts` from `tsc --noEmit`, and vitest's
 * default `run` mode does not type-check test files at all (types are
 * erased by the transform, so a wrong type annotation in a test body would
 * silently pass at runtime). This file has no `.test.ts` suffix, so it IS
 * compiled by `tsc` (both `build` and `typecheck`), which is what actually
 * turns "the union shouldn't contain X" into a build-breaking guarantee
 * instead of a comment someone can silently invalidate.
 *
 * INSTANTIATES, HAS_SECTION, CONTAINS_CODE, and LINKS_TO were declared in
 * EdgeLabel (and, for INSTANTIATES, backed by a Cypher template) but had
 * zero call sites ever writing them, so no graph node could ever actually
 * carry one; they were removed from edges.ts. EXPORTS, IMPORTS_SYMBOL, and
 * PARENT_SECTION are now genuinely built and written by the pipeline and
 * graph write layer (see @codegraph/core's pipeline.ts and
 * @codegraph/graph's operations.ts) and must stay in the union.
 */

import type { EdgeLabel } from './edges';

/** Generic that only accepts `never`: instantiating it with anything else is a compile error. */
type AssertNever<T extends never> = T;

/** Generic that only accepts the literal type `true`: instantiating it with `false` is a compile error. */
type AssertTrue<T extends true> = T;

type RemovedEdgeLabel = 'INSTANTIATES' | 'HAS_SECTION' | 'CONTAINS_CODE' | 'LINKS_TO';

/**
 * Extract<EdgeLabel, RemovedEdgeLabel> is `never` iff EdgeLabel contains
 * none of RemovedEdgeLabel's members. If any were reintroduced, this alias
 * would resolve to a non-`never` type and fail to satisfy AssertNever's
 * `T extends never` constraint, breaking `tsc --noEmit` / `tsc build` for
 * this package.
 */
export type AssertRemovedEdgeLabelsAreGone = AssertNever<Extract<EdgeLabel, RemovedEdgeLabel>>;

type RequiredEdgeLabel = 'EXPORTS' | 'IMPORTS_SYMBOL' | 'PARENT_SECTION';

/**
 * RequiredEdgeLabel extends EdgeLabel iff every member of RequiredEdgeLabel
 * is assignable to EdgeLabel, i.e. iff EdgeLabel includes all three. If one
 * were dropped, the conditional resolves to `false` and fails AssertTrue's
 * `T extends true` constraint.
 */
export type AssertRequiredEdgeLabelsArePresent = AssertTrue<RequiredEdgeLabel extends EdgeLabel ? true : false>;
