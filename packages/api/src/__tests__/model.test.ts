/**
 * Model layer unit tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the graph client
vi.mock('@codegraph/graph', () => ({
  createClient: vi.fn().mockResolvedValue({
    roQuery: vi.fn().mockResolvedValue({ data: [], metadata: null }),
  }),
  createOperations: vi.fn().mockReturnValue({
    getProjects: vi.fn().mockResolvedValue([]),
    deleteProject: vi.fn().mockResolvedValue(undefined),
    clearAll: vi.fn().mockResolvedValue(undefined),
  }),
  createQueries: vi.fn().mockReturnValue({
    getFullGraph: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
    getFileSubgraph: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
    getStats: vi.fn().mockResolvedValue({ totalNodes: 0, totalEdges: 0 }),
    search: vi.fn().mockResolvedValue([]),
  }),
}));

describe('Model Layer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('graphClient', () => {
    it('should export getClient function', async () => {
      const { getClient } = await import('../model/graphClient');
      expect(getClient).toBeDefined();
      expect(typeof getClient).toBe('function');
    });

    it('should export getQueries function', async () => {
      const { getQueries } = await import('../model/graphClient');
      expect(getQueries).toBeDefined();
    });

    it('should export getOperations function', async () => {
      const { getOperations } = await import('../model/graphClient');
      expect(getOperations).toBeDefined();
    });

    it('should export resetClient function', async () => {
      const { resetClient } = await import('../model/graphClient');
      expect(resetClient).toBeDefined();
      expect(typeof resetClient).toBe('function');
    });
  });

  describe('entityModel', () => {
    it('should export getWithConnections function', async () => {
      const entityModel = await import('../model/entityModel');
      expect(entityModel.getWithConnections).toBeDefined();
    });

    it('getWithConnections should return null for non-existent entity', async () => {
      const { getWithConnections } = await import('../model/entityModel');
      const result = await getWithConnections('non-existent-id');
      expect(result).toBeNull();
    });
  });

  describe('neighborsModel', () => {
    it('should export getNeighbors function', async () => {
      const neighborsModel = await import('../model/neighborsModel');
      expect(neighborsModel.getNeighbors).toBeDefined();
    });

    it('getNeighbors should return empty arrays for non-existent entity', async () => {
      const { getNeighbors } = await import('../model/neighborsModel');
      const result = await getNeighbors('non-existent-id');
      expect(result.nodes).toEqual([]);
      expect(result.edges).toEqual([]);
      expect(result.centerId).toBe('non-existent-id');
    });

    it('getNeighbors should accept direction parameter', async () => {
      const { getNeighbors } = await import('../model/neighborsModel');
      const result = await getNeighbors('test-id', 'in');
      expect(result.direction).toBe('in');
    });
  });

  describe('queryModel', () => {
    it('should export executeCypher function', async () => {
      const queryModel = await import('../model/queryModel');
      expect(queryModel.executeCypher).toBeDefined();
    });

    it('executeCypher should return results and metadata', async () => {
      const { executeCypher } = await import('../model/queryModel');
      const result = await executeCypher('MATCH (n) RETURN n');
      expect(result).toHaveProperty('results');
      expect(result).toHaveProperty('metadata');
    });
  });
});
