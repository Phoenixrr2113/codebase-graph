/**
 * MCP Tool: configure_projects
 *
 * View and manage which codebases are active in context.
 * The user can also edit ~/.codegraph/mcp-context.json directly —
 * the MCP server watches for config changes and auto-syncs
 * (indexing new projects, deleting removed ones).
 */

import { createOperations } from '@codegraph/graph';
import {
  getGraphClient, loadConfig, setActiveProjects,
  needsSetup, syncConfigToGraph, type ProjectInfo,
} from '@codegraph/core';
import { createLogger } from '@codegraph/logger';
import type { ToolDefinition } from './consolidated';

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

Projects are auto-indexed when added and auto-deleted when removed.
The user can also edit ~/.codegraph/mcp-context.json directly.

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
    const client = await getGraphClient();
    const ops = createOperations(client);
    const projects = await ops.getProjects();

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
      if (!input.projects || input.projects.length === 0) {
        return {
          setupComplete: !isSetupNeeded,
          availableProjects: available,
          activeProjects: currentActive,
          message: 'Please specify projects to set as active.',
        };
      }
      const resolved = resolveProjectPaths(input.projects, available);
      await setActiveProjects(resolved);

      // Sync: indexes new projects, deletes removed ones
      const syncResult = await syncConfigToGraph();
      available = await getAvailableProjects();

      const parts: string[] = [`Active projects set to: ${resolved.map(p => p.split('/').pop()).join(', ')}`];
      if (syncResult.indexed.length > 0) parts.push(`Indexed: ${syncResult.indexed.map(p => p.split('/').pop()).join(', ')}`);
      if (syncResult.deleted.length > 0) parts.push(`Deleted: ${syncResult.deleted.map(p => p.split('/').pop()).join(', ')}`);
      if (syncResult.errors.length > 0) parts.push(`Errors: ${syncResult.errors.length}`);

      return {
        setupComplete: true,
        availableProjects: available,
        activeProjects: resolved,
        message: parts.join('. '),
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

      const syncResult = await syncConfigToGraph();
      available = await getAvailableProjects();

      const parts: string[] = [`Added: ${resolved.map(p => p.split('/').pop()).join(', ')}`];
      if (syncResult.indexed.length > 0) parts.push(`Indexed: ${syncResult.indexed.map(p => p.split('/').pop()).join(', ')}`);

      return {
        setupComplete: true,
        availableProjects: available,
        activeProjects: newActive,
        message: parts.join('. '),
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

      const syncResult = await syncConfigToGraph();
      available = await getAvailableProjects();

      const parts: string[] = [`Removed: ${input.projects.join(', ')}`];
      if (syncResult.deleted.length > 0) parts.push(`Deleted from graph: ${syncResult.deleted.map(p => p.split('/').pop()).join(', ')}`);
      parts.push(`Active: ${remaining.map(p => p.split('/').pop()).join(', ') || '(none)'}`);

      return {
        setupComplete: true,
        availableProjects: available,
        activeProjects: remaining,
        message: parts.join('. '),
      };
    }

    case 'status':
    default:
      if (isSetupNeeded) {
        return {
          setupComplete: false,
          availableProjects: available,
          activeProjects: [],
          setupRequired: true,
          message: `Setup Required\n\nFound ${available.length} indexed project(s):\n${available.map((p, i) => `  [${i + 1}] ${p.name} (${p.fileCount} files)`).join('\n')}\n\nAdd project paths to ~/.codegraph/mcp-context.json or use configure_projects with action: "set" and projects: ["/path/to/project"]`,
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
