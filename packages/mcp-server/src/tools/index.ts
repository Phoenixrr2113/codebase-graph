/**
 * MCP Tool Registry
 * Defines and registers available tools for the CodeGraph MCP server
 */

// zod will be used in subsequent tasks for input validation

import { indexStatusToolDefinition, getIndexStatus } from './indexStatus.js';

// ============================================================================
// Tool Definitions
// ============================================================================

/**
 * Tool definition type matching MCP SDK
 */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/**
 * Available tools for the CodeGraph MCP server
 * Tools are added in subsequent tasks
 */
export const tools: ToolDefinition[] = [
  {
    name: 'ping',
    description: 'Test connectivity to the CodeGraph MCP server',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  indexStatusToolDefinition,
];

// ============================================================================
// Tool Handlers
// ============================================================================

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

const handlers: Record<string, ToolHandler> = {
  ping: async () => {
    return {
      status: 'ok',
      message: 'CodeGraph MCP Server is running',
      timestamp: new Date().toISOString(),
    };
  },
  get_index_status: async (args) => {
    const input = args.repo ? { repo: args.repo as string } : {};
    return getIndexStatus(input);
  },
};

/**
 * Handle a tool call by delegating to the appropriate handler
 */
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const handler = handlers[name];

  if (!handler) {
    throw new Error(`Unknown tool: ${name}`);
  }

  return handler(args);
}

/**
 * Register a new tool
 */
export function registerTool(
  definition: ToolDefinition,
  handler: ToolHandler
): void {
  tools.push(definition);
  handlers[definition.name] = handler;
}
