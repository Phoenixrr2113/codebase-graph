/**
 * Minimal LRU cache for @codegraph/tools middleware.
 *
 * Avoids re-running enrichedSearchV2 for identical queries within the same
 * agent turn or session. Map insertion-order gives LRU eviction for free.
 *
 * Pattern: packages/core/src/searchCache.ts.
 */

export class LruCache<V> {
  private readonly map = new Map<string, V>();

  constructor(private readonly maxEntries: number = 200) {}

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Touch: re-insert to mark most-recently-used
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
