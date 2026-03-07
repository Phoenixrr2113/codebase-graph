/**
 * Graph client singleton - shared database connection
 * Delegates to @codegraph/core's singleton for the underlying client,
 * and caches operations/queries wrappers on top.
 * @module model/graphClient
 */

import {
  createOperations as createGraphOperations,
  createQueries as createGraphQueries,
  type GraphClient,
  type GraphOperations,
  type GraphQueries,
} from '@codegraph/graph';
import { getGraphClient, closeGraphClient } from '@codegraph/core';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'API:Model' });

/** Cached operations instance */
let opsInstance: GraphOperations | null = null;

/** Cached queries instance */
let queriesInstance: GraphQueries | null = null;

/**
 * Get the shared graph client
 * Delegates to core's singleton to avoid duplicate connections
 *
 * @returns Connected graph client
 */
export async function getClient(): Promise<GraphClient> {
  return getGraphClient();
}

/**
 * Get or create the shared graph operations instance
 * Used for CRUD operations on entities
 *
 * @returns Graph operations instance
 */
export async function getOperations(): Promise<GraphOperations> {
  if (!opsInstance) {
    const client = await getClient();
    opsInstance = createGraphOperations(client);
  }
  return opsInstance;
}

/**
 * Get or create the shared graph queries instance
 * Used for read-only graph queries
 *
 * @returns Graph queries instance
 */
export async function getQueries(): Promise<GraphQueries> {
  if (!queriesInstance) {
    const client = await getClient();
    queriesInstance = createGraphQueries(client);
  }
  return queriesInstance;
}

/**
 * Reset all cached instances and close the underlying connection
 * Useful for testing or reconnection scenarios
 */
export async function resetClient(): Promise<void> {
  opsInstance = null;
  queriesInstance = null;
  await closeGraphClient();
  logger.debug('Graph client reset');
}
