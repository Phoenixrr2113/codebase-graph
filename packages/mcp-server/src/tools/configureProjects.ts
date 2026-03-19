/**
 * MCP Tool: configure_projects
 *
 * View and manage which codebases are active in context.
 * Config is persisted to ~/.codegraph/mcp-context.json.
 * Adding projects auto-triggers background indexing and starts file watchers.
 */

import { execSync } from 'node:child_process';
import {
  codeGraphService, loadConfig, setActiveProjects,
  needsSetup, type ProjectInfo,
  indexProject, startWatching, stopWatchingProject, indexSingleFile,
} from '@codegraph/core';
import { createLogger } from '@codegraph/logger';
import type { ToolDefinition } from './router';

const logger = createLogger({ namespace: 'MCP:ConfigureProjects' });

// ============================================================================
// Schema
// ============================================================================

export interface ConfigureProjectsInput {
  action?: 'list' | 'set' | 'add' | 'remove' | 'status';
  projects?: string[];
}

export interface ConfigureProjectsOutput {
  /** Current setup status */
  setupComplete: boolean;
  /** Available projects in the graph */
  availableProjects: ProjectInfo[];
  /** Currently active projects */
  activeProjects: string[];
  /** Message for the user */
  message: string;
  /** Whether setup is required before other tools work */
  setupRequired?: boolean;
}

// ============================================================================
// Tool Definition
// ============================================================================

export const configureProjectsToolDefinition: ToolDefinition = {
  name: 'configure_projects',
  description: `View and manage which codebases are in context.

Adding projects triggers background indexing and starts file watchers automatically.
Config is persisted to ~/.codegraph/mcp-context.json.

Actions:
- \`status\` (default): Show current config and available projects
- \`list\`: List all indexed projects
- \`set\`: Replace active projects with specified list
- \`add\`: Add projects to active list
- \`remove\`: Remove projects (also deletes their graph data)

Examples:
- { "action": "status" } - show current setup
- { "action": "set", "projects": ["/path/to/project"] } - set active projects
- { "action": "add", "projects": ["/path/to/project"] } - add to active
- { "action": "remove", "projects": ["/path/to/project"] } - remove and delete`,
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'set', 'add', 'remove', 'status'],
        default: 'status',
        description: 'Action to perform',
      },
      projects: {
        type: 'array',
        items: { type: 'string' },
        description: 'Project names or paths for set/add/remove actions',
      },
    },
  },
};

// ============================================================================
// Helpers
// ============================================================================

async function getAvailableProjects(): Promise<ProjectInfo[]> {
  try {
    const projects = await codeGraphService.getProjects();

    return projects.map(p => ({
      name: p.name,
      rootPath: p.rootPath,
      fileCount: p.fileCount ?? 0,
      lastIndexed: p.lastParsed,
    }));
  } catch (error) {
    logger.error('Failed to get projects', { error });
    return [];
  }
}

/**
 * Resolve project names or partial paths to full rootPaths
 */
function resolveProjectPaths(inputs: string[], available: ProjectInfo[]): string[] {
  return inputs.map(input => {
    if (input.startsWith('/')) {
      return input;
    }
    const match = available.find(p =>
      p.name === input ||
      p.name.toLowerCase() === input.toLowerCase() ||
      p.rootPath.endsWith(`/${input}`)
    );
    return match ? match.rootPath : input;
  });
}

// ============================================================================
// Auto-detection of project roots
// ============================================================================

/**
 * Try to auto-detect project root(s). Checks in order:
 * 1. CODEGRAPH_PROJECT_ROOTS env var (comma-separated paths)
 * 2. Git repository root (from cwd)
 * 3. Current working directory
 */
function autoDetectProjectRoots(): string[] {
  // 1. Env var
  const envRoots = process.env.CODEGRAPH_PROJECT_ROOTS;
  if (envRoots) {
    const paths = envRoots.split(',').map(p => p.trim()).filter(Boolean);
    if (paths.length > 0) {
      logger.info(`Auto-detected project roots from CODEGRAPH_PROJECT_ROOTS: ${paths.join(', ')}`);
      return paths;
    }
  }

  // 2. Git root
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (gitRoot) {
      logger.info(`Auto-detected git root: ${gitRoot}`);
      return [gitRoot];
    }
  } catch {
    // Not in a git repo — fall through
  }

  // 3. CWD
  const cwd = process.cwd();
  logger.info(`Using current working directory as project root: ${cwd}`);
  return [cwd];
}

// ============================================================================
// Background indexing + watcher startup
// ============================================================================

/**
 * Index newly added projects in background and start file watchers.
 * Non-blocking — fires and forgets so the tool response returns immediately.
 */
function indexAndWatchInBackground(projectPaths: string[]): void {
  for (const projectPath of projectPaths) {
    // Index
    indexProject(projectPath, { deferEmbeddings: true })
      .then(result => {
        logger.info(`Background index complete: ${result.projectName} (${result.stats.files} files, ${result.stats.entities} entities)`);

        // Start watcher after indexing succeeds
        return startWatching({
          projectPath,
          debounceMs: 1000,
          onFileChanged: async (filePath: string) => {
            try {
              const r = await indexSingleFile(filePath, projectPath);
              if (r.success) {
                logger.info(`Auto-indexed: ${filePath} (${r.entities} entities)`);
              } else {
                logger.warn(`Auto-index failed: ${filePath}`, r.error);
              }
              return r;
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
      })
      .then(() => {
        logger.info(`File watcher started for: ${projectPath}`);
      })
      .catch(err => {
        logger.warn(`Background index/watch failed for ${projectPath}:`, err);
      });
  }
}

// ============================================================================
// Handler
// ============================================================================

export async function configureProjects(
  input: ConfigureProjectsInput
): Promise<ConfigureProjectsOutput> {
  logger.debug('ConfigureProjects called', { action: input.action });

  const config = await loadConfig();
  const isSetupNeeded = await needsSetup();
  const currentActive = config?.activeProjects ?? [];
  let available = await getAvailableProjects();

  switch (input.action) {
    case 'list':
      return {
        setupComplete: !isSetupNeeded,
        availableProjects: available,
        activeProjects: currentActive,
        message: `Found ${available.length} indexed project(s).`,
      };

    case 'set': {
      // Auto-detect project roots when no projects specified
      const projectsToSet = (input.projects && input.projects.length > 0)
        ? input.projects
        : autoDetectProjectRoots();

      if (projectsToSet.length === 0) {
        return {
          setupComplete: !isSetupNeeded,
          availableProjects: available,
          activeProjects: currentActive,
          message: 'No projects specified and auto-detection found nothing. Please specify project paths.',
        };
      }
      const resolved = resolveProjectPaths(projectsToSet, available);
      await setActiveProjects(resolved);
      available = await getAvailableProjects();

      // Determine newly added projects (not previously active)
      const prevSet = new Set(currentActive);
      const newProjects = resolved.filter(p => !prevSet.has(p));
      if (newProjects.length > 0) {
        indexAndWatchInBackground(newProjects);
      }

      // Stop watchers for removed projects
      const newSet = new Set(resolved);
      for (const prev of currentActive) {
        if (!newSet.has(prev)) {
          stopWatchingProject(prev).catch(err =>
            logger.warn(`Failed to stop watcher for ${prev}:`, err)
          );
        }
      }

      return {
        setupComplete: true,
        availableProjects: available,
        activeProjects: resolved,
        message: `Active projects set to: ${resolved.map(p => p.split('/').pop()).join(', ')}` +
          (newProjects.length > 0 ? `. Indexing ${newProjects.length} new project(s) in background...` : ''),
      };
    }

    case 'add': {
      if (!input.projects || input.projects.length === 0) {
        return {
          setupComplete: !isSetupNeeded,
          availableProjects: available,
          activeProjects: currentActive,
          message: 'Please specify projects to add.',
        };
      }
      const resolved = resolveProjectPaths(input.projects, available);
      const newActive = [...new Set([...currentActive, ...resolved])];
      await setActiveProjects(newActive);
      available = await getAvailableProjects();

      // Index + watch only the truly new projects
      const prevSet = new Set(currentActive);
      const newProjects = resolved.filter(p => !prevSet.has(p));
      if (newProjects.length > 0) {
        indexAndWatchInBackground(newProjects);
      }

      return {
        setupComplete: true,
        availableProjects: available,
        activeProjects: newActive,
        message: `Added: ${resolved.map(p => p.split('/').pop()).join(', ')}` +
          (newProjects.length > 0 ? `. Indexing in background...` : ''),
      };
    }

    case 'remove': {
      if (!input.projects || input.projects.length === 0) {
        return {
          setupComplete: !isSetupNeeded,
          availableProjects: available,
          activeProjects: currentActive,
          message: 'Please specify projects to remove.',
        };
      }
      const resolved = resolveProjectPaths(input.projects, available);
      const resolvedSet = new Set(resolved);
      const remaining = currentActive.filter(p => !resolvedSet.has(p));
      await setActiveProjects(remaining);
      available = await getAvailableProjects();

      // Stop watchers for removed projects
      for (const removedPath of resolved) {
        stopWatchingProject(removedPath).catch(err =>
          logger.warn(`Failed to stop watcher for ${removedPath}:`, err)
        );
      }

      return {
        setupComplete: true,
        availableProjects: available,
        activeProjects: remaining,
        message: `Removed: ${input.projects.join(', ')}. Active: ${remaining.map(p => p.split('/').pop()).join(', ') || '(none)'}`,
      };
    }

    case 'status':
    default:
      if (isSetupNeeded) {
        const detected = autoDetectProjectRoots();
        const detectedHint = detected.length > 0
          ? `\n\nAuto-detected project root(s): ${detected.join(', ')}\nQuick setup: use action "set" with no projects to auto-configure, or specify projects explicitly.`
          : '';
        return {
          setupComplete: false,
          availableProjects: available,
          activeProjects: [],
          setupRequired: true,
          message: `Setup Required\n\nFound ${available.length} indexed project(s):\n${available.map((p, i) => `  [${i + 1}] ${p.name} (${p.fileCount} files)`).join('\n')}${detectedHint}`,
        };
      }
      return {
        setupComplete: true,
        availableProjects: available,
        activeProjects: currentActive,
        message: `Active projects: ${currentActive.map(p => p.split('/').pop()).join(', ') || '(all)'}`,
      };
  }
}

/**
 * Check if setup is needed and return setup prompt if so
 */
export async function checkSetupRequired(): Promise<ConfigureProjectsOutput | null> {
  if (await needsSetup()) {
    return configureProjects({ action: 'status' });
  }
  return null;
}
