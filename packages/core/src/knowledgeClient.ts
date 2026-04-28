/**
 * Shared Knowledge Operations for CodeGraph
 *
 * Singleton pattern (default) — reuses the shared GraphClient.
 * DI hook (when client is provided) — returns a fresh ops instance for
 * caller-managed lifecycle (e.g. third-party benchmark adapters, embedded
 * usage with a per-instance client).
 */

import { createKnowledgeOperations, type KnowledgeOperations, type GraphClient } from '@codegraph/graph';
import { getGraphClient } from './graphClient';

let knowledgeOps: KnowledgeOperations | null = null;

/**
 * Get a KnowledgeOperations instance.
 * - If `client` is provided: returns fresh ops for that client (no caching).
 *   Caller manages client lifecycle and schema. Mirrors embed-nodes.ts:330.
 * - Otherwise: returns the shared singleton bound to getGraphClient(),
 *   ensuring schema on first call.
 */
export async function getKnowledgeOps(client?: GraphClient): Promise<KnowledgeOperations> {
  if (client) {
    return createKnowledgeOperations(client);
  }
  if (!knowledgeOps) {
    const c = await getGraphClient();
    await c.ensureIndexes();
    knowledgeOps = createKnowledgeOperations(c);
  }
  return knowledgeOps;
}

/**
 * Reset the singleton (called on shutdown or reconnect).
 */
export function resetKnowledgeOps(): void {
  knowledgeOps = null;
}
