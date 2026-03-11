/**
 * Service layer unit tests (formerly model layer tests)
 *
 * Tests that the core service exposes the methods that replaced the API model layer.
 * These are lightweight smoke tests; the actual query logic is tested in core's own tests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { codeGraphService } from '@codegraph/core';

// Mock dialect
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

// Spy on the service methods and mock them to avoid real DB calls
describe('Core Service Methods (replacing model layer)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should expose getEntityWithConnections', () => {
    expect(typeof codeGraphService.getEntityWithConnections).toBe('function');
  });

  it('should expose getNeighbors', () => {
    expect(typeof codeGraphService.getNeighbors).toBe('function');
  });

  it('should expose getNodesPaginated', () => {
    expect(typeof codeGraphService.getNodesPaginated).toBe('function');
  });

  it('should expose executeReadQuery', () => {
    expect(typeof codeGraphService.executeReadQuery).toBe('function');
  });

  it('should expose deleteProject', () => {
    expect(typeof codeGraphService.deleteProject).toBe('function');
  });

  it('should expose clearGraph', () => {
    expect(typeof codeGraphService.clearGraph).toBe('function');
  });

  it('should expose deleteFileEntities', () => {
    expect(typeof codeGraphService.deleteFileEntities).toBe('function');
  });

  it('should expose resolveProjectRootPath', () => {
    expect(typeof codeGraphService.resolveProjectRootPath).toBe('function');
  });

  it('should expose getProjects', () => {
    expect(typeof codeGraphService.getProjects).toBe('function');
  });

  it('should expose getGraphStats', () => {
    expect(typeof codeGraphService.getGraphStats).toBe('function');
  });

  it('should expose getFullGraph', () => {
    expect(typeof codeGraphService.getFullGraph).toBe('function');
  });

  it('should expose getFileSubgraph', () => {
    expect(typeof codeGraphService.getFileSubgraph).toBe('function');
  });

  it('should expose search', () => {
    expect(typeof codeGraphService.search).toBe('function');
  });
});
