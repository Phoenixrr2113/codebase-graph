/**
 * SearchService — thin wrapper, delegates to enrichedSearchV2.
 * @module services/search-service
 */

import { getGraphClient } from '../graphClient';
import { getActiveProjectPaths } from '../config';
import { enrichedSearchV2 } from '../enrichedSearchV2';
import type { EnrichedV2Result, EnrichedV2Options } from '../enrichedSearchV2';
import type { GraphClient } from '@codegraph/graph';

// ============================================================================
// Search
// ============================================================================

/**
 * Primary search — vector retrieval + cross-encoder reranking.
 *
 * When no explicit scope is provided and the scope is not "all",
 * auto-scopes to active projects from config.
 */
export async function searchImpl(
  query: string,
  options?: { limit?: number; scope?: string; client?: GraphClient },
): Promise<EnrichedV2Result> {
  const client = options?.client ?? await getGraphClient();

  const opts: EnrichedV2Options = {
    limit: options?.limit ?? 20,
  };

  if (options?.scope && options.scope !== 'all') {
    // Explicit scope provided
    opts.scope = options.scope;
  } else if (!options?.scope) {
    // No scope — auto-inject active projects
    const activePaths = await getActiveProjectPaths();
    if (activePaths.length === 1) {
      opts.scope = activePaths[0]!;
    } else if (activePaths.length > 1) {
      opts.scopePaths = activePaths;
    }
    // activePaths.length === 0 → search all (no filtering)
  }
  // scope === 'all' → no filtering (intentional)

  return enrichedSearchV2(query, client, opts);
}

// ============================================================================
// Warmup
// ============================================================================

/**
 * Pre-initialize embedding model for faster first search.
 */
export async function warmupSearch(): Promise<void> {
  const start = performance.now();

  try {
    const nlp = await import('@codegraph/plugin-nlp');
    await nlp.warmupEmbedding();
  } catch {
    // plugin-nlp not available — non-fatal
  }

  const ms = (performance.now() - start).toFixed(0);
  const { createLogger: cl } = await import('@codegraph/logger');
  cl({ namespace: 'core:warmup' }).info(`Search warmup complete in ${ms}ms`);
}
