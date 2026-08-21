import { describe, expect, it, vi } from 'vitest';
import { enrichFromGraph, enrichmentKey, type Candidate } from '../enrichedSearchV2';

function candidate(id: string): Candidate {
  return {
    id,
    name: 'constructor',
    nodeType: 'Function',
    filePath: '/project/widget.ts',
    startLine: 10,
    properties: { id },
    vectorScore: 1,
    score: 1,
  };
}

describe('enrichment identity', () => {
  it('binds, maps, and returns same-location candidates by persisted id', async () => {
    const firstId = `sym:v1:${'1'.repeat(64)}`;
    const secondId = `sym:v1:${'2'.repeat(64)}`;
    const client = {
      roQuery: vi.fn()
        .mockResolvedValueOnce({
          data: [
            { symbolId: firstId, callers: 1, calleeNames: [], importers: 0, testRefs: 0 },
            { symbolId: secondId, callers: 3, calleeNames: [], importers: 0, testRefs: 0 },
          ],
        })
        .mockResolvedValue({ data: [] }),
    };

    const result = await enrichFromGraph(client as never, [candidate(firstId), candidate(secondId)]);

    expect(client.roQuery).toHaveBeenCalledWith(
      expect.stringContaining('MATCH (n {id: item.id})'),
      expect.objectContaining({ params: { items: [{ id: firstId }, { id: secondId }] } }),
    );
    expect(result.get(enrichmentKey(firstId))?.callerCount).toBe(1);
    expect(result.get(enrichmentKey(secondId))?.callerCount).toBe(3);
  });
});
