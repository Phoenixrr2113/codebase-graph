/**
 * The fallback text search in GET /api/search builds its Cypher label filter
 * by interpolating the `types` query parameter directly into the WHERE
 * clause, because Cypher has no way to parameterize a label. That means an
 * unvalidated `types` value is a straight injection: `types=Function) OR
 * (true` closes the label predicate early and turns the rest of the WHERE
 * clause into a tautology, matching every node regardless of label.
 * `parseTypeFilter` is the validation that has to stand between the raw
 * query parameter and the query string.
 */

import { describe, it, expect } from 'vitest';
import { parseTypeFilter } from '../routes/search';

describe('parseTypeFilter', () => {
  it('allows no filter at all', () => {
    expect(parseTypeFilter(undefined)).toEqual({ ok: true, labels: null });
    expect(parseTypeFilter('')).toEqual({ ok: true, labels: null });
  });

  it('accepts a single known label', () => {
    expect(parseTypeFilter('Function')).toEqual({ ok: true, labels: ['Function'] });
  });

  it('accepts a comma-separated list of known labels', () => {
    expect(parseTypeFilter('Function,Class')).toEqual({ ok: true, labels: ['Function', 'Class'] });
  });

  it('trims whitespace around each label', () => {
    expect(parseTypeFilter(' Function , Class ')).toEqual({ ok: true, labels: ['Function', 'Class'] });
  });

  it('rejects the injection payload from the reported defect', () => {
    const result = parseTypeFilter('Function) OR (true');
    expect(result.ok).toBe(false);
  });

  it('rejects a label that is not in the allowlist', () => {
    const result = parseTypeFilter('DROP');
    expect(result.ok).toBe(false);
  });

  it('names the offending value in the error rather than the raw Cypher', () => {
    const result = parseTypeFilter('Function) OR (true');
    if (result.ok) throw new Error('expected rejection');
    expect(result.message).toContain('Function) OR (true');
    expect(result.message).not.toContain('MATCH');
    expect(result.message).not.toContain('WHERE');
  });

  it('rejects when any one label in a list is invalid, even if the rest are valid', () => {
    const result = parseTypeFilter('Function,DROP TABLE');
    expect(result.ok).toBe(false);
  });

  it('accepts every label the fallback query defaults to', () => {
    for (const label of ['File', 'Function', 'Class', 'Interface', 'Variable', 'Type', 'Component']) {
      expect(parseTypeFilter(label)).toEqual({ ok: true, labels: [label] });
    }
  });
});
