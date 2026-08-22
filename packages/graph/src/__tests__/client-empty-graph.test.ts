import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '../client';
import { FalkorDBLiteDriver } from '../drivers/falkordblite';

const EMPTY_GRAPH_ERROR = new Error('ERR Invalid graph operation on empty key');

describe('graph client empty graph boundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function createEmptyGraphClient() {
    vi.spyOn(FalkorDBLiteDriver.prototype, 'connect').mockResolvedValue(undefined);
    vi.spyOn(FalkorDBLiteDriver.prototype, 'query').mockRejectedValue(EMPTY_GRAPH_ERROR);
    vi.spyOn(FalkorDBLiteDriver.prototype, 'roQuery').mockRejectedValue(EMPTY_GRAPH_ERROR);
    vi.spyOn(FalkorDBLiteDriver.prototype, 'close').mockResolvedValue(undefined);

    return createClient({ driver: 'falkordblite', databasePath: '/private/tmp/codegraph-empty-boundary' });
  }

  it('returns an empty result for a read-only query against an absent graph key', async () => {
    const client = await createEmptyGraphClient();

    await expect(client.roQuery('MATCH (n) RETURN n')).resolves.toEqual({
      data: [],
      metadata: [],
    });
  });

  it('returns an empty result when the general query path performs a read against an absent graph key', async () => {
    const client = await createEmptyGraphClient();

    await expect(client.query('MATCH (n) RETURN n')).resolves.toEqual({
      data: [],
      metadata: [],
    });
  });

  it('continues to reject unrelated query failures', async () => {
    const client = await createEmptyGraphClient();
    vi.mocked(FalkorDBLiteDriver.prototype.roQuery).mockRejectedValueOnce(new Error('socket closed'));

    await expect(client.roQuery('MATCH (n) RETURN n')).rejects.toMatchObject({
      code: 'QUERY_FAILED',
      message: 'Read-only query failed: socket closed',
    });
  });
});
