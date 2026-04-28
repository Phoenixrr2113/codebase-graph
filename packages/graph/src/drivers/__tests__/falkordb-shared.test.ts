import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureSchemaImpl } from '../falkordb-shared';

function makeFakeGraph() {
  return {
    query: vi.fn().mockResolvedValue({ data: [] }),
    roQuery: vi.fn().mockResolvedValue({ data: [] }),
  };
}

describe('ensureSchemaImpl — embedding dim DI', () => {
  beforeEach(() => {
    delete process.env['CODEGRAPH_EMBEDDING_PROVIDER'];
    delete process.env['CODEGRAPH_EMBEDDING_DIM'];
    delete process.env['VOYAGE_API_KEY'];
    delete process.env['OPENROUTER_API_KEY'];
  });

  it('uses provided embeddingDim instead of reading process.env', async () => {
    const graph = makeFakeGraph();
    await ensureSchemaImpl(graph as never, { embeddingDim: 768 });

    const calls = graph.query.mock.calls.map(c => c[0] as string);
    const vectorCalls = calls.filter(c => c.includes('VECTOR INDEX') || c.toLowerCase().includes('vector'));
    const usedDim = vectorCalls.some(c => c.includes('768'));
    expect(usedDim).toBe(true);
  });

  it('falls back to env reading when no opts passed', async () => {
    const graph = makeFakeGraph();
    process.env['CODEGRAPH_EMBEDDING_DIM'] = '1024';

    await ensureSchemaImpl(graph as never);

    const calls = graph.query.mock.calls.map(c => c[0] as string);
    const vectorCalls = calls.filter(c => c.includes('VECTOR INDEX') || c.toLowerCase().includes('vector'));
    const usedDim = vectorCalls.some(c => c.includes('1024'));
    expect(usedDim).toBe(true);

    delete process.env['CODEGRAPH_EMBEDDING_DIM'];
  });
});
