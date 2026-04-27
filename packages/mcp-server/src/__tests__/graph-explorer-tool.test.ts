import { describe, it, expect, vi } from 'vitest';
import {
  graphExplorerToolDefinition,
  fetchGraphDataToolDefinition,
  fetchGraphData,
  type GraphClient,
} from '../tools/graphExplorer';

describe('graph_explorer MCP App UI tool', () => {
  it('registers with name graph_explorer and a _meta.ui field', () => {
    expect(graphExplorerToolDefinition.name).toBe('graph_explorer');
    expect((graphExplorerToolDefinition as any)._meta?.ui).toBeDefined();
  });

  it('references the correct resource URI', () => {
    expect((graphExplorerToolDefinition as any)._meta?.ui?.resourceUri).toBe(
      'ui://codegraph/graph-explorer.html',
    );
  });

  it('companion tool has app-only visibility', () => {
    expect(fetchGraphDataToolDefinition.name).toBe('fetch_graph_data');
    const visibility = (fetchGraphDataToolDefinition as any)._meta?.ui?.visibility as string[] | undefined;
    expect(visibility).toContain('app');
  });
});

describe('fetchGraphData', () => {
  it('returns nodes + edges scoped to a project', async () => {
    const mockClient: GraphClient = {
      roQuery: vi.fn().mockImplementation(async (cypher: string) => {
        if (cypher.includes('RETURN toString(id(n))')) {
          return {
            data: [
              { id: '1', name: 'parseProject', nodeType: 'Function', filePath: '/test/x.ts' },
              { id: '2', name: 'getGraphClient', nodeType: 'Function', filePath: '/test/y.ts' },
            ],
          };
        }
        return {
          data: [
            { source: '1', target: '2', type: 'CALLS' },
          ],
        };
      }),
    };

    const result = await fetchGraphData(mockClient, { projectPath: '/test', limit: 10 });
    expect(result.nodes.length).toBe(2);
    expect(result.edges.length).toBe(1);
    expect(result.nodes[0]?.name).toBe('parseProject');
    expect(result.edges[0]?.type).toBe('CALLS');
  });

  it('returns empty arrays when client returns no data', async () => {
    const mockClient: GraphClient = {
      roQuery: vi.fn().mockResolvedValue({ data: [] }),
    };
    const result = await fetchGraphData(mockClient, {});
    expect(result.nodes).toEqual([]);
    expect(result.edges).toEqual([]);
  });
});
