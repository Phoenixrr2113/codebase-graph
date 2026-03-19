/**
 * Watch Service - File system watcher for incremental updates
 *
 * Uses chokidar 5.x (which doesn't support glob patterns) with fast-glob
 * for file discovery. Implements debouncing to prevent thrashing on rapid saves.
 *
 * Accepts event handler callbacks so consumers (API, CLI) can wire up
 * their own processing logic (e.g., parseSingleFile, removeFileFromGraph).
 */

import { watch, type FSWatcher } from 'chokidar';
import fastGlob from 'fast-glob';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { createLogger, traced } from '@codegraph/logger';
import { getSupportedExtensions, registerPlugins, DEFAULT_IGNORE_PATTERNS } from './pipeline';

const logger = createLogger({ namespace: 'core:Watch' });

/** File change event types */
export type FileEventType = 'add' | 'change' | 'unlink';

/** File change event data */
export interface FileChangeEvent {
  type: FileEventType;
  path: string;
  timestamp: number;
}

/** Handler for file add/change events */
export type FileChangedHandler = (filePath: string) => Promise<{ success: boolean; error?: string }>;

/** Handler for file unlink events */
export type FileRemovedHandler = (filePath: string) => Promise<{ success: boolean; error?: string }>;

/** Watch service configuration */
export interface WatchServiceConfig {
  /** Project path to watch */
  projectPath: string;
  /** Additional patterns to ignore */
  ignorePatterns?: string[];
  /** Debounce wait time in ms (default: 500) */
  debounceMs?: number;
  /** Whether to process initial files (default: false) */
  processInitial?: boolean;
  /** Handler called when a file is added or changed */
  onFileChanged?: FileChangedHandler;
  /** Handler called when a file is removed */
  onFileRemoved?: FileRemovedHandler;
}

/**
 * WatchService class - monitors file system and triggers incremental re-parses
 */
export class WatchService extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private projectPath: string;
  private ignorePatterns: string[];
  private debounceMs: number;
  private processInitial: boolean;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private isRunning = false;
  private onFileChanged: FileChangedHandler | undefined;
  private onFileRemoved: FileRemovedHandler | undefined;

  constructor(config: WatchServiceConfig) {
    super();
    this.projectPath = config.projectPath;
    this.ignorePatterns = [...DEFAULT_IGNORE_PATTERNS, ...(config.ignorePatterns ?? [])];
    this.debounceMs = config.debounceMs ?? 50;
    this.processInitial = config.processInitial ?? false;
    this.onFileChanged = config.onFileChanged;
    this.onFileRemoved = config.onFileRemoved;
  }

  /**
   * Start watching the project directory
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Already running');
      return;
    }

    logger.info(`Starting file watcher for: ${this.projectPath}`);

    // Ensure plugins are registered before querying supported extensions
    registerPlugins();

    // Load .gitignore patterns and merge with built-in ignores
    const gitignorePatterns = await loadGitignorePatterns(this.projectPath);
    const allIgnore = [...this.ignorePatterns, ...gitignorePatterns];

    // Discover initial files using fast-glob
    const supportedExts = getSupportedExtensions();
    const patterns = supportedExts.map(ext => `**/*${ext}`);
    const files = await fastGlob(patterns, {
      cwd: this.projectPath,
      absolute: true,
      ignore: allIgnore,
      onlyFiles: true,
    });

    logger.info(`Found ${files.length} source files`);

    // Create chokidar watcher with explicit file paths
    // (chokidar 5.x doesn't support glob patterns)
    this.watcher = watch(files, {
      persistent: true,
      ignoreInitial: !this.processInitial,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    });

    // Note: only watching known source files, not the project directory.
    // New files are picked up on the next incremental reindex.

    // Set up event handlers
    this.watcher.on('add', (path) => this.handleFileEvent('add', path));
    this.watcher.on('change', (path) => this.handleFileEvent('change', path));
    this.watcher.on('unlink', (path) => this.handleFileEvent('unlink', path));
    this.watcher.on('error', (error) => {
      logger.error('File watcher error (non-fatal):', error);
      if (this.listenerCount('error') > 0) {
        this.emit('error', error);
      }
    });

    this.isRunning = true;
    logger.info('File watcher started');
    this.emit('started');
  }

  /**
   * Stop watching
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.watcher) {
      return;
    }

    logger.info('Stopping file watcher...');

    // Clear all pending debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Close the watcher
    await this.watcher.close();
    this.watcher = null;
    this.isRunning = false;

    logger.info('File watcher stopped');
    this.emit('stopped');
  }

  /**
   * Check if watcher is running
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Get the project path being watched
   */
  get watchedPath(): string {
    return this.projectPath;
  }

  /**
   * Handle file events with debouncing
   */
  private handleFileEvent(type: FileEventType, filePath: string): void {
    // Skip if not a supported extension
    const isSupported = getSupportedExtensions().some(ext => filePath.endsWith(ext));
    if (!isSupported && type !== 'unlink') {
      return;
    }

    // Skip ignored patterns
    for (const pattern of this.ignorePatterns) {
      if (this.matchesPattern(filePath, pattern)) {
        return;
      }
    }

    // Debounce the event
    const existingTimer = this.debounceTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.processFileEvent(type, filePath);
    }, this.debounceMs);

    this.debounceTimers.set(filePath, timer);
  }

  /**
   * Process a file event after debouncing
   */
  private async processFileEvent(type: FileEventType, filePath: string): Promise<void> {
    logger.info(`${type.toUpperCase()}: ${filePath}`);

    const event: FileChangeEvent = {
      type,
      path: filePath,
      timestamp: Date.now(),
    };

    try {
      switch (type) {
        case 'add':
        case 'change':
          if (this.onFileChanged) {
            const result = await this.onFileChanged(filePath);
            if (result.success) {
              this.emit('file-changed', event);
              this.emit('graph-updated', { type, filePath });
            } else {
              logger.error(`Handler failed for ${filePath}:`, result.error);
              this.emit('parse-error', { filePath, error: result.error });
            }
          } else {
            // No handler — just emit the event
            this.emit('file-changed', event);
          }
          break;

        case 'unlink':
          if (this.onFileRemoved) {
            const result = await this.onFileRemoved(filePath);
            if (result.success) {
              this.emit('file-removed', event);
              this.emit('graph-updated', { type, filePath });
            } else {
              logger.error(`Remove handler failed for ${filePath}:`, result.error);
            }
          } else {
            this.emit('file-removed', event);
          }
          break;
      }
    } catch (error) {
      logger.error(`Error processing ${type} event:`, error);
      this.emit('error', error);
    }
  }

  /**
   * Simple pattern matching for ignore patterns
   */
  private matchesPattern(path: string, pattern: string): boolean {
    // Handle **/ prefix
    if (pattern.startsWith('**/')) {
      const rest = pattern.slice(3);
      return path.includes(rest.replace(/\*/g, ''));
    }
    return false;
  }
}

// ============================================================================
// Gitignore Support
// ============================================================================

/**
 * Load .gitignore from a project root and convert to glob ignore patterns.
 * Returns an empty array if no .gitignore exists.
 */
export async function loadGitignorePatterns(projectPath: string): Promise<string[]> {
  try {
    const raw = await readFile(join(projectPath, '.gitignore'), 'utf-8');
    return raw
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('#'))
      .map(pattern => {
        // Convert gitignore patterns to glob patterns for fast-glob
        // "dir/" → "**/dir/**", "dir" → "**/dir/**", "*.log" → "**/*.log"
        if (pattern.startsWith('/')) {
          // Anchored to repo root — strip leading slash
          const p = pattern.slice(1);
          return p.endsWith('/') ? `${p}**` : p;
        }
        if (pattern.endsWith('/')) {
          return `**/${pattern}**`;
        }
        // Already a glob or filename — prefix with **/ if not already
        if (pattern.startsWith('**/')) return pattern;
        if (pattern.includes('/')) return pattern;
        return `**/${pattern}`;
      });
  } catch {
    return [];
  }
}

// ============================================================================
// Module-level singleton for easy import
// ============================================================================

let activeWatchService: WatchService | null = null;

/**
 * Start watching a project
 */
export const startWatching = traced('startWatching', async function startWatching(config: WatchServiceConfig): Promise<WatchService> {
  // Stop any existing watcher
  if (activeWatchService) {
    await activeWatchService.stop();
  }

  activeWatchService = new WatchService(config);
  await activeWatchService.start();
  return activeWatchService;
});

/**
 * Stop the active watcher
 */
export const stopWatching = traced('stopWatching', async function stopWatching(): Promise<void> {
  if (activeWatchService) {
    await activeWatchService.stop();
    activeWatchService = null;
  }
});

/**
 * Get the active watch service (if any)
 */
export function getActiveWatcher(): WatchService | null {
  return activeWatchService;
}
