/**
 * Shared Knowledge Operations for MCP Tools
 *
 * Singleton pattern — reuses the shared GraphClient to create
 * a KnowledgeOperations instance for knowledge graph tools.
 */

import { createKnowledgeOperations, type KnowledgeOperations } from '@codegraph/graph';
import { getGraphClient } from './graphClient';

let knowledgeOps: KnowledgeOperations | null = null;

/**
 * Get the shared KnowledgeOperations instance.
 * Creates on first call from the shared GraphClient.
 * Ensures the knowledge graph schema (Entity, RELATES_TO tables) exists.
 */
export async function getKnowledgeOps(): Promise<KnowledgeOperations> {
  if (!knowledgeOps) {
    const client = await getGraphClient();
    // Ensure knowledge graph tables exist (idempotent — safe on every call)
    await client.ensureIndexes();
    knowledgeOps = createKnowledgeOperations(client);
  }
  return knowledgeOps;
}

/**
 * Reset the singleton (called on shutdown or reconnect).
 */
export function resetKnowledgeOps(): void {
  knowledgeOps = null;
}
