/**
 * Per-process LRU cache for search results.
 *
 * Used to avoid redundant enrichedSearchV2 calls during multi-tool-call
 * agent turns within a single MCP session. Map iteration order in JS is
 * insertion order, so deleting + re-inserting on access provides LRU
 * semantics without a doubly-linked list.
 *
 * Pattern from supermemory's cache.ts:8-74.
 */
export class SearchCache<V> {
  private readonly map = new Map<string, V>();
  private hitCount = 0;
  private missCount = 0;

  constructor(private readonly maxEntries: number = 100) {
    if (maxEntries <= 0) throw new Error('maxEntries must be positive');
  }

  get(key: string): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) {
      this.missCount++;
      return undefined;
    }
    // Touch: delete + re-insert to mark most-recently-used
    this.map.delete(key);
    this.map.set(key, value);
    this.hitCount++;
    return value;
  }

  set(key: string, value: V): void {
    // If the key already exists, delete to update insertion position
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    // Evict oldest entries while past capacity
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  clear(): void {
    this.map.clear();
    this.hitCount = 0;
    this.missCount = 0;
  }

  stats(): { hits: number; misses: number; size: number } {
    return { hits: this.hitCount, misses: this.missCount, size: this.map.size };
  }
}

/** Module-level singleton used by enrichedSearchV2. */
export const searchCache = new SearchCache<unknown>(100);

/**
 * Build a stable cache key from search inputs.
 *
 * Fields mirror the EnrichedV2Options fields actually accepted by
 * enrichedSearchV2Impl: scope, limit (plus query and searchScope which
 * live at the call site or in the router layer).
 */
export function searchCacheKey(parts: {
  projectPath?: string;
  query: string;
  scope?: string;
  limit?: number;
  searchScope?: string;
}): string {
  return [
    parts.projectPath ?? '',
    parts.query,
    parts.scope ?? '',
    parts.limit ?? 0,
    parts.searchScope ?? 'code',
  ].join('\x00');
}
