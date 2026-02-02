/**
 * MCP Tool: configure_projects
 * 
 * List available projects and configure which are active in context.
 */

import { z } from 'zod';
import { createOperations, createClient } from '@codegraph/graph';
import { createLogger } from '@codegraph/logger';
import {
  loadConfig,
  setActiveProjects,
  needsSetup,
  type ProjectInfo,
} from '../config';

const logger = createLogger({ namespace: 'MCP:ConfigureProjects' });

// ============================================================================
// Schema
// ============================================================================

export const ConfigureProjectsInputSchema = z.object({
  action: z
    .enum(['list', 'set', 'add', 'remove', 'status'])
    .default('status')
    .describe('Action to perform'),
  projects: z
    .array(z.string())
    .optional()
    .describe('Project names or paths for set/add/remove actions'),
});

export type ConfigureProjectsInput = z.infer<typeof ConfigureProjectsInputSchema>;

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

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const configureProjectsToolDefinition: ToolDefinition = {
  name: 'configure_projects',
  description: `Manage which codebases are active in your context.

Actions:
- \`status\` (default): Show current config and available projects
- \`list\`: List all indexed projects  
- \`set\`: Replace active projects with specified list
- \`add\`: Add projects to active list
- \`remove\`: Remove projects from active list

Examples:
- { "action": "status" } - show current setup
- { "action": "set", "projects": ["codebase-graph"] } - set active projects
- { "action": "add", "projects": ["my-project"] } - add to active`,
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
// Handler
// ============================================================================

async function getAvailableProjects(): Promise<ProjectInfo[]> {
  try {
    const client = await createClient();
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
    // If it looks like a full path, use as-is
    if (input.startsWith('/')) {
      return input;
    }
    // Otherwise find matching project by name
    const match = available.find(p =>
      p.name === input ||
      p.name.toLowerCase() === input.toLowerCase() ||
      p.rootPath.endsWith(`/${input}`)
    );
    return match ? match.rootPath : input;
  });
}

export async function configureProjects(
  input: ConfigureProjectsInput
): Promise<ConfigureProjectsOutput> {
  logger.debug('ConfigureProjects called', { action: input.action });

  const available = await getAvailableProjects();
  const config = await loadConfig();
  const isSetupNeeded = await needsSetup();

  const currentActive = config?.activeProjects ?? [];

  switch (input.action) {
    case 'list':
      return {
        setupComplete: !isSetupNeeded,
        availableProjects: available,
        activeProjects: currentActive,
        message: `Found ${available.length} indexed project(s).`,
      };

    case 'set':
      if (!input.projects || input.projects.length === 0) {
        return {
          setupComplete: !isSetupNeeded,
          availableProjects: available,
          activeProjects: currentActive,
          message: 'Please specify projects to set as active.',
        };
      }
      const resolvedSet = resolveProjectPaths(input.projects, available);
      await setActiveProjects(resolvedSet);
      return {
        setupComplete: true,
        availableProjects: available,
        activeProjects: resolvedSet,
        message: `Active projects set to: ${resolvedSet.map(p => p.split('/').pop()).join(', ')}`,
      };

    case 'add':
      if (!input.projects || input.projects.length === 0) {
        return {
          setupComplete: !isSetupNeeded,
          availableProjects: available,
          activeProjects: currentActive,
          message: 'Please specify projects to add.',
        };
      }
      const resolvedAdd = resolveProjectPaths(input.projects, available);
      const newActive = [...new Set([...currentActive, ...resolvedAdd])];
      await setActiveProjects(newActive);
      return {
        setupComplete: true,
        availableProjects: available,
        activeProjects: newActive,
        message: `Added: ${resolvedAdd.map(p => p.split('/').pop()).join(', ')}. Active: ${newActive.map(p => p.split('/').pop()).join(', ')}`,
      };

    case 'remove':
      if (!input.projects || input.projects.length === 0) {
        return {
          setupComplete: !isSetupNeeded,
          availableProjects: available,
          activeProjects: currentActive,
          message: 'Please specify projects to remove.',
        };
      }
      const remaining = currentActive.filter(p => !input.projects!.includes(p));
      await setActiveProjects(remaining);
      return {
        setupComplete: true,
        availableProjects: available,
        activeProjects: remaining,
        message: `Removed: ${input.projects.join(', ')}. Active: ${remaining.join(', ') || '(none)'}`,
      };

    case 'status':
    default:
      if (isSetupNeeded) {
        return {
          setupComplete: false,
          availableProjects: available,
          activeProjects: [],
          setupRequired: true,
          message: `🔧 Setup Required\n\nFound ${available.length} indexed project(s):\n${available.map((p, i) => `  [${i + 1}] ${p.name} (${p.fileCount} files)`).join('\n')}\n\nUse configure_projects with action: "set" and projects: ["project-name"] to select which to include in your context.`,
        };
      }
      return {
        setupComplete: true,
        availableProjects: available,
        activeProjects: currentActive,
        message: `Active projects: ${currentActive.join(', ') || '(all)'}`,
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
