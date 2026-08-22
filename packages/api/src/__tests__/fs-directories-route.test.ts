import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFsRoutes } from '../routes/fs-directories';

const temporaryDirectories: string[] = [];

async function makeTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('GET /api/fs/directories', () => {
  it('returns a requested directory and honors includeHidden=true', async () => {
    const root = await makeTemporaryDirectory('codegraph-route-root-');
    await mkdir(join(root, '.hidden'));
    await mkdir(join(root, 'visible'));
    const routes = createFsRoutes({ homeDirectory: root });
    const query = new URLSearchParams({ path: root, includeHidden: 'true' });

    const response = await routes.request(
      `/api/fs/directories?${query.toString()}`,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      path: string | null;
      parent: string | null;
      entries: Array<{ name: string }>;
      truncated: boolean;
    };
    expect(body.path).not.toBeNull();
    expect(body.parent).toBeNull();
    expect(body.entries.map((entry) => entry.name)).toEqual([
      '.hidden',
      'visible',
    ]);
    expect(body.truncated).toBe(false);
  });

  it('returns configured roots when path is absent', async () => {
    const home = await makeTemporaryDirectory('codegraph-route-home-');
    const extra = await makeTemporaryDirectory('codegraph-route-extra-');
    const routes = createFsRoutes({
      homeDirectory: home,
      configuredRoots: extra,
    });

    const response = await routes.request('/api/fs/directories');

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      path: string | null;
      parent: string | null;
      entries: Array<{ path: string }>;
      truncated: boolean;
    };
    expect(body.path).toBeNull();
    expect(body.parent).toBeNull();
    expect(body.entries).toHaveLength(2);
    expect(body.entries.map((entry) => entry.path)).toEqual(
      expect.arrayContaining([
        expect.stringContaining(home.split('/').at(-1) ?? ''),
      ]),
    );
    expect(body.truncated).toBe(false);
  });

  it('returns 403 for an encoded traversal outside the root', async () => {
    const container = await makeTemporaryDirectory(
      'codegraph-route-container-',
    );
    const root = join(container, 'root');
    const outside = join(container, 'outside');
    await mkdir(root);
    await mkdir(outside);
    const routes = createFsRoutes({ homeDirectory: root });
    const encodedPath = `${encodeURIComponent(root)}%2F%2E%2E%2Foutside`;

    const response = await routes.request(
      `/api/fs/directories?path=${encodedPath}`,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: 'path is outside every filesystem browse root',
    });
  });

  it('does not register a mutating method', async () => {
    const root = await makeTemporaryDirectory('codegraph-route-root-');
    const routes = createFsRoutes({ homeDirectory: root });

    const response = await routes.request('/api/fs/directories', {
      method: 'POST',
    });

    expect(response.status).toBe(404);
  });

  it('returns a fixed message when directory enumeration fails unexpectedly', async () => {
    const root = await makeTemporaryDirectory('codegraph-route-root-');
    const routes = createFsRoutes({
      homeDirectory: root,
      browse: async () => {
        throw new Error('sensitive filesystem detail');
      },
    });

    const response = await routes.request(
      `/api/fs/directories?path=${encodeURIComponent(root)}`,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to browse directories.',
    });
  });
});
