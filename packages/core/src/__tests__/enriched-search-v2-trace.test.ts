/**
 * Trace instrumentation test for enrichedSearchV2.
 *
 * Verifies that enrichedSearchV2 emits a TRACE-level log entry when
 * TRACE_ENABLED=true, and that the function behaves correctly when tracing
 * is disabled (zero-cost path).
 *
 * The trace config in @codegraph/logger is captured at module load time,
 * so we use vi.resetModules() + dynamic import after setting the env var
 * to exercise the enabled path.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before any dynamic imports
// ---------------------------------------------------------------------------

vi.mock('@codegraph/plugin-nlp', () => ({
  isEmbeddingAvailable: vi.fn().mockReturnValue(true),
  generateEmbedding: vi.fn().mockResolvedValue({ embedding: [0.1, 0.2], dimensions: 2, provider: 'voyage' }),
  rerank: vi.fn().mockResolvedValue([]),
  generateEmbeddings: vi.fn().mockResolvedValue({ embeddings: [], dimensions: 2, provider: 'voyage' }),
}));

vi.mock('@codegraph/graph', () => ({
  createOperations: vi.fn().mockReturnValue({
    searchByVector: vi.fn().mockResolvedValue([]),
  }),
}));

// ---------------------------------------------------------------------------
// Shared mock client — returns "0 embeddings" so the function returns early
// after the initial embedding-count check, without doing real vector search.
// ---------------------------------------------------------------------------

function makeMockClient() {
  return {
    roQuery: vi.fn().mockResolvedValue({ data: [{ count: 0 }], metadata: null }),
    query: vi.fn().mockResolvedValue({ data: [], metadata: null }),
    close: vi.fn().mockResolvedValue(undefined),
    dialect: {
      driverType: 'falkordb' as const,
      labelsExpr: (a: string) => `labels(${a})`,
      firstLabelExpr: (a: string) => `labels(${a})[0]`,
      typeExpr: (a: string) => `type(${a})`,
      labelCheckExpr: (a: string, l: string) => `${a}:${l}`,
      labelCaseExpr: (a: string, l: string) => `${a}:${l}`,
      supportsOnCreateOnMatch: true,
      normalizeNode: (raw: unknown) => ({ labels: [], properties: raw as Record<string, unknown> }),
      normalizeEdge: (raw: unknown) => ({ type: '', properties: raw as Record<string, unknown> }),
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('enrichedSearchV2 trace instrumentation', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // The trace logger uses console.error internally
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    delete process.env['TRACE_ENABLED'];
    vi.resetModules();
  });

  it('emits a TRACE log entry when TRACE_ENABLED=true', async () => {
    // Set env var BEFORE the traced module initializes so traceConfig captures it
    process.env['TRACE_ENABLED'] = 'true';

    // Dynamic import after env var is set — fresh module load reads TRACE_ENABLED=true
    vi.resetModules();
    const { enrichedSearchV2 } = await import('../enrichedSearchV2');

    const client = makeMockClient();
    await enrichedSearchV2('test query', client as never, {});

    // traced() calls traceLogger.debug() which routes through console.error
    const allOutput = errorSpy.mock.calls.flat().join(' ');
    expect(allOutput).toContain('enrichedSearchV2');
  });

  it('does NOT emit TRACE output when TRACE_ENABLED is unset (zero-cost)', async () => {
    delete process.env['TRACE_ENABLED'];

    vi.resetModules();
    const { enrichedSearchV2 } = await import('../enrichedSearchV2');

    const client = makeMockClient();
    await enrichedSearchV2('test query', client as never, {});

    // No TRACE namespace should appear in output
    const allOutput = errorSpy.mock.calls.flat().join(' ');
    expect(allOutput).not.toContain('[TRACE]');
  });

  it('returns a valid EnrichedV2Result regardless of tracing state', async () => {
    vi.resetModules();
    const { enrichedSearchV2 } = await import('../enrichedSearchV2');

    const client = makeMockClient();
    const result = await enrichedSearchV2('some query', client as never, {});

    expect(result).toHaveProperty('hits');
    expect(result).toHaveProperty('meta');
    expect(result.meta.query).toBe('some query');
  });
});
