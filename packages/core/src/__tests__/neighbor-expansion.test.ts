import { describe, it, expect, vi } from 'vitest';
import { fetchSiblingSymbols } from '../enrichedSearchV2';

describe('fetchSiblingSymbols', () => {
  it('returns the previous and next symbol in the same file by line range', async () => {
    const mockClient = {
      roQuery: vi.fn().mockResolvedValue({
        data: [
          { id: 'id-a', name: 'fnA', startLine: 10, endLine: 20, signature: 'fnA sig', nodeType: 'Function' },
          { id: 'id-b', name: 'fnB', startLine: 30, endLine: 40, signature: 'fnB sig', nodeType: 'Function' },
          { id: 'id-c', name: 'fnC', startLine: 50, endLine: 60, signature: 'fnC sig', nodeType: 'Function' },
        ],
      }),
    };
    const siblings = await fetchSiblingSymbols(mockClient as never, '/file.ts', 'id-b');
    expect(siblings).toHaveLength(2);
    expect(siblings.map(s => s.name)).toEqual(['fnA', 'fnC']);
  });

  it('handles edge case: target is first symbol (no prev)', async () => {
    const mockClient = {
      roQuery: vi.fn().mockResolvedValue({
        data: [
          { id: 'id-a', name: 'fnA', startLine: 10, endLine: 20, nodeType: 'Function' },
          { id: 'id-b', name: 'fnB', startLine: 30, endLine: 40, nodeType: 'Function' },
        ],
      }),
    };
    const siblings = await fetchSiblingSymbols(mockClient as never, '/file.ts', 'id-a');
    expect(siblings).toHaveLength(1);
    expect(siblings[0]?.name).toBe('fnB');
  });

  it('handles edge case: target is last symbol (no next)', async () => {
    const mockClient = {
      roQuery: vi.fn().mockResolvedValue({
        data: [
          { id: 'id-a', name: 'fnA', startLine: 10, endLine: 20, nodeType: 'Function' },
          { id: 'id-b', name: 'fnB', startLine: 30, endLine: 40, nodeType: 'Function' },
        ],
      }),
    };
    const siblings = await fetchSiblingSymbols(mockClient as never, '/file.ts', 'id-b');
    expect(siblings).toHaveLength(1);
    expect(siblings[0]?.name).toBe('fnA');
  });

  it('returns empty array for files with only one symbol', async () => {
    const mockClient = {
      roQuery: vi.fn().mockResolvedValue({
        data: [{ id: 'id-lonely', name: 'lonelyFn', startLine: 10, endLine: 20, nodeType: 'Function' }],
      }),
    };
    const siblings = await fetchSiblingSymbols(mockClient as never, '/file.ts', 'id-lonely');
    expect(siblings).toEqual([]);
  });
});
