/**
 * MCP Server for CodeGraph
 * Implements Model Context Protocol for AI assistant integration
 */

import { Server } from '@modelcontextprotocol/sdk/server';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { createLogger } from '@codegraph/logger';
import { tools, handleToolCall } from './tools';

const logger = createLogger({ namespace: 'MCP:Server' });

// ============================================================================
// MCP Server Class
// ============================================================================

/**
 * CodeGraph MCP Server
 * Exposes code graph tools via the Model Context Protocol
 */
export class CodeGraphMCPServer {
  private server: Server;
  private isRunning = false;

  constructor() {
    this.server = new Server(
      {
        name: 'codegraph-mcp-server',
        version: '0.1.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  /**
   * Set up MCP protocol handlers
   */
  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      logger.debug('Listing available tools');
      return {
        tools: tools as Tool[],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      logger.info('Tool call received', { tool: name });

      try {
        const result = await handleToolCall(name, args || {});
        return {
          content: [
            {
              type: 'text' as const,
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Tool call failed', { tool: name, error: errorMessage });
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error: ${errorMessage}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * Start the MCP server with stdio transport
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Server is already running');
      return;
    }

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    this.isRunning = true;

    logger.info('CodeGraph MCP Server started', {
      name: 'codegraph-mcp-server',
      version: '0.1.0',
      transport: 'stdio',
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    await this.server.close();
    this.isRunning = false;
    logger.info('MCP Server stopped');
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create and configure an MCP server instance
 */
export function createMCPServer(): CodeGraphMCPServer {
  return new CodeGraphMCPServer();
}
