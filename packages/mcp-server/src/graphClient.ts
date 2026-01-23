/**
 * Shared Graph Client for MCP Tools
 * 
 * Singleton pattern to avoid creating multiple FalkorDB connections.
 * All MCP tools should import getGraphClient from this module.
 */

import { createClient, type GraphClient } from '@codegraph/graph';

let graphClient: GraphClient | null = null;

/**
 * Get the shared graph client instance.
 * Creates the client on first call, returns cached instance thereafter.
 */
export async function getGraphClient(): Promise<GraphClient> {
  if (!graphClient) {
    graphClient = await createClient();
  }
  return graphClient;
}

/**
 * Close the graph client connection.
 * Call this when shutting down the MCP server.
 */
export async function closeGraphClient(): Promise<void> {
  if (graphClient) {
    await graphClient.close();
    graphClient = null;
  }
}
