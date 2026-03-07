/**
 * Config Sync
 *
 * Watches the user's config file (~/.codegraph/mcp-context.json) and
 * automatically keeps the graph in sync:
 *
 * - Project added to activeProjects → auto-index into graph
 * - Project removed from activeProjects → auto-delete from graph
 *
 * The user edits the config directly. The MCP server reacts.
 */

import { createOperations } from '@codegraph/graph';
import { getGraphClient } from './graphClient';
import { loadConfig, saveConfig } from './config';
import { indexProject, isProjectIndexed } from './indexer';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'Core:ConfigSync' });

// ============================================================================
// State
// ============================================================================

/** The set of project rootPaths that MCP has synced into the graph */
let lastKnownProjects: Set<string> = new Set();
let syncInProgress = false;

// ============================================================================
// Sync Logic
// ============================================================================

/**
 * Sync the graph to match the user's config.
 *
 * Compares the config's activeProjects against our last known state.
 * - New projects (in config, not previously known) → index into graph
 * - Removed projects (previously known, no longer in config) → delete from graph
 *
 * Called on server startup and before tool calls.
 */
export async function syncConfigToGraph(): Promise<{
  indexed: string[];
  deleted: string[];
  errors: string[];
}> {
  if (syncInProgress) {
    return { indexed: [], deleted: [], errors: [] };
  }

  syncInProgress = true;
  const indexed: string[] = [];
  const deleted: string[] = [];
  const errors: string[] = [];

  try {
    const config = await loadConfig();
    const desiredProjects = new Set(config?.activeProjects ?? []);

    // On first run, populate lastKnownProjects from config's managedProjects
    // (persisted across restarts)
    if (lastKnownProjects.size === 0 && config?.managedProjects) {
      lastKnownProjects = new Set(config.managedProjects);
    }

    // ---- Index new projects ----
    for (const rootPath of desiredProjects) {
      if (!lastKnownProjects.has(rootPath)) {
        try {
          const alreadyIndexed = await isProjectIndexed(rootPath);
          if (!alreadyIndexed) {
            logger.info(`Config sync: indexing new project ${rootPath}`);
            const result = await indexProject(rootPath);
            if (result.success) {
              indexed.push(rootPath);
              logger.info(`Indexed: ${result.projectName} (${result.stats.files} files, ${result.stats.entities} entities)`);
            } else {
              errors.push(`Failed to index ${rootPath}: ${result.errorMessages.join(', ')}`);
            }
          }
        } catch (err) {
          const msg = `Error indexing ${rootPath}: ${err instanceof Error ? err.message : err}`;
          errors.push(msg);
          logger.warn(msg);
        }
      }
    }

    // ---- Delete removed projects ----
    for (const rootPath of lastKnownProjects) {
      if (!desiredProjects.has(rootPath)) {
        try {
          const client = await getGraphClient();
          const ops = createOperations(client);
          const project = await ops.getProjectByRoot(rootPath);
          if (project) {
            logger.info(`Config sync: deleting removed project ${project.name} (${rootPath})`);
            await ops.deleteProject(project.id);
            deleted.push(rootPath);
          }
        } catch (err) {
          const msg = `Error deleting ${rootPath}: ${err instanceof Error ? err.message : err}`;
          errors.push(msg);
          logger.warn(msg);
        }
      }
    }

    // ---- Update tracked state ----
    lastKnownProjects = new Set(desiredProjects);

    // Persist managedProjects so we survive restarts
    if (config) {
      config.managedProjects = [...desiredProjects];
      await saveConfig(config);
    }

    if (indexed.length > 0 || deleted.length > 0) {
      logger.info('Config sync complete', {
        indexed: indexed.length,
        deleted: deleted.length,
        errors: errors.length,
      });
    }
  } catch (err) {
    const msg = `Config sync failed: ${err instanceof Error ? err.message : err}`;
    errors.push(msg);
    logger.error(msg);
  } finally {
    syncInProgress = false;
  }

  return { indexed, deleted, errors };
}

/**
 * Run initial sync on server startup.
 * This ensures the graph matches the config before any tools are used.
 */
export async function initialSync(): Promise<void> {
  logger.info('Running initial config sync...');
  const result = await syncConfigToGraph();
  if (result.indexed.length > 0) {
    logger.info(`Initial sync indexed ${result.indexed.length} project(s)`);
  }
  if (result.deleted.length > 0) {
    logger.info(`Initial sync deleted ${result.deleted.length} project(s)`);
  }
  if (result.errors.length > 0) {
    logger.warn(`Initial sync had ${result.errors.length} error(s)`);
  }
}

// ============================================================================
// Debounced sync for tool calls
// ============================================================================

let lastSyncTime = 0;
const SYNC_DEBOUNCE_MS = 5000; // Don't re-sync more than once every 5s

/**
 * Check if config has changed and sync if needed.
 * Debounced to avoid re-syncing on every tool call.
 */
export async function syncIfNeeded(): Promise<void> {
  const now = Date.now();
  if (now - lastSyncTime < SYNC_DEBOUNCE_MS) {
    return;
  }
  lastSyncTime = now;

  // Quick check: re-read config and compare against lastKnownProjects
  const config = await loadConfig();
  const currentProjects = new Set(config?.activeProjects ?? []);

  // Check if anything changed
  if (setsEqual(currentProjects, lastKnownProjects)) {
    return; // No changes
  }

  // Something changed — full sync
  await syncConfigToGraph();
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const item of a) {
    if (!b.has(item)) return false;
  }
  return true;
}
