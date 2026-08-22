import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DIRECTORY_ENTRY_LIMIT,
  browseDirectories,
  resolveBrowseRoots,
} from '../fs-browse';

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

describe('resolveBrowseRoots', () => {
  it('returns the home directory plus normalized absolute configured roots', async () => {
    const home = await makeTemporaryDirectory('codegraph-home-');
    const configured = await makeTemporaryDirectory('codegraph-root-');

    await expect(
      resolveBrowseRoots(home, ` ${configured},relative,${home} `),
    ).resolves.toEqual([await realpath(home), await realpath(configured)]);
  });
});

describe('browseDirectories', () => {
  it('returns configured roots when no path is requested', async () => {
    const root = await makeTemporaryDirectory('codegraph-root-');

    await expect(browseDirectories(undefined, [root])).resolves.toEqual({
      path: null,
      parent: null,
      entries: [
        {
          name: root.split('/').at(-1),
          path: await realpath(root),
          projectMarkers: [],
          isSymlink: false,
        },
      ],
      truncated: false,
    });
  });

  it('lists only immediate child directories with sorted project markers', async () => {
    const root = await makeTemporaryDirectory('codegraph-root-');
    const alpha = join(root, 'alpha');
    const beta = join(root, 'beta');
    await mkdir(alpha);
    await mkdir(beta);
    await mkdir(join(alpha, '.git'));
    await writeFile(join(alpha, 'package.json'), '{}');
    await writeFile(join(alpha, 'README.md'), 'not exposed');
    await writeFile(join(root, 'root-file.txt'), 'not exposed');

    await expect(browseDirectories(root, [root])).resolves.toEqual({
      path: await realpath(root),
      parent: null,
      entries: [
        {
          name: 'alpha',
          path: await realpath(alpha),
          projectMarkers: ['.git', 'package.json'],
          isSymlink: false,
        },
        {
          name: 'beta',
          path: await realpath(beta),
          projectMarkers: [],
          isSymlink: false,
        },
      ],
      truncated: false,
    });
  });

  it('returns the containing browse root as parent for a child directory', async () => {
    const root = await makeTemporaryDirectory('codegraph-root-');
    const child = join(root, 'child');
    await mkdir(child);

    const result = await browseDirectories(child, [root]);

    expect(result.path).toBe(await realpath(child));
    expect(result.parent).toBe(await realpath(root));
  });

  it('omits hidden directories unless includeHidden is true', async () => {
    const root = await makeTemporaryDirectory('codegraph-root-');
    await mkdir(join(root, '.hidden'));
    await mkdir(join(root, 'visible'));

    const hiddenByDefault = await browseDirectories(root, [root]);
    const hiddenIncluded = await browseDirectories(root, [root], {
      includeHidden: true,
    });

    expect(hiddenByDefault.entries.map((entry) => entry.name)).toEqual([
      'visible',
    ]);
    expect(hiddenIncluded.entries.map((entry) => entry.name)).toEqual([
      '.hidden',
      'visible',
    ]);
  });

  it('rejects lexical and encoded traversal outside a browse root with 403', async () => {
    const container = await makeTemporaryDirectory('codegraph-container-');
    const root = join(container, 'root');
    const outside = join(container, 'outside');
    await mkdir(root);
    await mkdir(outside);

    await expect(
      browseDirectories(join(root, '..', 'outside'), [root]),
    ).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      browseDirectories(decodeURIComponent(`${root}/%2e%2e/outside`), [root]),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('rejects a symlink to a directory outside a browse root with 403', async () => {
    const root = await makeTemporaryDirectory('codegraph-root-');
    const outside = await makeTemporaryDirectory('codegraph-outside-');
    const link = join(root, 'outside-link');
    await symlink(outside, link, 'dir');

    await expect(browseDirectories(link, [root])).rejects.toMatchObject({
      status: 403,
    });
  });

  it('marks in-root directory symlinks and omits out-of-root symlinks', async () => {
    const root = await makeTemporaryDirectory('codegraph-root-');
    const outside = await makeTemporaryDirectory('codegraph-outside-');
    const target = join(root, 'target');
    await mkdir(target);
    await symlink(target, join(root, 'inside-link'), 'dir');
    await symlink(outside, join(root, 'outside-link'), 'dir');

    const result = await browseDirectories(root, [root]);
    const normalizedRoot = await realpath(root);

    expect(result.entries).toEqual([
      {
        name: 'inside-link',
        path: join(normalizedRoot, 'inside-link'),
        projectMarkers: [],
        isSymlink: true,
      },
      {
        name: 'target',
        path: join(normalizedRoot, 'target'),
        projectMarkers: [],
        isSymlink: false,
      },
    ]);
  });

  it('returns 404 for a nonexistent path', async () => {
    const root = await makeTemporaryDirectory('codegraph-root-');

    await expect(
      browseDirectories(join(root, 'missing'), [root]),
    ).rejects.toMatchObject({
      status: 404,
    });
  });

  it('returns 400 for a file path and for a relative path', async () => {
    const root = await makeTemporaryDirectory('codegraph-root-');
    const file = join(root, 'file.txt');
    await writeFile(file, 'file');

    await expect(browseDirectories(file, [root])).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      browseDirectories('relative/path', [root]),
    ).rejects.toMatchObject({
      status: 400,
    });
  });

  it('caps sorted entries and reports truncation', async () => {
    const root = await makeTemporaryDirectory('codegraph-root-');
    await Promise.all(
      Array.from({ length: DIRECTORY_ENTRY_LIMIT + 1 }, (_, index) =>
        mkdir(join(root, `directory-${String(index).padStart(3, '0')}`)),
      ),
    );

    const result = await browseDirectories(root, [root]);

    expect(result.entries).toHaveLength(DIRECTORY_ENTRY_LIMIT);
    expect(result.entries[0]?.name).toBe('directory-000');
    expect(result.entries.at(-1)?.name).toBe(
      `directory-${String(DIRECTORY_ENTRY_LIMIT - 1).padStart(3, '0')}`,
    );
    expect(result.truncated).toBe(true);
  });
});
