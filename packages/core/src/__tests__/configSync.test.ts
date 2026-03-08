/**
 * Unit Tests: configSync module
 *
 * Tests syncConfigToGraph, initialSync, and syncIfNeeded with mocked
 * dependencies. Uses vi.resetModules() to get fresh module-level state
 * (lastKnownProjects, syncInProgress, lastSyncTime) for each test.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';

// ============================================================================
// Mocks — must be set up before dynamic imports
// ============================================================================

vi.mock('../config', () => ({
  loadConfig: vi.fn(),
  saveConfig: vi.fn(),
}));

vi.mock('../indexer', () => ({
  indexProject: vi.fn(),
  isProjectIndexed: vi.fn(),
}));

vi.mock('../graphClient', () => ({
  getGraphClient: vi.fn(),
}));

vi.mock('@codegraph/graph', () => ({
  createOperations: vi.fn(),
}));

vi.mock('@codegraph/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ============================================================================
// Helpers
// ============================================================================

// Re-import the module fresh for each test to reset module-level state
async function getFreshModule() {
  const mod = await import('../configSync');
  return mod;
}

async function getMocks() {
  const configMod = await import('../config');
  const indexerMod = await import('../indexer');
  const graphClientMod = await import('../graphClient');
  const graphMod = await import('@codegraph/graph');
  return {
    loadConfig: configMod.loadConfig as Mock,
    saveConfig: configMod.saveConfig as Mock,
    indexProject: indexerMod.indexProject as Mock,
    isProjectIndexed: indexerMod.isProjectIndexed as Mock,
    getGraphClient: graphClientMod.getGraphClient as Mock,
    createOperations: graphMod.createOperations as Mock,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('syncConfigToGraph', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('returns empty results when config is null', async () => {
    const mocks = await getMocks();
    mocks.loadConfig.mockResolvedValue(null);

    const { syncConfigToGraph } = await getFreshModule();
    const result = await syncConfigToGraph();

    expect(result.indexed).toEqual([]);
    expect(result.deleted).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('indexes new projects found in config', async () => {
    const mocks = await getMocks();
    mocks.loadConfig.mockResolvedValue({
      activeProjects: ['/projects/new-app'],
      managedProjects: [],
      lastUpdated: new Date().toISOString(),
      setupComplete: true,
    });
    mocks.isProjectIndexed.mockResolvedValue(false);
    mocks.indexProject.mockResolvedValue({
      success: true,
      projectName: 'new-app',
      projectId: 'p1',
      stats: { files: 10, entities: 50, edges: 30, errors: 0 },
      errorMessages: [],
    });
    mocks.saveConfig.mockResolvedValue(undefined);

    const { syncConfigToGraph } = await getFreshModule();
    const result = await syncConfigToGraph();

    expect(result.indexed).toContain('/projects/new-app');
    expect(mocks.indexProject).toHaveBeenCalledWith('/projects/new-app');
    expect(mocks.saveConfig).toHaveBeenCalled();
  });

  it('skips indexing for already-indexed projects', async () => {
    const mocks = await getMocks();
    mocks.loadConfig.mockResolvedValue({
      activeProjects: ['/projects/existing'],
      managedProjects: [],
      lastUpdated: new Date().toISOString(),
      setupComplete: true,
    });
    mocks.isProjectIndexed.mockResolvedValue(true);
    mocks.saveConfig.mockResolvedValue(undefined);

    const { syncConfigToGraph } = await getFreshModule();
    const result = await syncConfigToGraph();

    expect(result.indexed).toEqual([]);
    expect(mocks.indexProject).not.toHaveBeenCalled();
  });

  it('deletes projects removed from config', async () => {
    const mocks = await getMocks();
    const mockDeleteProject = vi.fn().mockResolvedValue(undefined);
    const mockGetProjectByRoot = vi.fn().mockResolvedValue({
      id: 'p1',
      name: 'old-app',
      rootPath: '/projects/old-app',
    });
    mocks.createOperations.mockReturnValue({
      deleteProject: mockDeleteProject,
      getProjectByRoot: mockGetProjectByRoot,
    });
    mocks.getGraphClient.mockResolvedValue({});

    // First call: config has project, sets lastKnownProjects
    mocks.loadConfig.mockResolvedValue({
      activeProjects: ['/projects/old-app'],
      managedProjects: [],
      lastUpdated: new Date().toISOString(),
      setupComplete: true,
    });
    mocks.isProjectIndexed.mockResolvedValue(true);
    mocks.saveConfig.mockResolvedValue(undefined);

    const { syncConfigToGraph } = await getFreshModule();
    await syncConfigToGraph();

    // Second call: project removed from config
    mocks.loadConfig.mockResolvedValue({
      activeProjects: [],
      managedProjects: ['/projects/old-app'],
      lastUpdated: new Date().toISOString(),
      setupComplete: true,
    });

    const result2 = await syncConfigToGraph();

    expect(result2.deleted).toContain('/projects/old-app');
    expect(mockDeleteProject).toHaveBeenCalledWith('p1');
  });

  it('reports errors when indexing fails', async () => {
    const mocks = await getMocks();
    mocks.loadConfig.mockResolvedValue({
      activeProjects: ['/projects/broken'],
      managedProjects: [],
      lastUpdated: new Date().toISOString(),
      setupComplete: true,
    });
    mocks.isProjectIndexed.mockResolvedValue(false);
    mocks.indexProject.mockResolvedValue({
      success: false,
      projectName: '',
      projectId: '',
      stats: { files: 0, entities: 0, edges: 0, errors: 1 },
      errorMessages: ['Directory not found'],
    });
    mocks.saveConfig.mockResolvedValue(undefined);

    const { syncConfigToGraph } = await getFreshModule();
    const result = await syncConfigToGraph();

    expect(result.indexed).toEqual([]);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('/projects/broken');
  });

  it('handles exceptions during indexing gracefully', async () => {
    const mocks = await getMocks();
    mocks.loadConfig.mockResolvedValue({
      activeProjects: ['/projects/crash'],
      managedProjects: [],
      lastUpdated: new Date().toISOString(),
      setupComplete: true,
    });
    mocks.isProjectIndexed.mockRejectedValue(new Error('DB connection lost'));
    mocks.saveConfig.mockResolvedValue(undefined);

    const { syncConfigToGraph } = await getFreshModule();
    const result = await syncConfigToGraph();

    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('DB connection lost');
  });

  it('persists managedProjects to config after sync', async () => {
    const mocks = await getMocks();
    const config = {
      activeProjects: ['/projects/a', '/projects/b'],
      managedProjects: [],
      lastUpdated: new Date().toISOString(),
      setupComplete: true,
    };
    mocks.loadConfig.mockResolvedValue(config);
    mocks.isProjectIndexed.mockResolvedValue(true); // skip indexing
    mocks.saveConfig.mockResolvedValue(undefined);

    const { syncConfigToGraph } = await getFreshModule();
    await syncConfigToGraph();

    expect(mocks.saveConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        managedProjects: expect.arrayContaining(['/projects/a', '/projects/b']),
      }),
    );
  });

  it('populates lastKnownProjects from managedProjects on first run', async () => {
    const mocks = await getMocks();

    // First run: config has managedProjects from previous session
    // and activeProjects matches — nothing should be indexed or deleted
    mocks.loadConfig.mockResolvedValue({
      activeProjects: ['/projects/existing'],
      managedProjects: ['/projects/existing'],
      lastUpdated: new Date().toISOString(),
      setupComplete: true,
    });
    mocks.saveConfig.mockResolvedValue(undefined);

    const { syncConfigToGraph } = await getFreshModule();
    const result = await syncConfigToGraph();

    // Nothing to index or delete since managed matches active
    expect(result.indexed).toEqual([]);
    expect(result.deleted).toEqual([]);
    expect(mocks.indexProject).not.toHaveBeenCalled();
  });
});

describe('initialSync', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('calls syncConfigToGraph and returns', async () => {
    const mocks = await getMocks();
    mocks.loadConfig.mockResolvedValue(null);

    const { initialSync } = await getFreshModule();
    // Should not throw
    await initialSync();
  });
});

describe('syncIfNeeded', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('calls syncConfigToGraph when config has changed', async () => {
    const mocks = await getMocks();

    // First call: establish baseline
    mocks.loadConfig.mockResolvedValue({
      activeProjects: ['/projects/a'],
      managedProjects: [],
      lastUpdated: new Date().toISOString(),
      setupComplete: true,
    });
    mocks.isProjectIndexed.mockResolvedValue(true);
    mocks.saveConfig.mockResolvedValue(undefined);

    const { syncConfigToGraph, syncIfNeeded } = await getFreshModule();
    await syncConfigToGraph(); // Establish lastKnownProjects

    // Now change config and call syncIfNeeded
    mocks.loadConfig.mockResolvedValue({
      activeProjects: ['/projects/a', '/projects/b'],
      managedProjects: ['/projects/a'],
      lastUpdated: new Date().toISOString(),
      setupComplete: true,
    });

    // Wait for debounce (the lastSyncTime was set during syncConfigToGraph)
    // We need to advance past SYNC_DEBOUNCE_MS (5000ms)
    const originalDateNow = Date.now;
    let fakeNow = originalDateNow();
    vi.spyOn(Date, 'now').mockImplementation(() => {
      fakeNow += 6000; // advance past debounce
      return fakeNow;
    });

    await syncIfNeeded();

    // indexProject should have been called for /projects/b
    expect(mocks.isProjectIndexed).toHaveBeenCalledWith('/projects/b');

    Date.now = originalDateNow;
    vi.restoreAllMocks();
  });

  it('skips sync within debounce window', async () => {
    const mocks = await getMocks();
    mocks.loadConfig.mockResolvedValue({
      activeProjects: ['/projects/a'],
      managedProjects: [],
      lastUpdated: new Date().toISOString(),
      setupComplete: true,
    });
    mocks.isProjectIndexed.mockResolvedValue(true);
    mocks.saveConfig.mockResolvedValue(undefined);

    const { syncIfNeeded } = await getFreshModule();

    // First call sets lastSyncTime
    await syncIfNeeded();
    const callCount = mocks.loadConfig.mock.calls.length;

    // Second call within debounce window — should skip
    await syncIfNeeded();

    // loadConfig should not have been called again (debounce skips entirely)
    expect(mocks.loadConfig.mock.calls.length).toBe(callCount);
  });

  it('skips sync when projects have not changed', async () => {
    const mocks = await getMocks();
    mocks.loadConfig.mockResolvedValue({
      activeProjects: ['/projects/a'],
      managedProjects: [],
      lastUpdated: new Date().toISOString(),
      setupComplete: true,
    });
    mocks.isProjectIndexed.mockResolvedValue(true);
    mocks.saveConfig.mockResolvedValue(undefined);

    const { syncConfigToGraph, syncIfNeeded } = await getFreshModule();
    await syncConfigToGraph(); // Sets lastKnownProjects to ['/projects/a']

    // Advance past debounce
    const originalDateNow = Date.now;
    let fakeNow = originalDateNow();
    vi.spyOn(Date, 'now').mockImplementation(() => {
      fakeNow += 6000;
      return fakeNow;
    });

    // Config hasn't changed — same activeProjects
    mocks.loadConfig.mockResolvedValue({
      activeProjects: ['/projects/a'],
      managedProjects: ['/projects/a'],
      lastUpdated: new Date().toISOString(),
      setupComplete: true,
    });

    mocks.indexProject.mockClear();

    await syncIfNeeded();

    // No indexing should happen
    expect(mocks.indexProject).not.toHaveBeenCalled();

    Date.now = originalDateNow;
    vi.restoreAllMocks();
  });
});
