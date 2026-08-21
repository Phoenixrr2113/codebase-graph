/**
 * The fallback text search in GET /api/search builds its Cypher label filter
 * by interpolating the `types` query parameter directly into the WHERE
 * clause, because Cypher has no way to parameterize a label. That means an
 * unvalidated `types` value is a straight injection: `types=Function) OR
 * (true` closes the label predicate early and turns the rest of the WHERE
 * clause into a tautology, matching every node regardless of label.
 * `resolveTypeFilter` is the validation that has to stand between the raw
 * query parameter and the query string.
 *
 * The allowlist itself is the live set of labels the graph contains
 * (discovered in graph-labels.ts), not a hardcoded guess, so it has to
 * include more than the seven "code symbol" types that support vector
 * search: this graph also has Commit, TypeRef, Project and Metadata nodes,
 * and filtering by any of them is a legitimate request, not an attack.
 * `resolveTypeFilter` takes that set as a parameter precisely so these tests
 * can exercise it without touching a real graph, including the edge case
 * where the set is empty because nothing has been indexed yet.
 */

import { describe, it, expect } from 'vitest';
import { resolveTypeFilter, typeFilterNotice } from '../routes/search';
import { SYMBOL_LABELS } from '@codegraph/types';

// Mirrors what /api/embeddings/status reports for this repository's own
// indexed graph: the seven embeddable code-symbol types (SYMBOL_LABELS,
// the shared source of truth in packages/types/src/labels.ts), plus Commit,
// TypeRef, Project and Metadata, which the vector-search allowlist never
// covered but the Cypher fallback path has always been able to match. The
// extra four are graph-structure labels specific to this fixture, not a
// canonical subset, so they stay spelled out here rather than living in
// @codegraph/types.
const KNOWN_LABELS = new Set<string>([
  ...SYMBOL_LABELS,
  'Commit', 'TypeRef', 'Project', 'Metadata',
]);

const EMPTY_LABELS = new Set<string>();

describe('resolveTypeFilter', () => {
  it('allows no filter at all', () => {
    expect(resolveTypeFilter(undefined, KNOWN_LABELS)).toEqual({ kind: 'none' });
    expect(resolveTypeFilter('', KNOWN_LABELS)).toEqual({ kind: 'none' });
  });

  it('accepts a single known label', () => {
    expect(resolveTypeFilter('Function', KNOWN_LABELS)).toEqual({ kind: 'labels', labels: ['Function'] });
  });

  it('accepts a comma-separated list of known labels', () => {
    expect(resolveTypeFilter('Function,Class', KNOWN_LABELS)).toEqual({ kind: 'labels', labels: ['Function', 'Class'] });
  });

  it('trims whitespace around each label', () => {
    expect(resolveTypeFilter(' Function , Class ', KNOWN_LABELS)).toEqual({ kind: 'labels', labels: ['Function', 'Class'] });
  });

  it('rejects the injection payload from the reported defect', () => {
    const result = resolveTypeFilter('Function) OR (true', KNOWN_LABELS);
    expect(result.kind).toBe('invalid');
  });

  it('rejects a label that is not in the allowlist', () => {
    const result = resolveTypeFilter('DROP', KNOWN_LABELS);
    expect(result.kind).toBe('invalid');
  });

  it('names the offending value in the error rather than the raw Cypher', () => {
    const result = resolveTypeFilter('Function) OR (true', KNOWN_LABELS);
    if (result.kind !== 'invalid') throw new Error('expected invalid');
    expect(result.message).toContain('Function) OR (true');
    expect(result.message).not.toContain('MATCH');
    expect(result.message).not.toContain('WHERE');
  });

  it('rejects when any one label in a list is invalid, even if the rest are valid', () => {
    const result = resolveTypeFilter('Function,DROP TABLE', KNOWN_LABELS);
    expect(result.kind).toBe('invalid');
  });

  it('accepts every label the fallback query defaults to', () => {
    for (const label of SYMBOL_LABELS) {
      expect(resolveTypeFilter(label, KNOWN_LABELS)).toEqual({ kind: 'labels', labels: [label] });
    }
  });

  // Regression coverage: these four were wrongly rejected by an allowlist
  // that only recognized vector-searchable labels. types=Commit was a
  // working, non-malicious request before that change.
  it('accepts Commit, a real label the vector-search allowlist never covered', () => {
    expect(resolveTypeFilter('Commit', KNOWN_LABELS)).toEqual({ kind: 'labels', labels: ['Commit'] });
  });

  it('accepts TypeRef, another real label outside the vector-search set', () => {
    expect(resolveTypeFilter('TypeRef', KNOWN_LABELS)).toEqual({ kind: 'labels', labels: ['TypeRef'] });
  });

  it('accepts Project and Metadata, the remaining regressed labels', () => {
    expect(resolveTypeFilter('Project', KNOWN_LABELS)).toEqual({ kind: 'labels', labels: ['Project'] });
    expect(resolveTypeFilter('Metadata', KNOWN_LABELS)).toEqual({ kind: 'labels', labels: ['Metadata'] });
  });

  it('accepts a mix of a code-symbol label and a graph-structure label together', () => {
    expect(resolveTypeFilter('Function,Commit', KNOWN_LABELS)).toEqual({ kind: 'labels', labels: ['Function', 'Commit'] });
  });

  it('still rejects a genuinely invalid label once the allowlist is widened', () => {
    const result = resolveTypeFilter('DROP', KNOWN_LABELS);
    expect(result.kind).toBe('invalid');
    if (result.kind !== 'invalid') throw new Error('expected invalid');
    expect(result.message).toContain('DROP');
  });

  // Empty-graph coverage: before this, an empty label set meant every
  // requested type failed the `.has()` check, so a perfectly well-formed
  // request like types=Function was rejected with a message that read
  // "Valid types are: ." (nothing after the colon), indistinguishable
  // from a typo, when the real cause is "nothing has been indexed yet".
  it('reports not-indexed rather than rejecting, when the graph has no labels yet', () => {
    expect(resolveTypeFilter('Function', EMPTY_LABELS)).toEqual({ kind: 'not-indexed' });
  });

  it('reports not-indexed for any well-formed label on an empty graph, not just one', () => {
    for (const types of ['Function', 'Commit,File', 'Interface']) {
      expect(resolveTypeFilter(types, EMPTY_LABELS)).toEqual({ kind: 'not-indexed' });
    }
  });

  it('reports not-indexed, not invalid, for the injection payload on an empty graph', () => {
    // The empty-graph branch is checked before the label list is even
    // split or compared, so the injection payload never reaches the
    // per-label validation at all here: it gets the same not-indexed
    // answer as a real label would, and in particular never becomes
    // `invalid` with the payload echoed into an error message, and never
    // becomes `labels` (which would be the actual "fell open" failure).
    const result = resolveTypeFilter('Function) OR (true', EMPTY_LABELS);
    expect(result).toEqual({ kind: 'not-indexed' });
  });

  it('does not report not-indexed once the graph has even one label', () => {
    const oneLabel = new Set(['File']);
    expect(resolveTypeFilter('File', oneLabel)).toEqual({ kind: 'labels', labels: ['File'] });
    expect(resolveTypeFilter('Function', oneLabel).kind).toBe('invalid');
  });

  // Third adversarial-review finding: a `types` value that is present but
  // normalizes to nothing (all commas, all whitespace, or a mix) used to
  // come back as `{ kind: 'labels', labels: [] }`. An empty array is
  // truthy in JavaScript, so the route treated it as "yes, filter", the
  // vector-hit filter discarded every hit (`[].includes(x)` is always
  // false), and the Cypher fallback built `WHERE () AND (...)` from
  // `[].map(...).join(' OR ')`, which FalkorDB rejects as invalid syntax.
  // The route's catch block then forwarded that engine error, Cypher text
  // included, straight back to the caller as a 500. None of that can
  // happen if `resolveTypeFilter` never returns an empty `labels` array in
  // the first place.
  it('rejects a whitespace-only types value rather than treating it as an empty label list', () => {
    const result = resolveTypeFilter(' ', KNOWN_LABELS);
    expect(result.kind).toBe('invalid');
  });

  it('rejects a comma-only types value the same way', () => {
    const result = resolveTypeFilter(',', KNOWN_LABELS);
    expect(result.kind).toBe('invalid');
  });

  it('rejects a mix of commas and whitespace that normalizes to nothing', () => {
    const result = resolveTypeFilter(' , , ', KNOWN_LABELS);
    expect(result.kind).toBe('invalid');
  });

  it('never returns kind: labels with an empty labels array, for any input', () => {
    for (const types of [' ', ',', ' , ', ',,,', '  ,  ,  ']) {
      const result = resolveTypeFilter(types, KNOWN_LABELS);
      if (result.kind === 'labels') {
        expect(result.labels.length).toBeGreaterThan(0);
      } else {
        expect(result.kind).toBe('invalid');
      }
    }
  });

  it('still treats a literal empty string as no filter at all, not as invalid', () => {
    // Distinguishing this from the whitespace/comma cases matters: an
    // empty string means the caller never set `types`, or their client
    // sent `types=` on purpose to mean "no filter". A stray space or comma
    // means they tried to say something and it didn't parse.
    expect(resolveTypeFilter('', KNOWN_LABELS)).toEqual({ kind: 'none' });
  });

  it('still accepts a trailing comma when a real label is present', () => {
    // The coordinator's own live check: types=Function, (trailing comma,
    // one real label) is fine and must stay fine.
    expect(resolveTypeFilter('Function,', KNOWN_LABELS)).toEqual({ kind: 'labels', labels: ['Function'] });
  });
});

describe('typeFilterNotice: vector-search path (reachedFallback = false)', () => {
  it('says nothing when the filtered result already fills the page', () => {
    expect(typeFilterNotice(['Interface'], 10, 10, 10, false)).toBeUndefined();
  });

  it('says nothing when the raw (pre-filter) search was not itself truncated', () => {
    // Only 6 raw hits existed for the whole query, below the limit of 10, so
    // filtering that small, exhaustive set down to 4 is not a shortfall,
    // since there was nothing beyond it that filtering could have missed.
    expect(typeFilterNotice(['Interface'], 6, 4, 10, false)).toBeUndefined();
  });

  it('warns when the raw search hit the limit and filtering left fewer results than asked for', () => {
    // This is the reported case: q=parse&types=Interface&limit=10 returning
    // 4 could mean "there are only 4 Interfaces" or "the ranked top 10,
    // before filtering, only happened to contain 4". The raw count hitting
    // the limit means the true total beyond the fetch window is unknown.
    const notice = typeFilterNotice(['Interface'], 10, 4, 10, false);
    expect(notice).toBeDefined();
    expect(notice).toContain('4');
    expect(notice).toContain('10');
    expect(notice).toContain('Interface');
  });

  it('names every requested label in the notice, not just the first', () => {
    const notice = typeFilterNotice(['Function', 'Commit'], 10, 2, 10, false);
    expect(notice).toContain('Function');
    expect(notice).toContain('Commit');
  });

  it('does not leak Cypher into the notice text', () => {
    const notice = typeFilterNotice(['Interface'], 10, 4, 10, false);
    expect(notice).not.toContain('MATCH');
    expect(notice).not.toContain('WHERE');
  });
});

describe('typeFilterNotice: fallback path (reachedFallback = true)', () => {
  // This is the second adversarial-review finding: a type filter that
  // removes every raw hit falls through to the Cypher substring fallback,
  // and the notice computed for the vector-search branch was previously
  // discarded there, because it was only attached inside the
  // `hits.length > 0` response. A caller then saw `total: 0` and had no way
  // to tell "nothing of this type exists" from "the ranked search found
  // real results, none were the requested type within the fetched window,
  // and a different, weaker substring search was then tried and also came
  // up empty (or found something unrelated by coincidence)".

  it('says nothing when the vector search itself found zero raw hits (the ordinary fallback trigger)', () => {
    // No embeddings, or genuinely no semantic match at all, unrelated to
    // type filtering. result.meta.notice already explains this case.
    expect(typeFilterNotice(['Variable'], 0, 0, 10, true)).toBeUndefined();
  });

  it('warns when a type filter emptied a page that had real raw hits (the reported bug)', () => {
    // q=graph client&limit=3&types=Variable: 3 raw hits existed (Class,
    // Interface, Function), all filtered out by types=Variable, 0 survive.
    const notice = typeFilterNotice(['Variable'], 3, 0, 3, true);
    expect(notice).toBeDefined();
    expect(notice).toContain('Variable');
  });

  it('mentions the substring fallback explicitly, not just a bare shortfall', () => {
    const notice = typeFilterNotice(['Variable'], 3, 0, 3, true);
    expect(notice).toMatch(/substring/i);
  });

  it('distinguishes a truncated raw window from an exhaustive one in the wording', () => {
    const truncated = typeFilterNotice(['Variable'], 10, 0, 10, true);
    const exhaustive = typeFilterNotice(['Variable'], 3, 0, 10, true);
    expect(truncated).toBeDefined();
    expect(exhaustive).toBeDefined();
    expect(truncated).not.toEqual(exhaustive);
  });

  it('still warns even when the raw window was not truncated, since the retrieval method still changed', () => {
    // 3 raw hits, limit 10: the vector search was not truncated, but it
    // still found real hits that were all filtered away, and the fallback
    // is still a different, weaker search than the one that ran first.
    const notice = typeFilterNotice(['Variable'], 3, 0, 10, true);
    expect(notice).toBeDefined();
  });

  it('does not leak Cypher into the fallback notice text either', () => {
    const notice = typeFilterNotice(['Variable'], 3, 0, 3, true);
    expect(notice).not.toContain('MATCH');
    expect(notice).not.toContain('WHERE');
  });
});
