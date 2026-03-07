/**
 * Shared graph connection helper for CLI commands
 *
 * Centralizes the createClient({host, port, graphName}) pattern
 * that all CLI commands use with --host, --port, --graph options.
 */

import { createClient, type GraphClient } from '@codegraph/graph';

export interface ConnectionOptions {
  host: string;
  port: string;
  graph: string;
}

export async function connectGraph(options: ConnectionOptions): Promise<GraphClient> {
  return createClient({
    host: options.host,
    port: parseInt(options.port),
    graphName: options.graph,
  });
}
