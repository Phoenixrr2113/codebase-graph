/**
 * CodeGraphService Unit Tests
 *
 * Tests the unified service layer that wraps all Cypher query logic.
 * Mocks the graph client and config to isolate service behavior.
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
  // search
  // =========================================================================
  describe('search', () => {
    it('constructs Cypher with toLower/CONTAINS', async () => {
      await codeGraphService.search('myFunc');

      expect(mockClient.roQuery).toHaveBeenCalledTimes(1);
      const cypher: string = mockClient.roQuery.mock.calls[0][0];
      expect(cypher).toContain('toLower');
      expect(cypher).toContain('CONTAINS');
    });

    it('adds label check when type filter is provided', async () => {
      await codeGraphService.search('myFunc', { type: 'function' });

      const cypher: string = mockClient.roQuery.mock.calls[0][0];
      // FalkorDB dialect produces n:Function
      expect(cypher).toContain('n:Function');
    });

    it('returns mapped results with correct structure', async () => {
      mockClient.roQuery.mockResolvedValueOnce({
        data: [
          {
            n: { name: 'doStuff', filePath: '/src/util.ts', startLine: 10 },
            labels: 'Function',
          },
          {
            n: { name: 'Helper', filePath: '/src/helper.ts', startLine: 1 },
            labels: ['Class'],
          },
        ],
        metadata: null,
      });

      const result = await codeGraphService.search('stuff');

      expect(result.results).toHaveLength(2);
      expect(result.total).toBe(2);

      expect(result.results[0]).toEqual({
        name: 'doStuff',
        type: 'Function',
        filePath: '/src/util.ts',
        line: 10,
      });
      expect(result.results[1]).toEqual({
        name: 'Helper',
        type: 'Class',
        filePath: '/src/helper.ts',
        line: 1,
      });
    });
  });

  // =========================================================================
  // findSymbol
  // =========================================================================
  describe('findSymbol', () => {
    it('returns null symbol for empty data', async () => {
      const result = await codeGraphService.findSymbol('nonExistent');

      expect(result).toEqual({ symbol: null });
    });

    it('returns symbol + alternatives when multiple found', async () => {
      mockClient.roQuery.mockResolvedValueOnce({
        data: [
          {
            n: { name: 'render', filePath: '/src/a.ts', startLine: 5, endLine: 20, complexity: 3 },
            labels: 'Function',
          },
          {
            n: { name: 'render', filePath: '/src/b.ts', startLine: 10 },
            labels: 'Function',
          },
          {
            n: { name: 'render', filePath: '/src/c.ts', startLine: 15 },
            labels: 'Function',
          },
        ],
        metadata: null,
      });

      const result = await codeGraphService.findSymbol('render');

      expect(result.symbol).not.toBeNull();
      expect(result.symbol!.name).toBe('render');
      expect(result.symbol!.file).toBe('/src/a.ts');
      expect(result.symbol!.line).toBe(5);
      expect(result.symbol!.endLine).toBe(20);
      expect(result.symbol!.complexity).toBe(3);
      expect(result.symbol!.kind).toBe('function');

      expect(result.alternatives).toBeDefined();
      expect(result.alternatives).toHaveLength(2);
      expect(result.alternatives![0]!.file).toBe('/src/b.ts');
      expect(result.alternatives![1]!.file).toBe('/src/c.ts');
    });
  });

  // =========================================================================
  // getComplexityHotspots
  // =========================================================================
  describe('getComplexityHotspots', () => {
    it('uses threshold in WHERE clause', async () => {
      // First call: hotspots query, second call: count query
      mockClient.roQuery
        .mockResolvedValueOnce({ data: [], metadata: null })
        .mockResolvedValueOnce({ data: [{ total: 0, maxC: 0, avgC: 0 }], metadata: null });

      await codeGraphService.getComplexityHotspots({ threshold: 15 });

      expect(mockClient.roQuery).toHaveBeenCalledTimes(2);
      const cypher: string = mockClient.roQuery.mock.calls[0][0];
      expect(cypher).toContain('$threshold');

      const params = mockClient.roQuery.mock.calls[0][1];
      expect(params).toEqual({ params: { threshold: 15 } });
    });

    it('returns correct summary structure', async () => {
      mockClient.roQuery
        .mockResolvedValueOnce({
          data: [
            { name: 'bigFunc', file: '/src/big.ts', complexity: 25, cognitive: 18, nesting: 4, lines: 80 },
            { name: 'medFunc', file: '/src/med.ts', complexity: 12, cognitive: 8, nesting: 3, lines: 40 },
          ],
          metadata: null,
        })
        .mockResolvedValueOnce({
          data: [{ total: 50, maxC: 25, avgC: 5.5 }],
          metadata: null,
        });

      const result = await codeGraphService.getComplexityHotspots();

      expect(result.hotspots).toHaveLength(2);
      expect(result.hotspots[0]).toEqual({
        name: 'bigFunc',
        file: '/src/big.ts',
        complexity: 25,
        cognitive: 18,
        nesting: 4,
        lines: 80,
      });

      expect(result.summary).toEqual({
        totalFunctions: 50,
        overThreshold: 2,
        maxComplexity: 25,
        avgComplexity: 5.5,
      });
    });
  });

  // =========================================================================
  // getIndexStatus
  // =========================================================================
  describe('getIndexStatus', () => {
    it('returns empty when counts are 0', async () => {
      // getIndexStatus calls roQuery 4 times in Promise.all + 1 for edges
      mockClient.roQuery
        .mockResolvedValueOnce({ data: [{ count: 0 }], metadata: null }) // File
        .mockResolvedValueOnce({ data: [{ count: 0 }], metadata: null }) // Function
        .mockResolvedValueOnce({ data: [{ count: 0 }], metadata: null }) // Class
        .mockResolvedValueOnce({ data: [], metadata: null })             // Project
        .mockResolvedValueOnce({ data: [{ count: 0 }], metadata: null }); // Edges

      const result = await codeGraphService.getIndexStatus();

      expect(result.status).toBe('empty');
      expect(result.totalFiles).toBe(0);
      expect(result.totalFunctions).toBe(0);
      expect(result.totalClasses).toBe(0);
      expect(result.totalEdges).toBe(0);
      expect(result.projects).toEqual([]);
    });

    it('returns ready when files exist', async () => {
      mockClient.roQuery
        .mockResolvedValueOnce({ data: [{ count: 42 }], metadata: null })  // File
        .mockResolvedValueOnce({ data: [{ count: 120 }], metadata: null }) // Function
        .mockResolvedValueOnce({ data: [{ count: 8 }], metadata: null })   // Class
        .mockResolvedValueOnce({                                            // Project
          data: [{ name: 'myProject', path: '/src', fileCount: 42, lastParsed: '2025-01-15' }],
          metadata: null,
        })
        .mockResolvedValueOnce({ data: [{ count: 350 }], metadata: null }); // Edges

      const result = await codeGraphService.getIndexStatus();

      expect(result.status).toBe('ready');
      expect(result.totalFiles).toBe(42);
      expect(result.totalFunctions).toBe(120);
      expect(result.totalClasses).toBe(8);
      expect(result.totalEdges).toBe(350);
      expect(result.projects).toHaveLength(1);
      expect(result.projects[0]!.name).toBe('myProject');
      expect(result.lastIndexed).toBe('2025-01-15');
    });
  });

  // =========================================================================
  // getFunctionCallers
  // =========================================================================
  describe('getFunctionCallers', () => {
    it('constructs correct Cypher with CALLS and $name', async () => {
      await codeGraphService.getFunctionCallers('processData');

      expect(mockClient.roQuery).toHaveBeenCalledTimes(1);
      const cypher: string = mockClient.roQuery.mock.calls[0][0];
      expect(cypher).toContain('CALLS');
      expect(cypher).toContain('$name');

      const params = mockClient.roQuery.mock.calls[0][1];
      expect(params).toEqual({ params: { name: 'processData' } });
    });

    it('maps results correctly', async () => {
      mockClient.roQuery.mockResolvedValueOnce({
        data: [
          { name: 'handleRequest', filePath: '/src/handler.ts', startLine: 30 },
          { name: 'runPipeline', filePath: '/src/pipeline.ts', startLine: 55 },
        ],
        metadata: null,
      });

      const result = await codeGraphService.getFunctionCallers('processData');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        name: 'handleRequest',
        filePath: '/src/handler.ts',
        startLine: 30,
      });
      expect(result[1]).toEqual({
        name: 'runPipeline',
        filePath: '/src/pipeline.ts',
        startLine: 55,
      });
    });
  });

  // =========================================================================
  // getRepoMap
  // =========================================================================
  describe('getRepoMap', () => {
    it('groups by file and respects token budget', async () => {
      mockClient.roQuery.mockResolvedValueOnce({
        data: [
          { name: 'parseFile', file: '/src/parser/index.ts', kind: 'Function', connections: 10, complexity: 5, line: 20 },
          { name: 'tokenize', file: '/src/parser/index.ts', kind: 'Function', connections: 6, complexity: 3, line: 45 },
          { name: 'render', file: '/src/ui/app.tsx', kind: 'Function', connections: 8, complexity: 2, line: 10 },
        ],
        metadata: null,
      });

      const result = await codeGraphService.getRepoMap({ maxTokens: 2048 });

      expect(result.filesIncluded).toBe(2);
      expect(result.symbolsIncluded).toBe(3);
      expect(result.map).toContain('Repository Map');
      // Symbols grouped under their file paths
      expect(result.map).toContain('parser/index.ts');
      expect(result.map).toContain('parseFile');
      expect(result.map).toContain('tokenize');
      expect(result.map).toContain('ui/app.tsx');
      expect(result.map).toContain('render');
    });
  });
});
