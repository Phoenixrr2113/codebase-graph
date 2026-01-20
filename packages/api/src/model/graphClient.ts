/**
 * Graph client singleton - shared database connection
 * Provides dependency injection pattern for routes and services
 * @module model/graphClient
 */

import {
  createClient as createFalkorClient,
  createOperations as createGraphOperations,
  createQueries as createGraphQueries,
  type GraphClient,
  type GraphOperations,
  type GraphQueries,
} from '@codegraph/graph';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'API:Model' });

/** Cached client instance */
let clientInstance: GraphClient | null = null;

/** Cached operations instance */
let opsInstance: GraphOperations | null = null;

/** Cached queries instance */
let queriesInstance: GraphQueries | null = null;

/**
 * Get or create the shared graph client
 * Uses singleton pattern to avoid multiple connections
 * 
 * @returns Connected graph client
 */
export async function getClient(): Promise<GraphClient> {
  if (!clientInstance) {
    logger.debug('Creating new graph client connection');
    clientInstance = await createFalkorClient();
  }
  return clientInstance;
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
 * Reset all cached instances
 * Useful for testing or reconnection scenarios
 */
export function resetClient(): void {
  clientInstance = null;
  opsInstance = null;
  queriesInstance = null;
  logger.debug('Graph client reset');
}
