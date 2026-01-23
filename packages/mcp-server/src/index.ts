/**
 * CodeGraph MCP Server - Entry Point
 * Run with: pnpm --filter @codegraph/mcp-server dev
 */

import { createMCPServer } from './server.js';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'MCP:Main' });

async function main(): Promise<void> {
  const server = createMCPServer();

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    logger.info('Received SIGINT, shutting down...');
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM, shutting down...');
    await server.stop();
    process.exit(0);
  });

  try {
    await server.start();
  } catch (error) {
    logger.error('Failed to start MCP server', { error });
    process.exit(1);
  }
}

main().catch((error) => {
  logger.error('Unhandled error in main', { error });
  process.exit(1);
});
