/**
 * CodeGraph Context Configuration Manager
 *
 * Manages which projects are active in the CodeGraph context.
 * Persists to ~/.codegraph/mcp-context.json
 */

import { homedir } from 'os';
import { join } from 'path';
import { readFile, writeFile, mkdir, rename } from 'fs/promises';
import { existsSync } from 'fs';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'Core:Config' });

// ============================================================================
// Types
// ============================================================================

export interface MCPContextConfig {
  /** Active project names or rootPaths */
  activeProjects: string[];
  /** When config was last updated */
  lastUpdated: string;
  /** Has user completed initial setup? */
  setupComplete: boolean;
  /** When a tool was last invoked (for staleness detection) */
  lastUsed?: string;
  /** Projects previously synced into the graph by MCP (survives restarts) */
  managedProjects?: string[];
}

export interface ProjectInfo {
  name: string;
  rootPath: string;
  fileCount: number;
  lastIndexed?: string;
}

// ============================================================================
// Config Path
// ============================================================================

const CONFIG_DIR = join(homedir(), '.codegraph');
const CONFIG_FILE = join(CONFIG_DIR, 'mcp-context.json');

// ============================================================================
// Config Operations
// ============================================================================

/**
 * Load the MCP context config
 */
export async function loadConfig(): Promise<MCPContextConfig | null> {
  try {
    if (!existsSync(CONFIG_FILE)) {
      return null;
    }
    const content = await readFile(CONFIG_FILE, 'utf-8');
    return JSON.parse(content) as MCPContextConfig;
  } catch (error) {
    logger.warn('Failed to load config', { error });
    return null;
  }
}

/**
 * Save the MCP context config
 */
export async function saveConfig(config: MCPContextConfig): Promise<void> {
  try {
    if (!existsSync(CONFIG_DIR)) {
      await mkdir(CONFIG_DIR, { recursive: true });
    }
    // Atomic write: write to temp file, then rename
    const tmpFile = CONFIG_FILE + '.tmp';
    await writeFile(tmpFile, JSON.stringify(config, null, 2));
    await rename(tmpFile, CONFIG_FILE);
    logger.info('Config saved', { projects: config.activeProjects });
  } catch (error) {
    logger.error('Failed to save config', { error });
    throw error;
  }
}

/**
 * Check if initial setup is needed
 */
export async function needsSetup(): Promise<boolean> {
  const config = await loadConfig();
  return !config || !config.setupComplete;
}

/**
 * Get active project root paths for filtering queries
 */
export async function getActiveProjectPaths(): Promise<string[]> {
  const config = await loadConfig();
  if (!config || config.activeProjects.length === 0) {
    return []; // Empty = search all
  }
  return config.activeProjects;
}

/**
 * Set active projects and mark setup complete
 */
export async function setActiveProjects(projects: string[]): Promise<void> {
  const config: MCPContextConfig = {
    activeProjects: projects,
    lastUpdated: new Date().toISOString(),
    setupComplete: true,
  };
  await saveConfig(config);
}

/**
 * Update lastUsed timestamp
 */
export async function updateLastUsed(): Promise<void> {
  const config = await loadConfig();
  if (config) {
    config.lastUsed = new Date().toISOString();
    await saveConfig(config);
  }
}

/**
 * Get lastUsed timestamp
 */
export async function getLastUsed(): Promise<string | null> {
  const config = await loadConfig();
  return config?.lastUsed ?? null;
}

/** Default staleness threshold: 24 hours in milliseconds */
export const STALENESS_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Check if the MCP context is stale (hasn't been used recently).
 * Returns true if lastUsed is older than the threshold.
 */
export async function isStale(thresholdMs: number = STALENESS_THRESHOLD_MS): Promise<boolean> {
  const lastUsed = await getLastUsed();
  if (!lastUsed) return true; // Never used = stale
  const elapsed = Date.now() - new Date(lastUsed).getTime();
  return elapsed > thresholdMs;
}

/**
 * Clear config (for testing or reset)
 */
export async function clearConfig(): Promise<void> {
  try {
    if (existsSync(CONFIG_FILE)) {
      const { unlink } = await import('fs/promises');
      await unlink(CONFIG_FILE);
    }
  } catch (error) {
    logger.warn('Failed to clear config', { error });
  }
}
