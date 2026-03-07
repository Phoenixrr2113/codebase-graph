/**
 * Shared test helpers for MCP tool tests
 */

import { closeGraphClient } from '@codegraph/core';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Known source directory stored in the test database (derived dynamically) */
export const SRC_DIR = resolve(__dirname, '../../../graph/src');
export const MCP_DIR = resolve(__dirname, '..');

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
