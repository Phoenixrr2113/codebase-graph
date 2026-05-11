import { describe, expect, it } from 'vitest';
import { rrfFuse } from '../enrichedSearchV2';

describe('rrfFuse with per-item scoreOf weighting', () => {
  type Item = { id: string };
  const key = (i: Item) => i.id;

  it('multiplies per-item contribution by scoreOf return value', () => {
    const items: Item[] = [
      { id: 'a' }, // rank 1 → base 1/61
      { id: 'b' }, // rank 2 → base 1/62
    ];

    // With scoreOf: a=1.0 (full), b=0.1 (heavily penalized)
    const fused = rrfFuse(
      [{ items, weight: 1, scoreOf: (i) => (i.id === 'a' ? 1.0 : 0.1) }],
      key,
    );

    // a should rank first, b should have ~10x lower contribution
    expect(fused[0]?.item.id).toBe('a');
    expect(fused[1]?.item.id).toBe('b');

    const aScore = fused[0]!.score;
    const bScore = fused[1]!.score;

    // a: 1.0 * 1 / 61 ≈ 0.01639
    // b: 0.1 * 1 / 62 ≈ 0.00161
    expect(aScore).toBeCloseTo(1.0 / 61, 5);
    expect(bScore).toBeCloseTo(0.1 / 62, 5);
  });

  it('defaults to 1.0 when scoreOf is omitted (backward compatible)', () => {
    const items: Item[] = [{ id: 'a' }, { id: 'b' }];
    const fused = rrfFuse([{ items, weight: 1 }], key);

    expect(fused[0]?.score).toBeCloseTo(1.0 / 61, 5);
    expect(fused[1]?.score).toBeCloseTo(1.0 / 62, 5);
  });

  it('sums contributions when same item appears in multiple lists', () => {
    const a: Item = { id: 'shared' };
    const fused = rrfFuse(
      [
        { items: [a], weight: 1, scoreOf: () => 0.5 },
        { items: [a], weight: 1, scoreOf: () => 0.8 },
      ],
      key,
    );

    expect(fused).toHaveLength(1);
    // 0.5/61 + 0.8/61 = 1.3/61
    expect(fused[0]?.score).toBeCloseTo(1.3 / 61, 5);
  });
});
