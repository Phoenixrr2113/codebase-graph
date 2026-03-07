/**
 * @codegraph/core — Shared infrastructure for CodeGraph
 *
 * Provides singleton graph client management, config persistence,
 * config-to-graph synchronization, project indexing, and schema docs.
 *
 * Consumers: @codegraph/mcp-server, @codegraph/api, @codegraph/cli
 */

// Client singletons
export { getGraphClient, closeGraphClient } from './graphClient';
export { getKnowledgeOps, resetKnowledgeOps } from './knowledgeClient';

// Config management
export {
  loadConfig,
  saveConfig,
  needsSetup,
  getActiveProjectPaths,
  setActiveProjects,
  updateLastUsed,
  getLastUsed,
  isStale,
  clearConfig,
  STALENESS_THRESHOLD_MS,
} from './config';
export type { MCPContextConfig, ProjectInfo } from './config';

// Config sync
export { syncConfigToGraph, initialSync, syncIfNeeded } from './configSync';

// Indexer
export { indexProject, indexSingleFile, isProjectIndexed } from './indexer';
export type { IndexStats, IndexResult } from './indexer';

// Schema docs
export { getSchemaDocumentation, getShortSchema } from './schema';
