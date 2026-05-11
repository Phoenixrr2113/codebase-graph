import { describe, expect, it, beforeEach, vi } from 'vitest';

// Mock the reranker module BEFORE importing bridge-linker
vi.mock('../reranker', () => ({
  rerank: vi.fn(),
  getLastRerankWarning: () => null,
  isRerankAvailable: () => true,
}));

import { linkEntitiesToCode } from '../bridge-linker';
import { rerank } from '../reranker';

describe('linkEntitiesToCode — cross-encoder verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeStubClient(symbols: Array<{ label: string; name: string; filePath?: string }>) {
    return {
      roQuery: vi.fn(async (cypher: string) => {
        const m = cypher.match(/MATCH \(n:(\w+)\)/);
        const label = m?.[1] ?? '';
        const matching = symbols.filter((s) => s.label === label);
        return { data: matching.map((s) => ({ name: s.name, filePath: s.filePath ?? null })) };
      }),
      query: vi.fn(),
    };
  }

  function makeStubKgOps() {
    const created: any[] = [];
    return {
      created,
      createAboutEdge: vi.fn(async (input: any) => {
        created.push(input);
        return true;
      }),
      getAboutEdgesForEntity: vi.fn(async () => []),
    };
  }

  it('attaches crossEncoderScore from rerank batch result', async () => {
    const symbols = [
      { label: 'Function', name: 'resolve_redirects', filePath: 'sessions.py' },
      { label: 'Function', name: 'rebuildAuth', filePath: 'auth.py' },
    ];

    // Mock rerank to score resolve_redirects high, rebuildAuth low
    (rerank as any).mockResolvedValue([
      { index: 0, relevanceScore: 0.85 },
      { index: 1, relevanceScore: 0.20 },
    ]);

    const client = makeStubClient(symbols) as any;
    const kgOps = makeStubKgOps();

    await linkEntitiesToCode(
      [
        { text: 'resolve_redirects', type: 'CodeEntity' },
        { text: 'rebuildAuth', type: 'CodeEntity' },
      ],
      client,
      kgOps as any,
      { documentContext: 'How redirect resolution works in the session module.' },
    );

    expect(kgOps.created).toHaveLength(2);
    const rrEdge = kgOps.created.find((e) => e.targetValue === 'resolve_redirects');
    const raEdge = kgOps.created.find((e) => e.targetValue === 'rebuildAuth');
    expect(rrEdge?.crossEncoderScore).toBe(0.85);
    expect(raEdge?.crossEncoderScore).toBe(0.20);
  });

  it('defaults crossEncoderScore to 1.0 when rerank returns no result', async () => {
    const symbols = [{ label: 'Function', name: 'resolve_redirects', filePath: 'sessions.py' }];

    (rerank as any).mockResolvedValue([]);

    const client = makeStubClient(symbols) as any;
    const kgOps = makeStubKgOps();

    await linkEntitiesToCode(
      [{ text: 'resolve_redirects', type: 'CodeEntity' }],
      client,
      kgOps as any,
      { documentContext: 'redirect logic' },
    );

    expect(kgOps.created[0]?.crossEncoderScore).toBe(1.0);
  });

  it('omits crossEncoderScore entirely when documentContext is missing (legacy callers)', async () => {
    const symbols = [{ label: 'Function', name: 'resolve_redirects', filePath: 'sessions.py' }];

    const client = makeStubClient(symbols) as any;
    const kgOps = makeStubKgOps();

    await linkEntitiesToCode(
      [{ text: 'resolve_redirects', type: 'CodeEntity' }],
      client,
      kgOps as any,
      {}, // no documentContext
    );

    expect(rerank).not.toHaveBeenCalled();
    expect(kgOps.created[0]?.crossEncoderScore).toBeUndefined();
  });

  it('calls rerank exactly once per document (batches all matches)', async () => {
    const symbols = [
      { label: 'Function', name: 'resolve_redirects', filePath: 'sessions.py' },
      { label: 'Function', name: 'rebuildAuth', filePath: 'auth.py' },
      { label: 'Class', name: 'SessionRedirectMixin', filePath: 'sessions.py' },
    ];

    (rerank as any).mockResolvedValue([
      { index: 0, relevanceScore: 0.9 },
      { index: 1, relevanceScore: 0.3 },
      { index: 2, relevanceScore: 0.7 },
    ]);

    const client = makeStubClient(symbols) as any;
    const kgOps = makeStubKgOps();

    await linkEntitiesToCode(
      [
        { text: 'resolve_redirects', type: 'CodeEntity' },
        { text: 'rebuildAuth', type: 'CodeEntity' },
        { text: 'SessionRedirectMixin', type: 'CodeEntity' },
      ],
      client,
      kgOps as any,
      { documentContext: 'redirect handling in sessions' },
    );

    expect(rerank).toHaveBeenCalledTimes(1);
    const [query, documents] = (rerank as any).mock.calls[0];
    expect(query).toBe('redirect handling in sessions');
    expect(documents).toHaveLength(3);
    expect(documents[0]).toContain('resolve_redirects');
  });
});
