/**
 * Watch Service - File system watcher for incremental updates
 *
 * Uses chokidar 5.x (which doesn't support glob patterns) with fast-glob
 * for file discovery. Implements debouncing to prevent thrashing on rapid saves.
 */

import { watch, type FSWatcher } from 'chokidar';
import fastGlob from 'fast-glob';
import { EventEmitter } from 'node:events';
import { parseSingleFile, removeFileFromGraph } from './parseService.js';

/** Supported file extensions for watching */
const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];

/** Default patterns to ignore */
const DEFAULT_IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/coverage/**',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/__tests__/**',
  '**/__mocks__/**',
  '**/.next/**',
  '**/.turbo/**',
];

/** File change event types */
export type FileEventType = 'add' | 'change' | 'unlink';

/** File change event data */
export interface FileChangeEvent {
  type: FileEventType;
  path: string;
  timestamp: number;
}

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

  constructor(config: WatchServiceConfig) {
    super();
    this.projectPath = config.projectPath;
    this.ignorePatterns = [...DEFAULT_IGNORE_PATTERNS, ...(config.ignorePatterns ?? [])];
    this.debounceMs = config.debounceMs ?? 500;
    this.processInitial = config.processInitial ?? false;
  }

  /**
   * Start watching the project directory
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[WatchService] Already running');
      return;
    }

    console.log(`[WatchService] Starting file watcher for: ${this.projectPath}`);

    // Discover initial files using fast-glob
    const patterns = SUPPORTED_EXTENSIONS.map(ext => `**/*${ext}`);
    const files = await fastGlob(patterns, {
      cwd: this.projectPath,
      absolute: true,
      ignore: this.ignorePatterns,
      onlyFiles: true,
    });

    console.log(`[WatchService] Found ${files.length} source files`);

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

    // Also watch the project directory for new files
    this.watcher.add(this.projectPath);

    // Set up event handlers
    this.watcher.on('add', (path) => this.handleFileEvent('add', path));
    this.watcher.on('change', (path) => this.handleFileEvent('change', path));
    this.watcher.on('unlink', (path) => this.handleFileEvent('unlink', path));
    this.watcher.on('error', (error) => {
      console.error('[WatchService] Error:', error);
      this.emit('error', error);
    });

    this.isRunning = true;
    console.log('[WatchService] File watcher started');
    this.emit('started');
  }

  /**
   * Stop watching
   */
  async stop(): Promise<void> {
    if (!this.isRunning || !this.watcher) {
      return;
    }

    console.log('[WatchService] Stopping file watcher...');

    // Clear all pending debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Close the watcher
    await this.watcher.close();
    this.watcher = null;
    this.isRunning = false;

    console.log('[WatchService] File watcher stopped');
    this.emit('stopped');
  }

  /**
   * Check if watcher is running
   */
  get running(): boolean {
    return this.isRunning;
  }

  /**
   * Handle file events with debouncing
   */
  private handleFileEvent(type: FileEventType, filePath: string): void {
    // Skip if not a supported extension
    const isSupported = SUPPORTED_EXTENSIONS.some(ext => filePath.endsWith(ext));
    if (!isSupported && type !== 'unlink') {
      return;
    }

    // Skip ignored patterns
    for (const pattern of this.ignorePatterns) {
      // Simple pattern matching (could use micromatch for full glob support)
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
    console.log(`[WatchService] ${type.toUpperCase()}: ${filePath}`);

    const event: FileChangeEvent = {
      type,
      path: filePath,
      timestamp: Date.now(),
    };

    try {
      switch (type) {
        case 'add':
        case 'change':
          // Re-parse the file
          const result = await parseSingleFile(filePath);
          if (result.success) {
            this.emit('file-changed', event);
            this.emit('graph-updated', { type, filePath });
          } else {
            console.error(`[WatchService] Parse failed for ${filePath}:`, result.error);
            this.emit('parse-error', { filePath, error: result.error });
          }
          break;

        case 'unlink':
          // Remove file from graph
          const removeResult = await removeFileFromGraph(filePath);
          if (removeResult.success) {
            this.emit('file-removed', event);
            this.emit('graph-updated', { type, filePath });
          } else {
            console.error(`[WatchService] Remove failed for ${filePath}:`, removeResult.error);
          }
          break;
      }
    } catch (error) {
      console.error(`[WatchService] Error processing ${type} event:`, error);
      this.emit('error', error);
    }
  }

  /**
   * Simple pattern matching for ignore patterns
   * (For full glob support, use micromatch)
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
// Module-level singleton for easy import
// ============================================================================

let activeWatchService: WatchService | null = null;

/**
 * Start watching a project
 */
export async function startWatching(config: WatchServiceConfig): Promise<WatchService> {
  // Stop any existing watcher
  if (activeWatchService) {
    await activeWatchService.stop();
  }

  activeWatchService = new WatchService(config);
  await activeWatchService.start();
  return activeWatchService;
}

/**
 * Stop the active watcher
 */
export async function stopWatching(): Promise<void> {
  if (activeWatchService) {
    await activeWatchService.stop();
    activeWatchService = null;
  }
}

/**
 * Get the active watch service (if any)
 */
export function getActiveWatcher(): WatchService | null {
  return activeWatchService;
}
