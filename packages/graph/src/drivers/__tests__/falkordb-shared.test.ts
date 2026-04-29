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

  it('throws when no provider, no env, and no override are configured', async () => {
    const graph = makeFakeGraph();

    await expect(ensureSchemaImpl(graph as never)).rejects.toThrow(
      'Cannot determine embedding dimension'
    );
  });

  it('skips vector indexes (no throw) when CODEGRAPH_EMBEDDING_PROVIDER=none', async () => {
    const graph = makeFakeGraph();
    process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = 'none';

    await expect(ensureSchemaImpl(graph as never)).resolves.toBeUndefined();

    const calls = graph.query.mock.calls.map(c => c[0] as string);
    const vectorCalls = calls.filter(c => c.includes('VECTOR INDEX'));
    expect(vectorCalls).toHaveLength(0);
  });

  it('uses voyage dimension (1024) when CODEGRAPH_EMBEDDING_PROVIDER=voyage', async () => {
    const graph = makeFakeGraph();
    process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = 'voyage';

    await ensureSchemaImpl(graph as never);

    const calls = graph.query.mock.calls.map(c => c[0] as string);
    const vectorCalls = calls.filter(c => c.includes('VECTOR INDEX'));
    expect(vectorCalls.some(c => c.includes('1024'))).toBe(true);
  });

  it('uses local dimension (768) when CODEGRAPH_EMBEDDING_PROVIDER=local', async () => {
    const graph = makeFakeGraph();
    process.env['CODEGRAPH_EMBEDDING_PROVIDER'] = 'local';

    await ensureSchemaImpl(graph as never);

    const calls = graph.query.mock.calls.map(c => c[0] as string);
    const vectorCalls = calls.filter(c => c.includes('VECTOR INDEX'));
    expect(vectorCalls.some(c => c.includes('768'))).toBe(true);
  });

  it('auto-detects voyage (1024) from VOYAGE_API_KEY when no provider set', async () => {
    const graph = makeFakeGraph();
    process.env['VOYAGE_API_KEY'] = 'test-key';

    await ensureSchemaImpl(graph as never);

    const calls = graph.query.mock.calls.map(c => c[0] as string);
    const vectorCalls = calls.filter(c => c.includes('VECTOR INDEX'));
    expect(vectorCalls.some(c => c.includes('1024'))).toBe(true);
  });

  it('CODEGRAPH_EMBEDDING_DIM takes priority over provider auto-detect', async () => {
    const graph = makeFakeGraph();
    process.env['CODEGRAPH_EMBEDDING_DIM'] = '512';
    process.env['VOYAGE_API_KEY'] = 'test-key'; // would be 1024 without override

    await ensureSchemaImpl(graph as never);

    const calls = graph.query.mock.calls.map(c => c[0] as string);
    const vectorCalls = calls.filter(c => c.includes('VECTOR INDEX'));
    expect(vectorCalls.some(c => c.includes('512'))).toBe(true);
    expect(vectorCalls.some(c => c.includes('1024'))).toBe(false);
  });
});
