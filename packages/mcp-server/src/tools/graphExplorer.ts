/**
 * MCP App UI tool — Graph Explorer
 *
 * Registers a graph_explorer tool with _meta.ui so Claude Desktop and other
 * App-UI-capable clients render the bundled HTML inline as an in-conversation
 * panel. Clients without App UI support see this as a no-op (no error, no UI).
 *
 * Pattern: supermemory apps/mcp/src/server.ts:299-434.
 * SDK: @modelcontextprotocol/ext-apps registerAppTool / registerAppResource.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolDefinition } from './router';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_HTML_PATH = join(__dirname, '..', 'ui', 'graph-explorer-app.html');

function loadHtml(): string {
  try {
    return readFileSync(APP_HTML_PATH, 'utf-8');
  } catch {
    return '<html><body>Graph Explorer (HTML missing)</body></html>';
  }
}

// ============================================================================
// Tool Definition
// ============================================================================

/**
 * Tool definition for the graph_explorer App UI tool.
 * The _meta.ui field signals to App-UI-capable clients to render the HTML.
 */
export const graphExplorerToolDefinition: ToolDefinition & {
  _meta?: { ui?: { resourceUri?: string; html?: string } };
} = {
  name: 'graph_explorer',
  description:
    'Open an interactive Graph Explorer inside the MCP client. ' +
    'Requires App UI support (Claude Desktop or another App-UI-capable client). ' +
    'In non-App-UI clients this tool is a no-op.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Project root to scope the graph to (optional).',
      },
    },
  },
  _meta: {
    ui: {
      resourceUri: 'ui://codegraph/graph-explorer.html',
    },
  },
};

/**
 * Companion data-fetch tool. The bundled HTML calls back into this via the
 * MCP client to populate its canvas. Hidden from the model (visibility: app)
 * so it does not appear as a callable tool in the LLM context.
 */
export const fetchGraphDataToolDefinition: ToolDefinition & {
  _meta?: { ui?: { resourceUri?: string; visibility?: string[] } };
} = {
  name: 'fetch_graph_data',
  description:
    'Internal companion — fetches project-scoped graph nodes and edges for the graph_explorer App UI canvas.',
  inputSchema: {
    type: 'object',
    properties: {
      projectPath: {
        type: 'string',
        description: 'Project root to scope results to.',
      },
      limit: {
        type: 'number',
        description: 'Maximum nodes to return (default: 200).',
      },
    },
  },
  _meta: {
    ui: {
      resourceUri: 'ui://codegraph/graph-explorer.html',
      visibility: ['app'],
    },
  },
};

// ============================================================================
// Graph Data
// ============================================================================

export interface GraphData {
  nodes: Array<{ id: string; name: string; nodeType: string; filePath?: string }>;
  edges: Array<{ source: string; target: string; type: string }>;
}

export interface GraphClient {
  roQuery<T = Record<string, unknown>>(cypher: string, opts?: { params?: Record<string, unknown> }): Promise<{ data: T[] }>;
}

/**
 * Fetch project-scoped graph data from FalkorDB.
 * Called by the graph_explorer UI panel via the fetch_graph_data companion tool.
 */
export async function fetchGraphData(
  client: GraphClient,
  args: { projectPath?: string; limit?: number },
): Promise<GraphData> {
  const limit = args.limit ?? 200;
  const projectFilter = args.projectPath
    ? 'AND n.filePath STARTS WITH $projectPath'
    : '';
  const edgeFilter = args.projectPath
    ? 'AND a.filePath STARTS WITH $projectPath'
    : '';

  const nodesQuery = `
    MATCH (n)
    WHERE (n:Function OR n:Class OR n:Interface OR n:Variable OR n:File)
      ${projectFilter}
    RETURN toString(id(n)) AS id, n.name AS name, labels(n)[0] AS nodeType, n.filePath AS filePath
    LIMIT $limit
  `;
  const edgesQuery = `
    MATCH (a)-[r]->(b)
    WHERE type(r) IN ['CALLS', 'IMPORTS', 'EXTENDS', 'IMPLEMENTS', 'CONTAINS']
      ${edgeFilter}
    RETURN toString(id(a)) AS source, toString(id(b)) AS target, type(r) AS type
    LIMIT $limit
  `;

  const params = { projectPath: args.projectPath ?? null, limit };
  const [nodesRes, edgesRes] = await Promise.all([
    client.roQuery<{ id: string; name: string; nodeType: string; filePath?: string }>(nodesQuery, { params }),
    client.roQuery<{ source: string; target: string; type: string }>(edgesQuery, { params }),
  ]);

  return {
    nodes: nodesRes.data,
    edges: edgesRes.data,
  };
}

// ============================================================================
// HTML resource content (for registerAppResource)
// ============================================================================

export const GRAPH_EXPLORER_RESOURCE_URI = 'ui://codegraph/graph-explorer.html';
export const graphExplorerHtml = loadHtml();
