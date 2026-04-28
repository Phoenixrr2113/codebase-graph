import { describe, expect, it } from 'vitest';
import { exactMatch } from '../../src/score/em.js';

describe('exactMatch', () => {
  it('1 when first result equals gold', () => {
    expect(exactMatch(['a', 'b'], 'a')).toBe(1);
  });
  it('0 when first result is wrong', () => {
    expect(exactMatch(['x', 'a'], 'a')).toBe(0);
  });
  it('0 on empty ranking', () => {
    expect(exactMatch([], 'a')).toBe(0);
  });
});
