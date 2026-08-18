/**
 * Shared Graph Client for CodeGraph
 *
 * Singleton pattern to avoid creating multiple FalkorDB connections.
 * All packages should import getGraphClient from this module.
 */

import { createClient, type GraphClient } from '@codegraph/graph';

let graphClient: GraphClient | null = null;
let graphClientPromise: Promise<GraphClient> | null = null;

/**
 * Get the shared graph client instance.
 * Creates the client on first call, returns cached instance thereafter.
 */
export async function getGraphClient(): Promise<GraphClient> {
  if (graphClient) {
    return graphClient;
  }
  if (!graphClientPromise) {
    const connection = createClient().then((client) => {
      graphClient = client;
      return client;
    });
    graphClientPromise = connection;
    void connection.then(
      () => {
        if (graphClientPromise === connection) graphClientPromise = null;
      },
      () => {
        if (graphClientPromise === connection) graphClientPromise = null;
      },
    );
  }
  return graphClientPromise;
}

/**
 * Close the graph client connection.
 * Call this when shutting down.
 */
export async function closeGraphClient(): Promise<void> {
  if (graphClientPromise) {
    await graphClientPromise;
  }
  if (graphClient) {
    const client = graphClient;
    graphClient = null;
    await client.close();
  }
}
