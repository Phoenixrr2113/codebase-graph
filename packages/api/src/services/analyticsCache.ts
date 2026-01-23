/**
 * Analytics Cache Service
 * 
 * In-memory cache for analytics results with TTL support.
 * Data persists until server restart.
 * 
 * @module services/analyticsCache
 */

import { createHash } from 'node:crypto';

/**
 * Cache entry with expiration
 */
interface CacheEntry<T> {
  data: T;
  fileHash: string | undefined;
  createdAt: Date;
  expiresAt: Date;
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  /** TTL in seconds for each analysis type */
  ttl: {
    security: number;
    complexity: number;
    refactoring: number;
    dataflow: number;
    impact: number;
    summary: number;
  };
}

/**
 * Default cache configuration
 */
export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  ttl: {
    security: 300,        // 5 minutes
    complexity: 3600,     // 1 hour (static until reindex)
    refactoring: 3600,    // 1 hour
    dataflow: 600,        // 10 minutes
    impact: 300,          // 5 minutes
    summary: 60,          // 1 minute
  },
};

/**
 * Analytics type for cache key generation
 */
export type AnalyticsType = keyof CacheConfig['ttl'];

/**
 * In-memory analytics cache
 * 
 * Note: Data is lost on server restart. For production persistence,
 * consider upgrading to Redis.
 */
export class AnalyticsCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private config: CacheConfig;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = {
      ttl: { ...DEFAULT_CACHE_CONFIG.ttl, ...config.ttl },
    };
  }

  /**
   * Generate cache key
   */
  private generateKey(type: AnalyticsType, projectPath: string, extra?: string): string {
    const parts = ['analytics', type, projectPath];
    if (extra) parts.push(extra);
    return parts.join(':');
  }

  /**
   * Get cached result if valid
   */
  get<T>(type: AnalyticsType, projectPath: string, extra?: string): T | null {
    const key = this.generateKey(type, projectPath, extra);
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    
    if (!entry) return null;
    
    // Check expiration
    if (new Date() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    
    return entry.data;
  }

  /**
   * Store result in cache
   */
  set<T>(type: AnalyticsType, projectPath: string, data: T, extra?: string, fileHash?: string): void {
    const key = this.generateKey(type, projectPath, extra);
    const ttlSeconds = this.config.ttl[type];
    const now = new Date();
    
    this.cache.set(key, {
      data,
      fileHash,
      createdAt: now,
      expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
    });
  }

  /**
   * Check if cache entry exists and is valid
   */
  has(type: AnalyticsType, projectPath: string, extra?: string): boolean {
    return this.get(type, projectPath, extra) !== null;
  }

  /**
   * Invalidate cache for a project
   */
  invalidate(projectPath: string, type?: AnalyticsType): void {
    const prefix = type 
      ? `analytics:${type}:${projectPath}`
      : `analytics:`;
    
    for (const key of this.cache.keys()) {
      if (type) {
        if (key.startsWith(prefix)) {
          this.cache.delete(key);
        }
      } else if (key.includes(projectPath)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Invalidate all cache entries
   */
  invalidateAll(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; types: Record<string, number> } {
    const types: Record<string, number> = {};
    
    for (const key of this.cache.keys()) {
      const type = key.split(':')[1] ?? 'unknown';
      types[type] = (types[type] ?? 0) + 1;
    }
    
    return { size: this.cache.size, types };
  }

  /**
   * Generate file hash for cache invalidation
   */
  static hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex').slice(0, 16);
  }
}

// Singleton instance
let cacheInstance: AnalyticsCache | null = null;

/**
 * Get or create the analytics cache singleton
 */
export function getAnalyticsCache(config?: Partial<CacheConfig>): AnalyticsCache {
  if (!cacheInstance) {
    cacheInstance = new AnalyticsCache(config);
  }
  return cacheInstance;
}
