import { describe, it, expect, beforeEach } from 'vitest';
import { SearchCache } from '../searchCache';

describe('SearchCache', () => {
  let cache: SearchCache<string>;
  beforeEach(() => {
    cache = new SearchCache<string>(3);
  });

  it('returns undefined on miss', () => {
    expect(cache.get('a')).toBeUndefined();
  });

  it('returns value on hit', () => {
    cache.set('a', 'value-a');
    expect(cache.get('a')).toBe('value-a');
  });

  it('evicts least-recently-used entry past capacity', () => {
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');
    cache.set('d', '4'); // evicts 'a'
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('2');
    expect(cache.get('c')).toBe('3');
    expect(cache.get('d')).toBe('4');
  });

  it('access touches recency (LRU, not FIFO)', () => {
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3');
    cache.get('a'); // touch 'a' → now 'b' is LRU
    cache.set('d', '4');
    expect(cache.get('a')).toBe('1');
    expect(cache.get('b')).toBeUndefined();
  });

  it('clear() empties the cache', () => {
    cache.set('a', '1');
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
  });

  it('reports hit/miss counts', () => {
    cache.set('a', '1');
    cache.get('a'); // hit
    cache.get('b'); // miss
    cache.get('a'); // hit
    expect(cache.stats()).toEqual({ hits: 2, misses: 1, size: 1 });
  });
});
