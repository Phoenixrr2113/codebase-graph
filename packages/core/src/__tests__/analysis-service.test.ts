import { beforeEach, describe, expect, it, vi } from 'vitest';

const analysisMethods = vi.hoisted(() => ({
  getBlastRadius: vi.fn(),
  getImportCycles: vi.fn(),
  getCallHierarchy: vi.fn(),
  getUnreferencedExports: vi.fn(),
  getHotspots: vi.fn(),
  getChangeCoupling: vi.fn(),
  getOwnership: vi.fn(),
}));

const createAnalysisQueries = vi.hoisted(() => vi.fn(() => analysisMethods));
const graphClient = vi.hoisted(() => ({ graphName: 'core-analysis-test' }));
const AnalysisQueryInputError = vi.hoisted(() => class AnalysisQueryInputError extends Error {});

vi.mock('@codegraph/graph', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@codegraph/graph')>()),
  createAnalysisQueries,
  AnalysisQueryInputError,
}));

vi.mock('../graphClient', () => ({
  getGraphClient: vi.fn().mockResolvedValue(graphClient),
}));

const { codeGraphService } = await import('../service');

describe('core analysis service facade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('publishes the typed analysis input error from the core entry point', async () => {
    const corePackage = await import('../index');
    const graphPackage = await import('@codegraph/graph');

    expect(corePackage.AnalysisQueryInputError).toBe(graphPackage.AnalysisQueryInputError);
  });

  it.each([
    ['getBlastRadius', { id: 'symbol', depth: 2, limit: 10 }, { status: 'ok', items: [] }],
    ['getImportCycles', { rootPath: '/repo', maxDepth: 8, limit: 10 }, { cycles: [] }],
    ['getCallHierarchy', { id: 'symbol', direction: 'both', limit: 10 }, { callers: [], callees: [] }],
    ['getUnreferencedExports', { rootPath: '/repo', limit: 10 }, { items: [] }],
    ['getHotspots', { rootPath: '/repo', scoreBy: 'degree', limit: 10 }, { items: [], historyCoverage: {} }],
    ['getChangeCoupling', { rootPath: '/repo', minSupport: 2, limit: 10 }, { items: [], historyCoverage: {} }],
    ['getOwnership', { rootPath: '/repo', pathPrefix: '/repo/src', limit: 10 }, { items: [], historyCoverage: {} }],
  ] as const)('exposes %s with the frozen input object unchanged', async (methodName, input, expected) => {
    analysisMethods[methodName].mockResolvedValueOnce(expected);

    const result = await codeGraphService[methodName](input as never);

    expect(result).toBe(expected);
    expect(createAnalysisQueries).toHaveBeenCalledWith(graphClient);
    expect(analysisMethods[methodName]).toHaveBeenCalledWith(input);
  });
});
