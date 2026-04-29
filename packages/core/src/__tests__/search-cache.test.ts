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

  describe('clearByPrefix()', () => {
    it('clears only entries whose key starts with the prefix', () => {
      const cache = new SearchCache<string>();
      cache.set('graph-a\x00query1', 'va1');
      cache.set('graph-a\x00query2', 'va2');
      cache.set('graph-b\x00query1', 'vb1');

      cache.clearByPrefix('graph-a\x00');

      expect(cache.get('graph-a\x00query1')).toBeUndefined();
      expect(cache.get('graph-a\x00query2')).toBeUndefined();
      expect(cache.get('graph-b\x00query1')).toBe('vb1');
    });
  });

  it('reports hit/miss counts', () => {
    cache.set('a', '1');
    cache.get('a'); // hit
    cache.get('b'); // miss
    cache.get('a'); // hit
    expect(cache.stats()).toEqual({ hits: 2, misses: 1, size: 1 });
  });
});

describe('searchCacheKey()', () => {
  it('produces different keys for different graphIds with same query', async () => {
    const { searchCacheKey } = await import('../searchCache');
    const keyA = searchCacheKey({ graphId: 'graph-a', query: 'hello' });
    const keyB = searchCacheKey({ graphId: 'graph-b', query: 'hello' });
    expect(keyA).not.toBe(keyB);
  });

  it('produces same key for identical graphId+query+options', async () => {
    const { searchCacheKey } = await import('../searchCache');
    const a = searchCacheKey({ graphId: 'g', query: 'q', limit: 10, scope: 'all' });
    const b = searchCacheKey({ graphId: 'g', query: 'q', limit: 10, scope: 'all' });
    expect(a).toBe(b);
  });

  it('produces different keys when limits differ', async () => {
    const { searchCacheKey } = await import('../searchCache');
    const a = searchCacheKey({ graphId: 'g', query: 'q', limit: 10 });
    const b = searchCacheKey({ graphId: 'g', query: 'q', limit: 20 });
    expect(a).not.toBe(b);
  });
});
