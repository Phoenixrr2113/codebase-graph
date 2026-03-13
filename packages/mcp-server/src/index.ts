/**
 * CodeGraph MCP Server - Entry Point
 * Run with: pnpm --filter @codegraph/mcp-server dev
 */

import { createMCPServer } from './server';
import { closeGraphClient, warmupSearch } from '@codegraph/core';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'MCP:Main' });

async function main(): Promise<void> {
  const server = createMCPServer();

  // Handle graceful shutdown — close graph client before server
  // to ensure clean database disconnection (FalkorDB / FalkorDBLite / legacy Kuzu)
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down...');
    await closeGraphClient();
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down...');
    await closeGraphClient();
    await server.stop();
    process.exit(0);
  });

  try {
    await server.start();

    // Pre-warm search infrastructure in background (PERF.15)
    warmupSearch().catch((err) => {
      logger.warn('Search warmup failed (non-fatal):', err);
    });
  } catch (error) {
    logger.error('Failed to start MCP server', { error });
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error('Unhandled error in main', { error });
  process.exit(1);
});
