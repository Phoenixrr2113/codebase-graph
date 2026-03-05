/**
 * Shared test helpers for MCP tool tests
 */

import { closeGraphClient } from '../graphClient';

/** Known source directory stored in the test database (absolute paths) */
export const SRC_DIR = '/path/to/user/Desktop/codebase-graph/packages/graph/src';
export const MCP_DIR = '/path/to/user/Desktop/codebase-graph/packages/mcp-server/src';

/** Known symbol that exists in the database */
export const KNOWN_SYMBOL = 'createClient';
export const KNOWN_FILE = `${SRC_DIR}/client.ts`;

/**
 * Close the shared graph client (call in afterAll)
 */
export async function teardownGraphClient(): Promise<void> {
  await closeGraphClient();
}

/**
 * Assert that a result has no error property, or throw with details
 */
export function assertNoError(result: unknown, context: string): void {
  const obj = result as Record<string, unknown> | null;
  if (obj?.error) {
    throw new Error(`${context}: ${String(obj.error)}`);
  }
}
