import { describe, expect, it, vi } from 'vitest';
import type { GraphClient, QueryOptions, QueryResult } from '../client';
import { falkorDialect } from '../drivers/falkordb';
import { createOperations } from '../operations';

function clientReturning(rows: Array<Record<string, unknown>>): GraphClient {
  return {
    graph: null,
    graphName: 'vector-row-mapping',
    dialect: falkorDialect,
    query: vi.fn(),
    roQuery: vi.fn(async <T>(_cypher: string, _options?: QueryOptions): Promise<QueryResult<T>> => ({
      data: rows as T[],
      metadata: [],
    })),
    ensureIndexes: vi.fn(),
    close: vi.fn(),
  };
}

describe('searchByVector row identity mapping', () => {
  it('projects and maps the persisted id returned by FalkorDB', async () => {
    const id = `sym:v1:${'a'.repeat(64)}`;
    const client = clientReturning([{
      id,
      name: 'buildWidget',
      filePath: '/project/widget.ts',
      startLine: 2,
      score: 0.01,
    }]);

    const results = await createOperations(client).searchByVector('Function', [0.1, 0.2], 5);

    expect(client.roQuery).toHaveBeenCalledWith(
      expect.stringContaining('node.id AS id'),
      expect.objectContaining({ params: { queryVec: [0.1, 0.2], k: 5 } }),
    );
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id,
      name: 'buildWidget',
      nodeType: 'Function',
      properties: expect.objectContaining({ id }),
    });
  });

  it('rejects a row whose persisted id is missing instead of silently returning no results', async () => {
    const client = clientReturning([{
      name: 'buildWidget',
      filePath: '/project/widget.ts',
      score: 0.01,
    }]);

    await expect(
      createOperations(client).searchByVector('Function', [0.1, 0.2], 5),
    ).rejects.toThrow('Vector search returned Function row without a valid persisted id');
  });

  it('rejects an unexpected persisted id shape instead of dropping a real row', async () => {
    const client = clientReturning([{
      id: { value: `sym:v1:${'b'.repeat(64)}` },
      name: 'buildWidget',
      filePath: '/project/widget.ts',
      score: 0.01,
    }]);

    await expect(
      createOperations(client).searchByVector('Function', [0.1, 0.2], 5),
    ).rejects.toThrow('Vector search returned Function row without a valid persisted id');
  });
});
