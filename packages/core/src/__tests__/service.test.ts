/**
 * CodeGraphService Unit Tests
 *
 * Tests the graph data service methods (project management, entity traversal,
 * pagination, neighbors). Mocks the graph client to isolate service behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock dialect matching FalkorDB behavior
// ---------------------------------------------------------------------------
const mockDialect = {
  driverType: 'falkordb' as const,
  labelsExpr: (alias: string) => `labels(${alias})`,
  firstLabelExpr: (alias: string) => `labels(${alias})[0]`,
  typeExpr: (alias: string) => `type(${alias})`,
  labelCheckExpr: (alias: string, label: string) => `${alias}:${label}`,
  labelCaseExpr: (alias: string, label: string) => `${alias}:${label}`,
  supportsOnCreateOnMatch: true,
  normalizeNode: (raw: unknown) => ({ labels: [], properties: raw as Record<string, unknown> }),
  normalizeEdge: (raw: unknown) => ({ type: '', properties: raw as Record<string, unknown> }),
};

const mockClient = {
  roQuery: vi.fn().mockResolvedValue({ data: [], metadata: null }),
  query: vi.fn().mockResolvedValue({ data: [], metadata: null }),
  close: vi.fn().mockResolvedValue(undefined),
  dialect: mockDialect,
};

// ---------------------------------------------------------------------------
// Module mocks (must be before dynamic import)
// ---------------------------------------------------------------------------
vi.mock('../graphClient', () => ({
  getGraphClient: vi.fn().mockResolvedValue(mockClient),
}));

vi.mock('../config', () => ({
  getActiveProjectPaths: vi.fn().mockResolvedValue([]),
}));

// Dynamic import so mocks take effect before module initialization
const { codeGraphService } = await import('../service');

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------
describe('CodeGraphService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Restore default empty response
    mockClient.roQuery.mockResolvedValue({ data: [], metadata: null });
  });

  // =========================================================================
  // deleteProject
  // =========================================================================
  describe('deleteProject', () => {
    it('delegates to operations.deleteProject via client.query', async () => {
      await codeGraphService.deleteProject('proj-123');

      expect(mockClient.query).toHaveBeenCalledTimes(1);
      const cypher: string = mockClient.query.mock.calls[0][0];
      expect(cypher).toContain('DELETE');
      expect(cypher).toContain('$id');
    });
  });

  // =========================================================================
  // clearGraph
  // =========================================================================
  describe('clearGraph', () => {
    it('delegates to operations.clearAll via client.query', async () => {
      await codeGraphService.clearGraph();

      expect(mockClient.query).toHaveBeenCalledTimes(1);
      const cypher: string = mockClient.query.mock.calls[0][0];
      expect(cypher).toContain('DELETE');
    });
  });

  // =========================================================================
  // resolveProjectRootPath
  // =========================================================================
  describe('resolveProjectRootPath', () => {
    it('returns rootPath when project exists', async () => {
      mockClient.roQuery.mockResolvedValueOnce({
        data: [
          { p: { id: 'proj-1', name: 'myApp', rootPath: '/home/user/myApp', fileCount: 10 } },
          { p: { id: 'proj-2', name: 'lib', rootPath: '/home/user/lib', fileCount: 5 } },
        ],
        metadata: null,
      });

      const result = await codeGraphService.resolveProjectRootPath('proj-1');

      expect(result).toBe('/home/user/myApp');
    });

    it('returns undefined when project not found', async () => {
      mockClient.roQuery.mockResolvedValueOnce({ data: [], metadata: null });

      const result = await codeGraphService.resolveProjectRootPath('nonexistent');

      expect(result).toBeUndefined();
    });
  });

  // =========================================================================
  // executeReadQuery
  // =========================================================================
  describe('executeReadQuery', () => {
    it('executes Cypher via roQuery and returns results', async () => {
      mockClient.roQuery.mockResolvedValueOnce({
        data: [{ count: 42 }],
        metadata: ['count'],
      });

      const result = await codeGraphService.executeReadQuery(
        'MATCH (n) RETURN count(n) as count',
        {}
      );

      expect(result.results).toEqual([{ count: 42 }]);
      expect(result.metadata).toEqual(['count']);
      expect(mockClient.roQuery).toHaveBeenCalledWith(
        'MATCH (n) RETURN count(n) as count',
        { params: {} }
      );
    });

    it('passes params correctly', async () => {
      mockClient.roQuery.mockResolvedValueOnce({ data: [], metadata: null });

      await codeGraphService.executeReadQuery(
        'MATCH (n:File) WHERE n.filePath = $filePath RETURN n',
        { filePath: '/src/index.ts' }
      );

      expect(mockClient.roQuery).toHaveBeenCalledWith(
        'MATCH (n:File) WHERE n.filePath = $filePath RETURN n',
        { params: { filePath: '/src/index.ts' } }
      );
    });

    it('returns empty results when data is null', async () => {
      mockClient.roQuery.mockResolvedValueOnce({ data: null, metadata: null });

      const result = await codeGraphService.executeReadQuery('MATCH (n) RETURN n');

      expect(result.results).toEqual([]);
      expect(result.metadata).toBeNull();
    });
  });

  // =========================================================================
  // getEntityWithConnections
  // =========================================================================
  describe('getEntityWithConnections', () => {
    it('returns null when entity not found', async () => {
      mockClient.roQuery.mockResolvedValueOnce({ data: [], metadata: null });

      const result = await codeGraphService.getEntityWithConnections('nonexistent');

      expect(result).toBeNull();
    });

    it('returns entity with incoming and outgoing edges', async () => {
      mockClient.roQuery.mockResolvedValueOnce({
        data: [
          {
            n: { name: 'processData', filePath: '/src/handler.ts', startLine: 10, endLine: 25 },
            labels: ['Function'],
            inEdge: { weight: 1 },
            inType: 'CALLS',
            inNode: { name: 'handleRequest', filePath: '/src/router.ts' },
            inLabels: ['Function'],
            outEdge: { weight: 1 },
            outType: 'CALLS',
            outNode: { name: 'saveResult', filePath: '/src/db.ts' },
            outLabels: ['Function'],
          },
        ],
        metadata: null,
      });

      const result = await codeGraphService.getEntityWithConnections('Function:/src/handler.ts:processData:10');

      expect(result).not.toBeNull();
      expect(result!.entity.id).toBe('Function:/src/handler.ts:processData:10');
      expect(result!.entity.label).toBe('Function');
      expect(result!.entity.displayName).toBe('processData');
      expect(result!.entity.filePath).toBe('/src/handler.ts');

      expect(result!.connections.incoming).toHaveLength(1);
      expect(result!.connections.incoming[0]!.label).toBe('CALLS');
      expect(result!.connections.incoming[0]!.source).toBe('handleRequest');

      expect(result!.connections.outgoing).toHaveLength(1);
      expect(result!.connections.outgoing[0]!.label).toBe('CALLS');
      expect(result!.connections.outgoing[0]!.target).toBe('saveResult');
    });

    it('deduplicates edges across multiple result rows', async () => {
      const sharedInNode = { name: 'caller', filePath: '/src/a.ts' };
      mockClient.roQuery.mockResolvedValueOnce({
        data: [
          {
            n: { name: 'target', filePath: '/src/b.ts', startLine: 1 },
            labels: ['Function'],
            inEdge: { weight: 1 },
            inType: 'CALLS',
            inNode: sharedInNode,
            inLabels: ['Function'],
            outEdge: null,
            outType: null,
            outNode: null,
            outLabels: null,
          },
          {
            n: { name: 'target', filePath: '/src/b.ts', startLine: 1 },
            labels: ['Function'],
            inEdge: { weight: 1 },
            inType: 'CALLS',
            inNode: sharedInNode,
            inLabels: ['Function'],
            outEdge: { weight: 1 },
            outType: 'IMPORTS',
            outNode: { name: 'dep', filePath: '/src/c.ts' },
            outLabels: ['Function'],
          },
        ],
        metadata: null,
      });

      const result = await codeGraphService.getEntityWithConnections('test-id');

      // Same incoming edge appears in both rows but should only be counted once
      expect(result!.connections.incoming).toHaveLength(1);
      expect(result!.connections.outgoing).toHaveLength(1);
    });

    it('constructs Cypher using dialect expressions', async () => {
      mockClient.roQuery.mockResolvedValueOnce({ data: [], metadata: null });

      await codeGraphService.getEntityWithConnections('some-id', 2);

      const cypher: string = mockClient.roQuery.mock.calls[0][0];
      // Should use dialect for labels and type expressions
      expect(cypher).toContain('labels(n)');
      expect(cypher).toContain('type(inEdge)');
      expect(cypher).toContain('type(outEdge)');
      // Should NOT contain elementId (removed)
      expect(cypher).not.toContain('elementId');
      // Should use property-based matching
      expect(cypher).toContain('n.filePath = $id');
    });
  });

  // =========================================================================
  // getNodesPaginated
  // =========================================================================
  describe('getNodesPaginated', () => {
    it('returns paginated nodes with defaults', async () => {
      // First call: count query, second call: data query
      mockClient.roQuery
        .mockResolvedValueOnce({ data: [{ total: 2 }], metadata: null })
        .mockResolvedValueOnce({
          data: [
            { n: { path: '/src/index.ts' }, labels: ['File'] },
            { n: { name: 'main', filePath: '/src/index.ts', startLine: 1 }, labels: ['Function'] },
          ],
          metadata: null,
        });

      const result = await codeGraphService.getNodesPaginated();

      expect(result.nodes).toHaveLength(2);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(50);
      expect(result.pagination.totalCount).toBe(2);
      expect(result.pagination.totalPages).toBe(1);
      expect(result.pagination.hasMore).toBe(false);
    });

    it('generates correct IDs for File vs non-File nodes', async () => {
      mockClient.roQuery
        .mockResolvedValueOnce({ data: [{ total: 2 }], metadata: null })
        .mockResolvedValueOnce({
          data: [
            { n: { filePath: '/src/app.ts' }, labels: ['File'] },
            { n: { name: 'render', filePath: '/src/app.ts', startLine: 5 }, labels: ['Function'] },
          ],
          metadata: null,
        });

      const result = await codeGraphService.getNodesPaginated();

      expect(result.nodes[0]!.id).toBe('File:/src/app.ts');
      expect(result.nodes[1]!.id).toBe('Function:/src/app.ts:render:5');
    });

    it('applies type filtering with dialect labelCheckExpr', async () => {
      mockClient.roQuery
        .mockResolvedValueOnce({ data: [{ total: 0 }], metadata: null })
        .mockResolvedValueOnce({ data: [], metadata: null });

      await codeGraphService.getNodesPaginated({ types: ['Function', 'Class'] as any });

      const countCypher: string = mockClient.roQuery.mock.calls[0][0];
      expect(countCypher).toContain('n:Function');
      expect(countCypher).toContain('n:Class');
    });

    it('applies search filter', async () => {
      mockClient.roQuery
        .mockResolvedValueOnce({ data: [{ total: 0 }], metadata: null })
        .mockResolvedValueOnce({ data: [], metadata: null });

      await codeGraphService.getNodesPaginated({ query: 'handler' });

      const countCypher: string = mockClient.roQuery.mock.calls[0][0];
      expect(countCypher).toContain('toLower');
      expect(countCypher).toContain('$query');
    });

    it('applies rootPath filter', async () => {
      mockClient.roQuery
        .mockResolvedValueOnce({ data: [{ total: 0 }], metadata: null })
        .mockResolvedValueOnce({ data: [], metadata: null });

      await codeGraphService.getNodesPaginated({ rootPath: '/src/api' });

      const countCypher: string = mockClient.roQuery.mock.calls[0][0];
      expect(countCypher).toContain('STARTS WITH $rootPath');
    });

    it('enforces MAX_LIMIT of 100', async () => {
      mockClient.roQuery
        .mockResolvedValueOnce({ data: [{ total: 0 }], metadata: null })
        .mockResolvedValueOnce({ data: [], metadata: null });

      const result = await codeGraphService.getNodesPaginated({ limit: 500 });

      expect(result.pagination.limit).toBe(100);
    });

    it('calculates pagination correctly', async () => {
      mockClient.roQuery
        .mockResolvedValueOnce({ data: [{ total: 150 }], metadata: null })
        .mockResolvedValueOnce({ data: [], metadata: null });

      const result = await codeGraphService.getNodesPaginated({ page: 2, limit: 50 });

      expect(result.pagination.totalCount).toBe(150);
      expect(result.pagination.totalPages).toBe(3);
      expect(result.pagination.hasMore).toBe(true);
    });
  });

  // =========================================================================
  // getNeighbors
  // =========================================================================
  describe('getNeighbors', () => {
    it('returns empty results for no matches', async () => {
      mockClient.roQuery.mockResolvedValueOnce({ data: [], metadata: null });

      const result = await codeGraphService.getNeighbors('File:/src/index.ts');

      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
      expect(result.centerId).toBe('File:/src/index.ts');
      expect(result.direction).toBe('both');
    });

    it('parses File: IDs correctly using path match', async () => {
      mockClient.roQuery.mockResolvedValueOnce({ data: [], metadata: null });

      await codeGraphService.getNeighbors('File:/src/index.ts');

      const cypher: string = mockClient.roQuery.mock.calls[0][0];
      expect(cypher).toContain('center.filePath = $actualPath');
      const params = mockClient.roQuery.mock.calls[0][1];
      expect(params.params.actualPath).toBe('/src/index.ts');
    });

    it('parses composite IDs (Label:filePath:name:line)', async () => {
      mockClient.roQuery.mockResolvedValueOnce({ data: [], metadata: null });

      await codeGraphService.getNeighbors('Function:/src/app.ts:render:15');

      const params = mockClient.roQuery.mock.calls[0][1];
      expect(params.params.filePath).toBe('/src/app.ts');
      expect(params.params.name).toBe('render');
      expect(params.params.line).toBe(15);
    });

    it('falls back to simple name/path match for simple IDs', async () => {
      mockClient.roQuery.mockResolvedValueOnce({ data: [], metadata: null });

      await codeGraphService.getNeighbors('myFunction');

      const cypher: string = mockClient.roQuery.mock.calls[0][0];
      expect(cypher).toContain('center.name = $simpleId');
      expect(cypher).toContain('center.filePath = $simpleId');
    });

    it('uses correct match pattern for direction=in', async () => {
      mockClient.roQuery.mockResolvedValueOnce({ data: [], metadata: null });

      await codeGraphService.getNeighbors('File:/src/a.ts', 'in');

      const cypher: string = mockClient.roQuery.mock.calls[0][0];
      expect(cypher).toContain('(neighbor)-[r]->(center)');
    });

    it('uses correct match pattern for direction=out', async () => {
      mockClient.roQuery.mockResolvedValueOnce({ data: [], metadata: null });

      await codeGraphService.getNeighbors('File:/src/a.ts', 'out');

      const cypher: string = mockClient.roQuery.mock.calls[0][0];
      expect(cypher).toContain('(center)-[r]->(neighbor)');
    });

    it('uses correct match pattern for direction=both', async () => {
      mockClient.roQuery.mockResolvedValueOnce({ data: [], metadata: null });

      await codeGraphService.getNeighbors('File:/src/a.ts', 'both');

      const cypher: string = mockClient.roQuery.mock.calls[0][0];
      expect(cypher).toContain('(center)-[r]-(neighbor)');
    });

    it('applies edge type filter via parameterized $edgeTypes', async () => {
      mockClient.roQuery.mockResolvedValueOnce({ data: [], metadata: null });

      await codeGraphService.getNeighbors('File:/src/a.ts', 'both', ['CALLS', 'IMPORTS'] as any);

      const cypher: string = mockClient.roQuery.mock.calls[0][0];
      expect(cypher).toContain("type(r)");
      expect(cypher).toContain("$edgeTypes");
      // Edge types should be in params, not interpolated into the query string
      const params = mockClient.roQuery.mock.calls[0][1]?.params;
      expect(params?.edgeTypes).toEqual(['CALLS', 'IMPORTS']);
    });

    it('returns mapped nodes and edges', async () => {
      mockClient.roQuery.mockResolvedValueOnce({
        data: [
          {
            neighbor: { name: 'helper', filePath: '/src/util.ts', startLine: 5 },
            neighborLabels: ['Function'],
            r: { weight: 1 },
            rType: 'CALLS',
          },
        ],
        metadata: null,
      });

      const result = await codeGraphService.getNeighbors('File:/src/index.ts', 'out');

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]!.id).toBe('Function:/src/util.ts:helper:5');
      expect(result.nodes[0]!.label).toBe('Function');
      expect(result.nodes[0]!.displayName).toBe('helper');

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]!.label).toBe('CALLS');
    });

    it('deduplicates nodes and edges', async () => {
      const sameNeighbor = { name: 'helper', filePath: '/src/util.ts', startLine: 5 };
      mockClient.roQuery.mockResolvedValueOnce({
        data: [
          {
            neighbor: sameNeighbor,
            neighborLabels: ['Function'],
            r: { weight: 1 },
            rType: 'CALLS',
          },
          {
            neighbor: sameNeighbor,
            neighborLabels: ['Function'],
            r: { weight: 1 },
            rType: 'CALLS',
          },
        ],
        metadata: null,
      });

      const result = await codeGraphService.getNeighbors('File:/src/index.ts');

      expect(result.nodes).toHaveLength(1);
      expect(result.edges).toHaveLength(1);
    });
  });
});
