import { describe, expect, it } from 'vitest';
import { isAbsolute, join, resolve } from 'node:path';
import {
  resolveEmbeddedDataPath,
  unixSocketPathLimit,
} from '../drivers/falkordblite';

/** falkordblite appends "/fdb-" + 16 hex + ".sock" to the data directory. */
const socketFilenameBytes = 1 + 'fdb-'.length + 16 + '.sock'.length;

describe('unixSocketPathLimit', () => {
  it('uses the documented UNIX_PATH_MAX per platform', () => {
    expect(unixSocketPathLimit('darwin')).toBe(104);
    expect(unixSocketPathLimit('linux')).toBe(108);
  });
});

describe('resolveEmbeddedDataPath', () => {
  const home = '/Users/example';

  it('keeps a short configured path untouched', () => {
    const { dataPath, relocatedFrom } = resolveEmbeddedDataPath('/tmp/cg/db', {
      platform: 'darwin',
      home,
    });
    expect(dataPath).toBe('/tmp/cg/db');
    expect(relocatedFrom).toBeUndefined();
  });

  it('relocates a path that cannot fit a socket name', () => {
    // Reproduces the real failure: a deep checkout produced a 111-byte socket path.
    const deep =
      '/Users/randywilson/Developer/Personal/codebase-graph/packages/api/.codegraph/falkordb';
    const { dataPath, relocatedFrom } = resolveEmbeddedDataPath(deep, {
      platform: 'darwin',
      home,
    });
    expect(relocatedFrom).toBe(deep);
    expect(dataPath.startsWith(join(home, '.codegraph', 'graphs'))).toBe(true);
    expect(Buffer.byteLength(dataPath) + socketFilenameBytes).toBeLessThanOrEqual(
      unixSocketPathLimit('darwin'),
    );
  });

  it('maps the same project to the same directory every time', () => {
    const deep = '/very/'.padEnd(120, 'a');
    const first = resolveEmbeddedDataPath(deep, { platform: 'darwin', home });
    const second = resolveEmbeddedDataPath(deep, { platform: 'darwin', home });
    expect(first.dataPath).toBe(second.dataPath);
  });

  it('maps different projects to different directories', () => {
    const a = resolveEmbeddedDataPath('/very/'.padEnd(120, 'a'), { platform: 'darwin', home });
    const b = resolveEmbeddedDataPath('/very/'.padEnd(120, 'b'), { platform: 'darwin', home });
    expect(a.dataPath).not.toBe(b.dataPath);
  });

  it('honours the larger Linux limit', () => {
    // 100 bytes fits under Linux (108 minus 26 leaves 82)? No: build one that
    // fits Linux but not macOS to prove the platform branch is used.
    const path = '/x'.padEnd(80, 'y');
    const onLinux = resolveEmbeddedDataPath(path, { platform: 'linux', home });
    const onDarwin = resolveEmbeddedDataPath(path, { platform: 'darwin', home });
    expect(onLinux.relocatedFrom).toBeUndefined();
    expect(onDarwin.relocatedFrom).toBe(resolve(path));
  });

  it('never relocates on Windows, where named pipes are used', () => {
    const deep = '/very/'.padEnd(200, 'a');
    expect(resolveEmbeddedDataPath(deep, { platform: 'win32', home }).relocatedFrom).toBeUndefined();
  });

  it('resolves a relative path before measuring it', () => {
    const { dataPath, relocatedFrom } = resolveEmbeddedDataPath('.codegraph/falkordb', {
      platform: 'darwin',
      home,
    });
    // Whether or not it fits depends on where the suite runs from, so assert the
    // property that must hold either way: the relative input was made absolute
    // before the length was measured.
    expect(isAbsolute(dataPath)).toBe(true);
    if (relocatedFrom === undefined) {
      expect(dataPath).toBe(resolve('.codegraph/falkordb'));
    } else {
      expect(relocatedFrom).toBe(resolve('.codegraph/falkordb'));
    }
  });
});

describe('resolveEmbeddedDataPath boundary handling', () => {
  const home = '/Users/example';
  // falkordblite appends "/fdb-" + 16 hex + ".sock", and sun_path must also hold
  // a terminating NUL, so the usable directory budget is limit minus 26 minus 1.
  const usableBudget = (platform: NodeJS.Platform) =>
    unixSocketPathLimit(platform) - (1 + 'fdb-'.length + 16 + '.sock'.length) - 1;

  it('accepts a directory exactly at the usable budget', () => {
    const exact = '/' + 'a'.repeat(usableBudget('darwin') - 1);
    expect(Buffer.byteLength(exact)).toBe(usableBudget('darwin'));
    expect(resolveEmbeddedDataPath(exact, { platform: 'darwin', home }).relocatedFrom).toBeUndefined();
  });

  it('relocates a directory one byte over the usable budget', () => {
    // Without reserving the NUL byte this pathname was treated as fitting, and
    // the socket then failed to bind at runtime.
    const overBy1 = '/' + 'a'.repeat(usableBudget('darwin'));
    expect(Buffer.byteLength(overBy1)).toBe(usableBudget('darwin') + 1);
    expect(resolveEmbeddedDataPath(overBy1, { platform: 'darwin', home }).relocatedFrom).toBe(overBy1);
  });

  it('leaves room for the NUL on Linux too', () => {
    const overBy1 = '/' + 'a'.repeat(usableBudget('linux'));
    expect(resolveEmbeddedDataPath(overBy1, { platform: 'linux', home }).relocatedFrom).toBe(overBy1);
  });
})
