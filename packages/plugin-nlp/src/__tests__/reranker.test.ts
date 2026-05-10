import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { rerank, getLastRerankWarning, clearLastRerankWarning } from '../reranker';

describe('rerank — silent-failure detection', () => {
  const savedKey = process.env['VOYAGE_API_KEY'];
  const savedProvider = process.env['CODEGRAPH_RERANK_PROVIDER'];
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env['VOYAGE_API_KEY'] = 'test-key';
    process.env['CODEGRAPH_RERANK_PROVIDER'] = 'voyage';
    clearLastRerankWarning();
  });

  afterEach(() => {
    if (savedKey === undefined) delete process.env['VOYAGE_API_KEY'];
    else process.env['VOYAGE_API_KEY'] = savedKey;
    if (savedProvider === undefined) delete process.env['CODEGRAPH_RERANK_PROVIDER'];
    else process.env['CODEGRAPH_RERANK_PROVIDER'] = savedProvider;
    fetchSpy?.mockRestore();
  });

  it('records lastRerankWarning when API returns 403', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('AUTHZ_INSUFFICIENT_BALANCE', { status: 403 }),
    );
    const result = await rerank('q', ['doc1', 'doc2', 'doc3']);
    // Fallback returns synthetic scores in original order
    expect(result).toHaveLength(3);
    expect(result[0]!.index).toBe(0);
    // Warning should be set with the status code in it
    const warning = getLastRerankWarning();
    expect(warning).not.toBeNull();
    expect(warning).toMatch(/403/);
  });

  it('records lastRerankWarning when API returns 5xx', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    );
    await rerank('q', ['doc1']);
    expect(getLastRerankWarning()).toMatch(/500/);
  });

  it('clears lastRerankWarning on successful rerank', async () => {
    // First, fail
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('error', { status: 403 }),
    );
    await rerank('q', ['doc1']);
    expect(getLastRerankWarning()).not.toBeNull();

    // Then, succeed
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({
        data: [{ index: 0, relevance_score: 0.9 }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    await rerank('q', ['doc1']);
    expect(getLastRerankWarning()).toBeNull();
  });

  it('records lastRerankWarning when no API key is configured', async () => {
    delete process.env['VOYAGE_API_KEY'];
    delete process.env['CODEGRAPH_RERANK_PROVIDER'];
    await rerank('q', ['doc1', 'doc2']);
    const warning = getLastRerankWarning();
    expect(warning).not.toBeNull();
    expect(warning).toMatch(/no API key|unavailable|not configured/i);
  });
});

describe('rerank — Jina is no longer a supported provider', () => {
  it('rejects CODEGRAPH_RERANK_PROVIDER=jina with a clear error', async () => {
    const saved = process.env['CODEGRAPH_RERANK_PROVIDER'];
    process.env['CODEGRAPH_RERANK_PROVIDER'] = 'jina';
    try {
      // Either the function throws synchronously, or it falls back with a warning
      // pointing the user at Voyage. Accept either, but the user must NOT be
      // able to silently use Jina.
      await rerank('q', ['doc1']);
      const warning = getLastRerankWarning();
      expect(warning).not.toBeNull();
      expect(warning).toMatch(/jina.*not supported|jina.*deprecated|use voyage/i);
    } finally {
      if (saved === undefined) delete process.env['CODEGRAPH_RERANK_PROVIDER'];
      else process.env['CODEGRAPH_RERANK_PROVIDER'] = saved;
    }
  });
});
