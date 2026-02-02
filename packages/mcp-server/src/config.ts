/**
 * MCP Context Configuration Manager
 * 
 * Manages which projects are active in the MCP context.
 * Persists to ~/.codegraph/mcp-context.json
 */

import { homedir } from 'os';
import { join } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { createLogger } from '@codegraph/logger';

const logger = createLogger({ namespace: 'MCP:Config' });

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
    await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
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
