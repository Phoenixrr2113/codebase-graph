import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GraphClient } from '@codegraph/graph';

const createClientMock = vi.hoisted(() => vi.fn());

vi.mock('@codegraph/graph', () => ({
  createClient: createClientMock,
}));

import { closeGraphClient, getGraphClient } from '../graphClient';

function createGraphClientFixture(): GraphClient {
  return {
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as GraphClient;
}

afterEach(async () => {
  await closeGraphClient();
  createClientMock.mockReset();
});

describe('getGraphClient', () => {
  it('shares one in-flight connection across concurrent callers', async () => {
    const client = createGraphClientFixture();
    let resolveConnection: ((value: GraphClient) => void) | undefined;
    const connection = new Promise<GraphClient>((resolve) => {
      resolveConnection = resolve;
    });
    createClientMock.mockReturnValue(connection);

    const first = getGraphClient();
    const second = getGraphClient();

    expect(createClientMock).toHaveBeenCalledTimes(1);
    resolveConnection?.(client);
    await expect(Promise.all([first, second])).resolves.toEqual([client, client]);
  });

  it('allows a retry after connection creation fails', async () => {
    const client = createGraphClientFixture();
    createClientMock
      .mockRejectedValueOnce(new Error('connection failed'))
      .mockResolvedValueOnce(client);

    await expect(getGraphClient()).rejects.toThrow('connection failed');
    await expect(getGraphClient()).resolves.toBe(client);
    expect(createClientMock).toHaveBeenCalledTimes(2);
  });
});
