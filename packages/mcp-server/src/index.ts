#!/usr/bin/env node
/**
 * CodeGraph MCP Server - Entry Point
 *
 * Usage:
 *   pnpm --filter @codegraph/mcp-server dev    # development
 *   node dist/index.js                          # production
 *   codegraph-mcp                               # via npm bin link
 */

// MCP stdio transport requires stdout to be clean JSON-RPC — force all logs to stderr
process.env.CODEGRAPH_LOG_STDERR = 'true';

// Prevent EPIPE crashes when MCP client disconnects while we're writing
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});

// Node 20+ required (global fetch, crypto.randomUUID, etc.)
const [major] = process.versions.node.split('.').map(Number);
if (major != null && major < 20) {
  process.stderr.write(
    `[CodeGraph] Error: Node.js >= 20.0.0 required (found ${process.versions.node}). ` +
    `Please update Node.js or configure Claude Desktop to use a newer version.\n`
  );
  process.exit(1);
}

import { createMCPServer } from './server';
import {
  closeGraphClient,
  warmupSearch,
  codeGraphService,
  startWatching,
  stopWatching,
  indexSingleFile,
} from '@codegraph/core';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'MCP:Main' });

/**
 * Start file watchers for all configured projects.
 * On file change → re-index that single file (incremental).
 * On file delete → remove it from the graph.
 */
async function startAutoReindex(): Promise<void> {
  try {
    const projects = await codeGraphService.getProjects();

    if (projects.length === 0) {
      logger.info('No projects configured — skipping file watcher');
      return;
    }

    let started = 0;
    for (const project of projects) {
      const projectPath = project.rootPath;
      if (!projectPath) continue;

      logger.info(`Starting file watcher for: ${projectPath}`);

      try {
        await startWatching({
          projectPath,
          debounceMs: 1000,
          onFileChanged: async (filePath: string) => {
            try {
              const result = await indexSingleFile(filePath, projectPath);
              if (result.success) {
                logger.info(`Auto-indexed: ${filePath} (${result.entities} entities)`);
              } else {
                logger.warn(`Auto-index failed: ${filePath}`, result.error);
              }
              return result;
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              logger.error(`Auto-index error: ${filePath}`, msg);
              return { success: false, error: msg };
            }
          },
          onFileRemoved: async (filePath: string) => {
            try {
              await codeGraphService.removeFileAndCleanup(filePath);
              logger.info(`Auto-removed from graph: ${filePath}`);
              return { success: true };
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              logger.error(`Auto-remove error: ${filePath}`, msg);
              return { success: false, error: msg };
            }
          },
        });
        started++;
      } catch (err) {
        logger.warn(`Failed to start watcher for ${projectPath}:`, err);
      }
    }

    logger.info(`File watcher active for ${started} project(s)`);
  } catch (err) {
    logger.warn('Auto-reindex setup failed (non-fatal):', err);
  }
}

async function main(): Promise<void> {
  const server = createMCPServer();

  // Handle graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    await stopWatching();
    await closeGraphClient();
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  try {
    await server.start();

    // Pre-warm search + start file watchers in background
    warmupSearch().catch((err) => {
      logger.warn('Search warmup failed (non-fatal):', err);
    });

    startAutoReindex().catch((err) => {
      logger.warn('Auto-reindex setup failed (non-fatal):', err);
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
